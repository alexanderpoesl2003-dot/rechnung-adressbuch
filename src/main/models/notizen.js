const { getDb } = require('../db');

function list() {
    return getDb().prepare(`
        SELECT n.*, c.nachname_firma AS kunde_name, c.kundennummer AS kunde_nummer
        FROM notizen n
        LEFT JOIN customers c ON c.id = n.customer_id
        ORDER BY n.erledigt ASC, n.prioritaet ASC, n.faellig_am IS NULL, n.faellig_am ASC
    `).all();
}

function create(data) {
    const stmt = getDb().prepare(`
        INSERT INTO notizen (customer_id, text, prioritaet, faellig_am, erledigt)
        VALUES (@customer_id, @text, @prioritaet, @faellig_am, 0)
    `);
    const info = stmt.run(normalize(data));
    return getDb().prepare('SELECT * FROM notizen WHERE id = ?').get(info.lastInsertRowid);
}

function update(id, data) {
    getDb().prepare(`
        UPDATE notizen SET customer_id = @customer_id, text = @text, prioritaet = @prioritaet, faellig_am = @faellig_am
        WHERE id = @id
    `).run({ ...normalize(data), id });
    return getDb().prepare('SELECT * FROM notizen WHERE id = ?').get(id);
}

function setErledigt(id, erledigt) {
    getDb().prepare('UPDATE notizen SET erledigt = ? WHERE id = ?').run(erledigt ? 1 : 0, id);
    return getDb().prepare('SELECT * FROM notizen WHERE id = ?').get(id);
}

function remove(id) {
    getDb().prepare('DELETE FROM notizen WHERE id = ?').run(id);
}

function normalize(data) {
    return {
        customer_id: data.customer_id ? Number(data.customer_id) : null,
        text: data.text,
        prioritaet: Number(data.prioritaet) || 3,
        faellig_am: data.faellig_am || null
    };
}

module.exports = { list, create, update, setErledigt, remove };
