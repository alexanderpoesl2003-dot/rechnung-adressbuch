const { getDb } = require('../db');
const { BELEG_TYPEN } = require('../beleg-typen');
const { calculateTotals, logHistory, STATUS_FINALISIERT } = require('./invoices');

function assertBekannterTyp(typ) {
    if (!BELEG_TYPEN[typ]) throw new Error(`Unbekannte Belegart: ${typ}`);
}

// bezug_rechnungsnummer/-datum werden per LEFT JOIN mitgeliefert, damit eine
// Korrekturrechnung ihren Bezug auf die ursprüngliche Rechnung auch in der
// Übersicht sichtbar macht (nicht nur intern über bezug_invoice_id) - siehe
// Auftrag Block 1, Punkt 7. Ist kein Bezug gesetzt, bleiben die Felder null.
function list(typ) {
    assertBekannterTyp(typ);
    return getDb().prepare(`
        SELECT b.*, sp.name AS profil_name, c.nachname_firma AS kunde_name, c.kundennummer AS kunde_nummer,
               bi.rechnungsnummer AS bezug_rechnungsnummer, bi.rechnungsdatum AS bezug_rechnungsdatum
        FROM belege b
        JOIN sender_profiles sp ON sp.id = b.sender_profile_id
        JOIN customers c ON c.id = b.customer_id
        LEFT JOIN invoices bi ON bi.id = b.bezug_invoice_id
        WHERE b.typ = ?
        ORDER BY b.erstellt_am DESC
    `).all(typ);
}

function get(id) {
    const beleg = getDb().prepare(`
        SELECT b.*, sp.name AS profil_name, c.nachname_firma AS kunde_name,
               bi.rechnungsnummer AS bezug_rechnungsnummer, bi.rechnungsdatum AS bezug_rechnungsdatum
        FROM belege b
        JOIN sender_profiles sp ON sp.id = b.sender_profile_id
        JOIN customers c ON c.id = b.customer_id
        LEFT JOIN invoices bi ON bi.id = b.bezug_invoice_id
        WHERE b.id = ?
    `).get(id);
    if (!beleg) return null;

    beleg.positionen = getDb()
        .prepare('SELECT * FROM beleg_positionen WHERE beleg_id = ? ORDER BY position')
        .all(id);
    beleg.summen = calculateTotals(beleg.positionen);
    beleg.textBausteine = getDb()
        .prepare(`
            SELECT t.* FROM text_bausteine t
            JOIN beleg_textbausteine bt ON bt.text_baustein_schluessel = t.schluessel
            WHERE bt.beleg_id = ?
            ORDER BY t.titel
        `)
        .all(id);
    return beleg;
}

// Reserviert die nächste Belegnummer für Profil+Typ (Format <Prefix><JJ>-<Nummer>)
// und erhöht den Zähler. Muss innerhalb der Erstellungs-Transaktion laufen.
function reserveNextBelegnummer(senderProfileId, typ, belegdatum) {
    const zaehler = getDb()
        .prepare('SELECT * FROM beleg_zaehler WHERE sender_profile_id = ? AND typ = ?')
        .get(senderProfileId, typ);
    if (!zaehler) throw new Error('Kein Nummernkreis für dieses Profil/diese Belegart gefunden.');

    const jj = String(new Date(belegdatum).getFullYear() % 100).padStart(2, '0');
    const nummer = String(zaehler.naechste_nummer).padStart(4, '0');
    const belegnummer = `${zaehler.prefix}${jj}-${nummer}`;

    getDb()
        .prepare('UPDATE beleg_zaehler SET naechste_nummer = naechste_nummer + 1 WHERE sender_profile_id = ? AND typ = ?')
        .run(senderProfileId, typ);

    return belegnummer;
}

function create(typ, data) {
    assertBekannterTyp(typ);
    const db = getDb();
    const positionen = data.positionen || [];
    if (positionen.length === 0) {
        throw new Error('Ein Beleg benötigt mindestens eine Position.');
    }

    // Eine Korrekturrechnung soll eindeutig auf eine bereits abgeschlossene
    // Rechnung verweisen (siehe Auftrag Block 1, Punkt 7) - ein Bezug auf
    // einen noch änderbaren Entwurf ergibt fachlich keinen Sinn, da ein
    // Entwurf stattdessen direkt korrigiert werden kann. Der Bezug selbst
    // bleibt optional (nicht jede Korrektur muss eine Systemrechnung betreffen).
    if (typ === 'korrektur' && data.bezug_invoice_id) {
        const bezugRechnung = db
            .prepare('SELECT id, status, rechnungsnummer FROM invoices WHERE id = ?')
            .get(data.bezug_invoice_id);
        if (!bezugRechnung) {
            throw new Error('Die als Bezug gewählte Rechnung wurde nicht gefunden.');
        }
        if (bezugRechnung.status !== STATUS_FINALISIERT) {
            throw new Error(
                'Eine Korrekturrechnung kann nur auf eine bereits finalisierte Rechnung verweisen. ' +
                `Rechnung ${bezugRechnung.rechnungsnummer} ist noch ein Entwurf und kann direkt bearbeitet werden.`
            );
        }
    }

    const transaction = db.transaction(() => {
        const belegnummer = reserveNextBelegnummer(data.sender_profile_id, typ, data.belegdatum);

        const insertBeleg = db.prepare(`
            INSERT INTO belege
                (typ, sender_profile_id, customer_id, belegnummer, belegdatum,
                 bezug_invoice_id, status, extra_text, freier_text)
            VALUES (@typ, @sender_profile_id, @customer_id, @belegnummer, @belegdatum,
                    @bezug_invoice_id, @status, @extra_text, @freier_text)
        `);
        const info = insertBeleg.run({
            typ,
            sender_profile_id: data.sender_profile_id,
            customer_id: data.customer_id,
            belegnummer,
            belegdatum: data.belegdatum,
            bezug_invoice_id: data.bezug_invoice_id || null,
            status: data.status || 'entwurf',
            extra_text: data.extra_text || null,
            freier_text: data.freier_text || null
        });

        const belegId = info.lastInsertRowid;
        const insertPosition = db.prepare(`
            INSERT INTO beleg_positionen
                (beleg_id, position, artikel_nr, bezeichnung, menge, einzelpreis_netto, mwst_satz)
            VALUES (@beleg_id, @position, @artikel_nr, @bezeichnung, @menge, @einzelpreis_netto, @mwst_satz)
        `);
        positionen.forEach((pos, index) => {
            insertPosition.run({
                beleg_id: belegId,
                position: index + 1,
                artikel_nr: pos.artikel_nr || null,
                bezeichnung: pos.bezeichnung,
                menge: Number(pos.menge) || 0,
                einzelpreis_netto: Number(pos.einzelpreis_netto) || 0,
                mwst_satz: Number(pos.mwst_satz) || 19
            });
        });

        setTextBausteine(belegId, data.textBausteineSchluessel);

        if (typ === 'korrektur' && data.bezug_invoice_id) {
            logHistory(data.bezug_invoice_id, 'CORRECTION_CREATED', `Korrekturbeleg ${belegnummer}`, db);
        }

        return belegId;
    });

    return get(transaction());
}

function setTextBausteine(belegId, schluesselListe) {
    const db = getDb();
    db.prepare('DELETE FROM beleg_textbausteine WHERE beleg_id = ?').run(belegId);
    const insert = db.prepare('INSERT INTO beleg_textbausteine (beleg_id, text_baustein_schluessel) VALUES (?, ?)');
    for (const schluessel of schluesselListe || []) {
        insert.run(belegId, schluessel);
    }
}

function remove(id) {
    getDb().prepare('DELETE FROM belege WHERE id = ?').run(id);
}

module.exports = { list, get, create, remove, reserveNextBelegnummer };
