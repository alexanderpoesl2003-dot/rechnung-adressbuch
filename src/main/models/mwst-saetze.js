const { getDb } = require('../db');

const STANDARD_SAETZE = [
    { satz: 7, bezeichnung: 'ermäßigt' },
    { satz: 7.8, bezeichnung: 'Land-/Forstwirtschaft (§24 UStG)' },
    { satz: 19, bezeichnung: 'Standard' }
];

function list(senderProfileId) {
    return getDb()
        .prepare('SELECT * FROM mwst_saetze WHERE sender_profile_id = ? ORDER BY satz')
        .all(senderProfileId);
}

function create(senderProfileId, data) {
    const stmt = getDb().prepare(`
        INSERT INTO mwst_saetze (sender_profile_id, satz, bezeichnung) VALUES (?, ?, ?)
    `);
    try {
        const info = stmt.run(senderProfileId, Number(data.satz), data.bezeichnung || null);
        return getDb().prepare('SELECT * FROM mwst_saetze WHERE id = ?').get(info.lastInsertRowid);
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            throw new Error(`Ein MwSt-Satz mit ${data.satz}% existiert für dieses Profil bereits.`);
        }
        throw err;
    }
}

function remove(id) {
    getDb().prepare('DELETE FROM mwst_saetze WHERE id = ?').run(id);
}

// Legt für ein (neues) Profil die drei Standard-Sätze an, sofern noch keine vorhanden sind.
function seedFuerProfil(senderProfileId) {
    const anzahl = getDb().prepare('SELECT COUNT(*) AS n FROM mwst_saetze WHERE sender_profile_id = ?').get(senderProfileId).n;
    if (anzahl > 0) return;
    const insert = getDb().prepare('INSERT OR IGNORE INTO mwst_saetze (sender_profile_id, satz, bezeichnung) VALUES (?, ?, ?)');
    for (const s of STANDARD_SAETZE) {
        insert.run(senderProfileId, s.satz, s.bezeichnung);
    }
}

module.exports = { list, create, remove, seedFuerProfil };
