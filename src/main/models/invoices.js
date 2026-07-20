const { getDb } = require('../db');
const profiles = require('./profiles');

function list() {
    return getDb().prepare(`
        SELECT
            i.*,
            sp.name AS profil_name,
            c.nachname_firma AS kunde_name,
            c.kundennummer AS kunde_nummer
        FROM invoices i
        JOIN sender_profiles sp ON sp.id = i.sender_profile_id
        JOIN customers c ON c.id = i.customer_id
        ORDER BY i.erstellt_am DESC
    `).all();
}

function get(id) {
    const invoice = getDb().prepare(`
        SELECT i.*, sp.name AS profil_name, c.nachname_firma AS kunde_name
        FROM invoices i
        JOIN sender_profiles sp ON sp.id = i.sender_profile_id
        JOIN customers c ON c.id = i.customer_id
        WHERE i.id = ?
    `).get(id);
    if (!invoice) return null;

    invoice.positionen = getDb()
        .prepare('SELECT * FROM invoice_positions WHERE invoice_id = ? ORDER BY position')
        .all(id);
    invoice.summen = calculateTotals(invoice.positionen);
    invoice.textBausteine = getDb()
        .prepare(`
            SELECT t.* FROM text_bausteine t
            JOIN invoice_textbausteine it ON it.text_baustein_schluessel = t.schluessel
            WHERE it.invoice_id = ?
            ORDER BY t.titel
        `)
        .all(id);
    return invoice;
}

// Berechnet die Nettosumme, die Aufteilung nach den tatsächlich verwendeten
// MwSt-Sätzen (beliebige, frei konfigurierte Sätze - nicht nur 7%/19%) sowie
// die Bruttogesamtsumme.
function calculateTotals(positionen) {
    const runden = (n) => Math.round(n * 100) / 100;
    const nachSatz = new Map();
    let netto = 0;

    for (const pos of positionen) {
        const satz = Number(pos.mwst_satz) || 0;
        const zeilenNetto = pos.menge * pos.einzelpreis_netto;
        netto += zeilenNetto;

        const eintrag = nachSatz.get(satz) || { satz, netto: 0, mwstBetrag: 0 };
        eintrag.netto += zeilenNetto;
        eintrag.mwstBetrag += zeilenNetto * (satz / 100);
        nachSatz.set(satz, eintrag);
    }

    const aufteilung = Array.from(nachSatz.values())
        .sort((a, b) => a.satz - b.satz)
        .map((a) => ({ satz: a.satz, netto: runden(a.netto), mwstBetrag: runden(a.mwstBetrag) }));
    const mwstGesamt = aufteilung.reduce((sum, a) => sum + a.mwstBetrag, 0);

    return {
        netto: runden(netto),
        mwstGesamt: runden(mwstGesamt),
        brutto: runden(netto + mwstGesamt),
        aufteilung
    };
}

function setTextBausteine(invoiceId, schluesselListe) {
    const db = getDb();
    db.prepare('DELETE FROM invoice_textbausteine WHERE invoice_id = ?').run(invoiceId);
    const insert = db.prepare('INSERT INTO invoice_textbausteine (invoice_id, text_baustein_schluessel) VALUES (?, ?)');
    for (const schluessel of schluesselListe || []) {
        insert.run(invoiceId, schluessel);
    }
}

// Erstellt eine Rechnung inkl. Positionen in einer Transaktion und reserviert
// dabei atomar die nächste Rechnungsnummer des gewählten Profils - sofern nicht
// manuell eine eigene Rechnungsnummer vorgegeben wurde.
function create(data) {
    const db = getDb();
    const positionen = data.positionen || [];
    if (positionen.length === 0) {
        throw new Error('Eine Rechnung benötigt mindestens eine Position.');
    }

    const manuelleRechnungsnummer = data.rechnungsnummer && data.rechnungsnummer.trim()
        ? data.rechnungsnummer.trim()
        : null;

    const transaction = db.transaction(() => {
        const rechnungsnummer = manuelleRechnungsnummer || profiles.reserveNextRechnungsnummer(
            data.sender_profile_id,
            data.rechnungsdatum
        );

        const insertInvoice = db.prepare(`
            INSERT INTO invoices
                (sender_profile_id, customer_id, rechnungsnummer, rechnungsdatum,
                 status, extra_text, freier_text)
            VALUES (@sender_profile_id, @customer_id, @rechnungsnummer, @rechnungsdatum,
                    @status, @extra_text, @freier_text)
        `);
        const info = insertInvoice.run({
            sender_profile_id: data.sender_profile_id,
            customer_id: data.customer_id,
            rechnungsnummer,
            rechnungsdatum: data.rechnungsdatum,
            status: data.status || 'entwurf',
            extra_text: data.extra_text || null,
            freier_text: data.freier_text || null
        });

        const invoiceId = info.lastInsertRowid;
        const insertPosition = db.prepare(`
            INSERT INTO invoice_positions
                (invoice_id, position, artikel_nr, bezeichnung, menge, einzelpreis_netto, mwst_satz)
            VALUES (@invoice_id, @position, @artikel_nr, @bezeichnung, @menge, @einzelpreis_netto, @mwst_satz)
        `);
        positionen.forEach((pos, index) => {
            insertPosition.run({
                invoice_id: invoiceId,
                position: index + 1,
                artikel_nr: pos.artikel_nr || null,
                bezeichnung: pos.bezeichnung,
                menge: Number(pos.menge) || 0,
                einzelpreis_netto: Number(pos.einzelpreis_netto) || 0,
                mwst_satz: Number(pos.mwst_satz) || 19
            });
        });

        setTextBausteine(invoiceId, data.textBausteineSchluessel);

        return invoiceId;
    });

    let invoiceId;
    try {
        invoiceId = transaction();
    } catch (err) {
        const istUniqueFehler = err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(err.message);
        if (istUniqueFehler && manuelleRechnungsnummer) {
            throw new Error(`Die Rechnungsnummer "${manuelleRechnungsnummer}" wird bereits verwendet. Bitte eine andere Nummer wählen.`);
        }
        throw err;
    }
    return get(invoiceId);
}

function updateStatus(id, status) {
    getDb().prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, id);
    return get(id);
}

function remove(id) {
    getDb().prepare('DELETE FROM invoices WHERE id = ?').run(id);
}

function listTextBausteine() {
    return getDb().prepare('SELECT * FROM text_bausteine').all();
}

// Markiert eine Rechnung als bezahlt/unbezahlt. bezahltBetrag ist optional
// (z.B. bei Skontoabzug) - fehlt er, wird beim Bezahlen der volle Bruttobetrag angenommen.
function markBezahlt(id, { bezahlt, bezahltAm, bezahltBetrag }) {
    const invoice = get(id);
    if (!invoice) throw new Error('Rechnung nicht gefunden.');

    const betrag = bezahlt
        ? (bezahltBetrag != null && bezahltBetrag !== '' ? Number(bezahltBetrag) : invoice.summen.brutto)
        : null;

    getDb()
        .prepare('UPDATE invoices SET bezahlt = ?, bezahlt_am = ?, bezahlt_betrag = ? WHERE id = ?')
        .run(bezahlt ? 1 : 0, bezahlt ? (bezahltAm || null) : null, betrag, id);

    return get(id);
}

// Liste aller unbezahlten Rechnungen inkl. offenem Betrag (Brutto abzgl. bereits
// erhaltener Zahlung, z.B. bei Teilzahlung/Skonto).
function offenePosten() {
    return list()
        .filter((i) => !i.bezahlt)
        .map((i) => {
            const summen = calculateTotals(
                getDb().prepare('SELECT * FROM invoice_positions WHERE invoice_id = ?').all(i.id)
            );
            const offenerBetrag = Math.round((summen.brutto - (i.bezahlt_betrag || 0)) * 100) / 100;
            return { ...i, summen, offener_betrag: offenerBetrag };
        });
}

// Alle Rechnungen eines Kunden inkl. berechneter Summen, neueste zuerst -
// Grundlage für die Kundendetailansicht (Feature "alle bisherigen Rechnungen
// dieses Kunden auf einen Blick").
function listByCustomer(customerId) {
    const db = getDb();
    const rechnungen = db.prepare(`
        SELECT i.*, sp.name AS profil_name, c.nachname_firma AS kunde_name
        FROM invoices i
        JOIN sender_profiles sp ON sp.id = i.sender_profile_id
        JOIN customers c ON c.id = i.customer_id
        WHERE i.customer_id = ?
        ORDER BY i.rechnungsdatum DESC, i.id DESC
    `).all(customerId);

    return rechnungen.map((r) => ({
        ...r,
        summen: calculateTotals(db.prepare('SELECT * FROM invoice_positions WHERE invoice_id = ?').all(r.id))
    }));
}

// Umsatzauswertung: Gesamtsumme sowie Aufschlüsselung je tatsächlich
// angelegtem Absenderprofil (dynamisch, keine festen Profilnamen). Optionaler
// Jahresfilter; ohne Filter über alle Jahre hinweg.
function statistik({ jahr } = {}) {
    const db = getDb();
    const alleProfile = db.prepare('SELECT id, name FROM sender_profiles ORDER BY name').all();
    const alleRechnungen = list();
    const jahre = Array.from(new Set(alleRechnungen.map((r) => r.rechnungsdatum.slice(0, 4)))).sort().reverse();
    const gefiltert = jahr ? alleRechnungen.filter((r) => r.rechnungsdatum.startsWith(jahr)) : alleRechnungen;

    const runden = (n) => Math.round(n * 100) / 100;

    const proProfil = alleProfile.map((p) => {
        const rechnungenDesProfils = gefiltert.filter((r) => r.sender_profile_id === p.id);
        let netto = 0;
        let brutto = 0;
        for (const r of rechnungenDesProfils) {
            const summen = calculateTotals(
                db.prepare('SELECT * FROM invoice_positions WHERE invoice_id = ?').all(r.id)
            );
            netto += summen.netto;
            brutto += summen.brutto;
        }
        return {
            profilId: p.id,
            profilName: p.name,
            anzahlRechnungen: rechnungenDesProfils.length,
            umsatzNetto: runden(netto),
            umsatzBrutto: runden(brutto)
        };
    });

    return {
        jahre,
        jahrFilter: jahr || null,
        gesamtNetto: runden(proProfil.reduce((sum, p) => sum + p.umsatzNetto, 0)),
        gesamtBrutto: runden(proProfil.reduce((sum, p) => sum + p.umsatzBrutto, 0)),
        proProfil
    };
}

// Zeilen für den Steuerberater-Export: frei wählbarer Zeitraum, optional auf
// ein Absenderprofil eingeschränkt.
function exportSteuerberaterRows({ von, bis, profileId } = {}) {
    const db = getDb();
    let auswahl = list();
    if (von) auswahl = auswahl.filter((r) => r.rechnungsdatum >= von);
    if (bis) auswahl = auswahl.filter((r) => r.rechnungsdatum <= bis);
    if (profileId) auswahl = auswahl.filter((r) => r.sender_profile_id === Number(profileId));

    return auswahl
        .sort((a, b) => a.rechnungsdatum.localeCompare(b.rechnungsdatum))
        .map((r) => {
            const summen = calculateTotals(
                db.prepare('SELECT * FROM invoice_positions WHERE invoice_id = ?').all(r.id)
            );
            return {
                rechnungsnummer: r.rechnungsnummer,
                rechnungsdatum: r.rechnungsdatum,
                profil: r.profil_name,
                kunde: r.kunde_name,
                netto: summen.netto,
                mwst: summen.mwstGesamt,
                brutto: summen.brutto,
                status: r.status,
                bezahlt: r.bezahlt ? 'ja' : 'nein',
                bezahltAm: r.bezahlt_am || null
            };
        });
}

module.exports = {
    list,
    get,
    create,
    updateStatus,
    remove,
    calculateTotals,
    listTextBausteine,
    markBezahlt,
    offenePosten,
    listByCustomer,
    statistik,
    exportSteuerberaterRows
};
