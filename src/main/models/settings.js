const crypto = require('crypto');
const { getDb } = require('../db');

const PASSWORT_SCHLUESSEL = 'passwort_hash';

// Einfacher Main-seitiger Anmeldezustand für die laufende Sitzung (siehe
// Auftrag "IPC-Härtung", Punkt 10) - bewusst NICHT persistiert, kein
// JWT/OAuth/Session-Server: eine lokale Desktop-App braucht dafür nur ein
// In-Memory-Flag, das bei jedem Programmstart wieder bei false beginnt
// (deckt sich mit dem bestehenden Verhalten des Login-Gates in der
// Renderer-Seite, das ebenfalls bei jedem Start erneut fragt).
let istAngemeldet = false;

function markiereAngemeldet() {
    istAngemeldet = true;
}

// Von sensiblen IPC-Handlern aufgerufen (siehe ipc/register.js). Ist gar
// kein Passwortschutz aktiv, gibt es nichts zu schützen - verhält sich
// dann wie verifyPassword() ebenfalls konsistent "immer erlaubt".
function requireAuthentication() {
    if (!isPasswordSet()) return;
    if (!istAngemeldet) {
        throw new Error('Diese Aktion erfordert eine erneute Anmeldung. Bitte zuerst das Passwort eingeben.');
    }
}

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
    // Wer gerade selbst (erstmalig oder ändernd) ein Passwort setzt, hat sich
    // damit ausreichend ausgewiesen - sonst würde man sich mit der eigenen
    // Erstaktivierung sofort selbst aussperren.
    markiereAngemeldet();
}

function verifyPassword(passwort) {
    const gespeichert = getWert(PASSWORT_SCHLUESSEL);
    if (!gespeichert) return true; // Kein Passwort gesetzt - immer erlaubt
    const [salt, hash] = gespeichert.split(':');
    const pruefHash = crypto.scryptSync(passwort || '', salt, 64).toString('hex');
    const ok = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(pruefHash, 'hex'));
    if (ok) markiereAngemeldet();
    return ok;
}

function removePassword(aktuellesPasswort) {
    if (isPasswordSet() && !verifyPassword(aktuellesPasswort)) {
        throw new Error('Aktuelles Passwort ist falsch.');
    }
    getDb().prepare('DELETE FROM einstellungen WHERE schluessel = ?').run(PASSWORT_SCHLUESSEL);
}

module.exports = {
    isPasswordSet, setPassword, verifyPassword, removePassword, getWert, setWert,
    requireAuthentication
};
