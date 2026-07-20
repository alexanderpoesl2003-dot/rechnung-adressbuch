const { getDb } = require('../db');

function list() {
    return getDb().prepare('SELECT * FROM text_bausteine ORDER BY titel').all();
}

// Erzeugt aus dem Titel einen stabilen, eindeutigen Schlüssel (Primärschlüssel
// der Tabelle). Der Schlüssel wird nach dem Anlegen nie mehr geändert, damit
// bereits erstellte Rechnungen/Belege ihre Verknüpfung behalten.
function generiereSchluessel(titel) {
    const basis = titel
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'textbaustein';

    const db = getDb();
    let schluessel = basis;
    let zaehler = 2;
    while (db.prepare('SELECT 1 FROM text_bausteine WHERE schluessel = ?').get(schluessel)) {
        schluessel = `${basis}_${zaehler}`;
        zaehler++;
    }
    return schluessel;
}

function create(data) {
    const titel = (data.titel || '').trim();
    const inhalt = (data.inhalt || '').trim();
    if (!titel) throw new Error('Titel ist erforderlich.');
    if (!inhalt) throw new Error('Inhalt ist erforderlich.');

    const schluessel = generiereSchluessel(titel);
    getDb()
        .prepare('INSERT INTO text_bausteine (schluessel, titel, inhalt) VALUES (?, ?, ?)')
        .run(schluessel, titel, inhalt);
    return getDb().prepare('SELECT * FROM text_bausteine WHERE schluessel = ?').get(schluessel);
}

function update(schluessel, data) {
    const titel = (data.titel || '').trim();
    const inhalt = (data.inhalt || '').trim();
    if (!titel) throw new Error('Titel ist erforderlich.');
    if (!inhalt) throw new Error('Inhalt ist erforderlich.');

    const info = getDb()
        .prepare('UPDATE text_bausteine SET titel = ?, inhalt = ? WHERE schluessel = ?')
        .run(titel, inhalt, schluessel);
    if (info.changes === 0) throw new Error('Textbaustein nicht gefunden.');
    return getDb().prepare('SELECT * FROM text_bausteine WHERE schluessel = ?').get(schluessel);
}

function remove(schluessel) {
    try {
        getDb().prepare('DELETE FROM text_bausteine WHERE schluessel = ?').run(schluessel);
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY constraint failed/.test(err.message)) {
            throw new Error('Dieser Textbaustein wird bereits in mindestens einer Rechnung oder einem Beleg verwendet und kann deshalb nicht gelöscht werden.');
        }
        throw err;
    }
}

module.exports = { list, create, update, remove };
