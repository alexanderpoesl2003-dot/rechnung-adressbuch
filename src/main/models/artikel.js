const { getDb } = require('../db');

function list() {
    return getDb().prepare('SELECT * FROM artikel ORDER BY artikel_nr').all();
}

function get(id) {
    return getDb().prepare('SELECT * FROM artikel WHERE id = ?').get(id);
}

function findByNr(artikelNr) {
    return getDb().prepare('SELECT * FROM artikel WHERE artikel_nr = ?').get(artikelNr);
}

function create(data) {
    const stmt = getDb().prepare(`
        INSERT INTO artikel
            (artikel_nr, bezeichnung, verkaufspreis_netto, einkaufspreis_netto, mwst_satz, warenbestand, mindestmenge)
        VALUES
            (@artikel_nr, @bezeichnung, @verkaufspreis_netto, @einkaufspreis_netto, @mwst_satz, @warenbestand, @mindestmenge)
    `);
    const info = stmt.run(normalize(data));
    return get(info.lastInsertRowid);
}

function update(id, data) {
    const stmt = getDb().prepare(`
        UPDATE artikel SET
            artikel_nr = @artikel_nr,
            bezeichnung = @bezeichnung,
            verkaufspreis_netto = @verkaufspreis_netto,
            einkaufspreis_netto = @einkaufspreis_netto,
            mwst_satz = @mwst_satz,
            warenbestand = @warenbestand,
            mindestmenge = @mindestmenge
        WHERE id = @id
    `);
    stmt.run({ ...normalize(data), id });
    return get(id);
}

function remove(id) {
    getDb().prepare('DELETE FROM artikel WHERE id = ?').run(id);
}

function normalize(data) {
    return {
        artikel_nr: data.artikel_nr,
        bezeichnung: data.bezeichnung,
        verkaufspreis_netto: Number(data.verkaufspreis_netto) || 0,
        einkaufspreis_netto: data.einkaufspreis_netto === '' || data.einkaufspreis_netto == null
            ? null
            : Number(data.einkaufspreis_netto),
        mwst_satz: Number(data.mwst_satz) || 19,
        warenbestand: data.warenbestand === '' || data.warenbestand == null ? null : Number(data.warenbestand),
        mindestmenge: data.mindestmenge === '' || data.mindestmenge == null ? null : Number(data.mindestmenge)
    };
}

module.exports = { list, get, findByNr, create, update, remove };
