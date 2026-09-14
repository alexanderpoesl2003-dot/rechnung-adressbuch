// Dünner Wrapper um Electrons eingebaute safeStorage-API (nutzt unter
// Windows DPAPI, unter macOS den Schlüsselbund) - siehe Auftrag "SMTP-
// Sicherheit, Secret-Handling und IPC-Härtung". Bewusst NICHT still auf
// Klartext zurückfallen, wenn safeStorage nicht verfügbar ist (z.B. auf
// manchen Linux-Systemen ohne passenden Keyring) - siehe verschluesseln().
const { safeStorage } = require('electron');

function verschluesselungVerfuegbar() {
    return safeStorage.isEncryptionAvailable();
}

// Verschlüsselt einen Klartext-String und liefert ihn als Base64-Text zurück
// (so lässt er sich wie jeder andere Text in der bestehenden
// Schlüssel/Wert-Tabelle "einstellungen" speichern - siehe Auftrag Punkt 16:
// keine neue Datenbank nur für Secrets).
function verschluesseln(klartext) {
    if (!verschluesselungVerfuegbar()) {
        throw new Error(
            'Die sichere Speicherung des Betriebssystems ist auf diesem Rechner nicht verfügbar. ' +
            'Das Passwort kann deshalb nicht sicher gespeichert werden.'
        );
    }
    return safeStorage.encryptString(klartext).toString('base64');
}

// Entschlüsselt einen zuvor mit verschluesseln() erzeugten Base64-Wert.
// Wirft bei jedem Fehler (safeStorage nicht verfügbar, beschädigter Wert,
// z.B. nach Systemwechsel/Schlüsselbund-Reset) eine für Endnutzer
// verständliche Meldung - niemals die technische Original-Fehlermeldung.
function entschluesseln(base64Wert) {
    if (!verschluesselungVerfuegbar()) {
        throw new Error(
            'Die sichere Speicherung des Betriebssystems ist auf diesem Rechner nicht verfügbar. ' +
            'Das gespeicherte E-Mail-Passwort kann deshalb nicht gelesen werden.'
        );
    }
    try {
        return safeStorage.decryptString(Buffer.from(base64Wert, 'base64'));
    } catch {
        throw new Error(
            'Das gespeicherte E-Mail-Passwort konnte nicht gelesen werden. Bitte geben Sie das Passwort erneut ein.'
        );
    }
}

module.exports = { verschluesselungVerfuegbar, verschluesseln, entschluesseln };
