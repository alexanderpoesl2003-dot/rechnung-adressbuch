// Einfache, optionale automatische lokale Backups mit Rotation (siehe
// Auftrag Block 3, Punkt 7). BEWUSST kein Minuten-/Stunden-Scheduler: die
// Sicherung läuft nur, wenn die App gestartet ist - beim Start wird geprüft,
// wann das letzte automatische Backup war, und bei Bedarf eines erstellt.
const fs = require('fs');
const path = require('path');
const settings = require('../models/settings');
const { erstelleBackup } = require('./backup');

const SCHLUESSEL = {
    aktiv: 'auto_backup_aktiv',
    intervall: 'auto_backup_intervall', // 'taeglich' | 'woechentlich'
    verzeichnis: 'auto_backup_verzeichnis',
    letzterZeitpunkt: 'auto_backup_letzter_zeitpunkt',
    anzahlBehalten: 'auto_backup_anzahl_behalten'
};

const INTERVALL_MS = {
    taeglich: 24 * 60 * 60 * 1000,
    woechentlich: 7 * 24 * 60 * 60 * 1000
};

const DATEINAME_PREFIX = 'AP-Rechnungstool-Auto-Backup-';

function getAutoBackupEinstellungen() {
    return {
        aktiv: settings.getWert(SCHLUESSEL.aktiv) === '1',
        intervall: settings.getWert(SCHLUESSEL.intervall) || 'taeglich',
        verzeichnis: settings.getWert(SCHLUESSEL.verzeichnis) || '',
        letzterZeitpunkt: settings.getWert(SCHLUESSEL.letzterZeitpunkt) || null,
        anzahlBehalten: Number(settings.getWert(SCHLUESSEL.anzahlBehalten)) || 10
    };
}

function saveAutoBackupEinstellungen(daten) {
    if (daten.aktiv && !daten.verzeichnis) {
        throw new Error('Bitte zuerst ein Backup-Verzeichnis auswählen.');
    }
    settings.setWert(SCHLUESSEL.aktiv, daten.aktiv ? '1' : '0');
    settings.setWert(SCHLUESSEL.intervall, daten.intervall === 'woechentlich' ? 'woechentlich' : 'taeglich');
    settings.setWert(SCHLUESSEL.verzeichnis, daten.verzeichnis || '');
    settings.setWert(SCHLUESSEL.anzahlBehalten, String(Math.max(1, Number(daten.anzahlBehalten) || 10)));
    return getAutoBackupEinstellungen();
}

// Behält nur die N neuesten automatischen Backups im konfigurierten
// Verzeichnis (erkannt am festen Dateinamen-Präfix, damit andere Dateien im
// selben Ordner nicht angefasst werden).
function rotiereAlteBackups(verzeichnis, anzahlBehalten) {
    let dateien;
    try {
        dateien = fs.readdirSync(verzeichnis).filter((n) => n.startsWith(DATEINAME_PREFIX) && n.endsWith('.apbackup'));
    } catch {
        return;
    }
    dateien.sort(); // Zeitstempel im Dateinamen sortiert lexikografisch = chronologisch
    const zuLoeschen = dateien.slice(0, Math.max(0, dateien.length - anzahlBehalten));
    for (const name of zuLoeschen) {
        // Synchron löschen (nicht das asynchrone fs.rm) - Rotation soll beim
        // Rückkehren aus dieser Funktion bereits abgeschlossen sein, nicht
        // erst irgendwann später im Hintergrund.
        fs.rmSync(path.join(verzeichnis, name), { force: true });
    }
}

// Beim App-Start aufgerufen (siehe main.js). Liefert Informationen zurück,
// ob/was ausgeführt wurde - rein informativ, wird aktuell nicht dem Nutzer
// angezeigt (kein Popup bei jedem Start), nur bei Fehlern geloggt.
function autoBackupFallsFaelligAusfuehren() {
    const einstellungen = getAutoBackupEinstellungen();
    if (!einstellungen.aktiv || !einstellungen.verzeichnis) return { ausgefuehrt: false };

    const intervallMs = INTERVALL_MS[einstellungen.intervall] || INTERVALL_MS.taeglich;
    const letzter = einstellungen.letzterZeitpunkt ? new Date(einstellungen.letzterZeitpunkt).getTime() : 0;
    if (Date.now() - letzter < intervallMs) return { ausgefuehrt: false };

    try {
        fs.mkdirSync(einstellungen.verzeichnis, { recursive: true });
        const zeitstempel = new Date().toISOString().replace(/[:.]/g, '-');
        const zielPfad = path.join(einstellungen.verzeichnis, `${DATEINAME_PREFIX}${zeitstempel}.apbackup`);
        erstelleBackup(zielPfad);
        settings.setWert(SCHLUESSEL.letzterZeitpunkt, new Date().toISOString());
        rotiereAlteBackups(einstellungen.verzeichnis, einstellungen.anzahlBehalten);
        return { ausgefuehrt: true, pfad: zielPfad };
    } catch (err) {
        console.error('Automatisches Backup fehlgeschlagen:', err.message);
        return { ausgefuehrt: false, fehler: err.message };
    }
}

module.exports = {
    getAutoBackupEinstellungen,
    saveAutoBackupEinstellungen,
    autoBackupFallsFaelligAusfuehren,
    rotiereAlteBackups,
    DATEINAME_PREFIX
};
