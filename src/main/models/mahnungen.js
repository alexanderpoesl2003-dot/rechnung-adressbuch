const { getDb } = require('../db');
const invoices = require('./invoices');
const { reserveNextBelegnummer } = require('./belege');

function list() {
    return getDb().prepare(`
        SELECT m.*, sp.name AS profil_name, c.nachname_firma AS kunde_name, c.kundennummer AS kunde_nummer,
               i.rechnungsnummer AS bezug_rechnungsnummer
        FROM belege m
        JOIN sender_profiles sp ON sp.id = m.sender_profile_id
        JOIN customers c ON c.id = m.customer_id
        LEFT JOIN invoices i ON i.id = m.bezug_invoice_id
        WHERE m.typ = 'mahnung'
        ORDER BY m.erstellt_am DESC
    `).all();
}

function get(id) {
    return getDb().prepare(`
        SELECT m.*, sp.name AS profil_name, c.nachname_firma AS kunde_name,
               i.rechnungsnummer AS bezug_rechnungsnummer
        FROM belege m
        JOIN sender_profiles sp ON sp.id = m.sender_profile_id
        JOIN customers c ON c.id = m.customer_id
        LEFT JOIN invoices i ON i.id = m.bezug_invoice_id
        WHERE m.id = ? AND m.typ = 'mahnung'
    `).get(id);
}

// Erstellt eine Mahnung zu einer bestehenden (unbezahlten) Rechnung. Der offene
// Betrag wird direkt aus der referenzierten Rechnung übernommen, keine eigenen
// Positionen - eine Mahnung ist inhaltlich ein Erinnerungsschreiben.
function create(data) {
    if (!data.bezug_invoice_id) {
        throw new Error('Eine Mahnung benötigt eine Bezugs-Rechnung.');
    }
    const rechnung = invoices.get(data.bezug_invoice_id);
    if (!rechnung) throw new Error('Bezugs-Rechnung nicht gefunden.');

    const db = getDb();
    const transaction = db.transaction(() => {
        const belegnummer = reserveNextBelegnummer(data.sender_profile_id, 'mahnung', data.belegdatum);
        const info = db.prepare(`
            INSERT INTO belege
                (typ, sender_profile_id, customer_id, belegnummer, belegdatum,
                 bezug_invoice_id, mahntext, text_baustein_schluessel, status)
            VALUES ('mahnung', @sender_profile_id, @customer_id, @belegnummer, @belegdatum,
                    @bezug_invoice_id, @mahntext, @text_baustein_schluessel, @status)
        `).run({
            sender_profile_id: data.sender_profile_id,
            customer_id: data.customer_id,
            belegnummer,
            belegdatum: data.belegdatum,
            bezug_invoice_id: data.bezug_invoice_id,
            mahntext: data.mahntext || null,
            text_baustein_schluessel: data.text_baustein_schluessel || null,
            status: data.status || 'entwurf'
        });
        return info.lastInsertRowid;
    });

    return get(transaction());
}

function remove(id) {
    getDb().prepare("DELETE FROM belege WHERE id = ? AND typ = 'mahnung'").run(id);
}

module.exports = { list, get, create, remove };
