const crypto = require('crypto');
const { getDb } = require('../db');

const PASSWORT_SCHLUESSEL = 'passwort_hash';

function getWert(schluessel) {
    const row = getDb().prepare('SELECT wert FROM einstellungen WHERE schluessel = ?').get(schluessel);
    return row ? row.wert : null;
}

function setWert(schluessel, wert) {
    getDb()
        .prepare('INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert')
        .run(schluessel, wert);
}

function hashPasswort(passwort) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(passwort, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function isPasswordSet() {
    return getWert(PASSWORT_SCHLUESSEL) != null;
}

function setPassword(passwort) {
    if (!passwort || passwort.length < 4) {
        throw new Error('Das Passwort muss mindestens 4 Zeichen lang sein.');
    }
    setWert(PASSWORT_SCHLUESSEL, hashPasswort(passwort));
}

function verifyPassword(passwort) {
    const gespeichert = getWert(PASSWORT_SCHLUESSEL);
    if (!gespeichert) return true; // Kein Passwort gesetzt - immer erlaubt
    const [salt, hash] = gespeichert.split(':');
    const pruefHash = crypto.scryptSync(passwort || '', salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(pruefHash, 'hex'));
}

function removePassword(aktuellesPasswort) {
    if (isPasswordSet() && !verifyPassword(aktuellesPasswort)) {
        throw new Error('Aktuelles Passwort ist falsch.');
    }
    getDb().prepare('DELETE FROM einstellungen WHERE schluessel = ?').run(PASSWORT_SCHLUESSEL);
}

module.exports = { isPasswordSet, setPassword, verifyPassword, removePassword, getWert, setWert };
