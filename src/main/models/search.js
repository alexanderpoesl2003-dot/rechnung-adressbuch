const { getDb } = require('../db');

// Übergreifende Suche über Kunden, Rechnungen und Notizen gleichzeitig.
function globalSearch(query) {
    const begriff = (query || '').trim();
    if (!begriff) return { customers: [], invoices: [], notizen: [] };

    const like = `%${begriff}%`;
    const db = getDb();

    const customers = db.prepare(`
        SELECT * FROM customers
        WHERE nachname_firma LIKE @like
           OR vorname_ansprechpartner LIKE @like
           OR kundennummer LIKE @like
           OR ort LIKE @like
           OR kontakt LIKE @like
           OR notiz LIKE @like
        ORDER BY nachname_firma
        LIMIT 30
    `).all({ like });

    const invoices = db.prepare(`
        SELECT i.*, sp.name AS profil_name, c.nachname_firma AS kunde_name
        FROM invoices i
        JOIN sender_profiles sp ON sp.id = i.sender_profile_id
        JOIN customers c ON c.id = i.customer_id
        WHERE i.rechnungsnummer LIKE @like OR c.nachname_firma LIKE @like
        ORDER BY i.rechnungsdatum DESC
        LIMIT 30
    `).all({ like });

    const notizen = db.prepare(`
        SELECT n.*, c.nachname_firma AS kunde_name
        FROM notizen n
        LEFT JOIN customers c ON c.id = n.customer_id
        WHERE n.text LIKE @like
        ORDER BY n.erstellt_am DESC
        LIMIT 30
    `).all({ like });

    return { customers, invoices, notizen };
}

module.exports = { globalSearch };
