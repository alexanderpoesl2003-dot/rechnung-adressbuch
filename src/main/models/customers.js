const { getDb } = require('../db');

function list() {
    return getDb().prepare('SELECT * FROM customers ORDER BY nachname_firma').all();
}

function get(id) {
    return getDb().prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

// Ermittelt die nächste freie Kundennummer im Format K<Zahl>, z.B. K21 -> K22.
function nextKundennummer() {
    const rows = getDb().prepare("SELECT kundennummer FROM customers WHERE kundennummer LIKE 'K%'").all();
    let max = 0;
    for (const row of rows) {
        const match = /^K(\d+)$/.exec(row.kundennummer);
        if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `K${max + 1}`;
}

function create(data) {
    const kundennummer = data.kundennummer && data.kundennummer.trim()
        ? data.kundennummer.trim()
        : nextKundennummer();

    const stmt = getDb().prepare(`
        INSERT INTO customers
            (kundennummer, anrede, nachname_firma, vorname_ansprechpartner, strasse, plz, ort, kontakt, notiz, angelegt_am)
        VALUES
            (@kundennummer, @anrede, @nachname_firma, @vorname_ansprechpartner, @strasse, @plz, @ort, @kontakt, @notiz, @angelegt_am)
    `);
    const info = stmt.run({ ...normalize(data), kundennummer });
    lernePlzOrt(data.plz, data.ort);
    return get(info.lastInsertRowid);
}

function update(id, data) {
    const stmt = getDb().prepare(`
        UPDATE customers SET
            kundennummer = @kundennummer,
            anrede = @anrede,
            nachname_firma = @nachname_firma,
            vorname_ansprechpartner = @vorname_ansprechpartner,
            strasse = @strasse,
            plz = @plz,
            ort = @ort,
            kontakt = @kontakt,
            notiz = @notiz
        WHERE id = @id
    `);
    stmt.run({ ...normalize(data), kundennummer: data.kundennummer, id });
    lernePlzOrt(data.plz, data.ort);
    return get(id);
}

// Merkt sich PLZ->Ort-Zuordnungen aus tatsächlich erfassten Adressen, damit
// bei künftigen Eingaben derselben PLZ der Ort automatisch vorgeschlagen
// werden kann (kein vollständiger bundesweiter PLZ-Datenbestand).
function lernePlzOrt(plz, ort) {
    if (!plz || !ort) return;
    getDb()
        .prepare('INSERT INTO plz_orte (plz, ort) VALUES (?, ?) ON CONFLICT(plz) DO UPDATE SET ort = excluded.ort')
        .run(plz.trim(), ort.trim());
}

function lookupOrtByPlz(plz) {
    const row = getDb().prepare('SELECT ort FROM plz_orte WHERE plz = ?').get((plz || '').trim());
    return row ? row.ort : null;
}

function remove(id) {
    const rechnungenCount = getDb()
        .prepare('SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ?')
        .get(id).n;
    if (rechnungenCount > 0) {
        throw new Error(
            'Kunde kann nicht gelöscht werden, da bereits Rechnungen für diesen Kunden existieren.'
        );
    }
    getDb().prepare('DELETE FROM customers WHERE id = ?').run(id);
}

function normalize(data) {
    return {
        anrede: data.anrede || null,
        nachname_firma: data.nachname_firma,
        vorname_ansprechpartner: data.vorname_ansprechpartner || null,
        strasse: data.strasse || null,
        plz: data.plz || null,
        ort: data.ort || null,
        kontakt: data.kontakt || null,
        notiz: data.notiz || null,
        angelegt_am: data.angelegt_am || new Date().toISOString().slice(0, 10)
    };
}

module.exports = { list, get, create, update, remove, nextKundennummer, lookupOrtByPlz };
