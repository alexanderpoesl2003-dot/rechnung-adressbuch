// Vollständiges Backup/Restore (siehe Auftrag Block 3 "Backup/Restore,
// Lizenzsystem, Distribution und Signing-Vorbereitung", Punkt 2-8).
//
// FORMAT (.apbackup): bewusst kein echtes ZIP-Format, um keine zusätzliche
// Archiv-Bibliothek (samt eigener Angriffsfläche, z.B. "Zip-Slip"-Path-
// Traversal-Bugs) einführen zu müssen - stattdessen ein einziges, mit dem in
// Node fest eingebauten zlib gzip-komprimiertes JSON-Dokument: Manifest +
// Datenbank (Base64) + Logo-Dateien (Base64). Das ist technisch einfach,
// transparent (mit "gunzip" + einem Texteditor einsehbar) und robust -
// genau wie im Auftrag gefordert. Da beim Wiederherstellen NIE ein im
// Archiv enthaltener Pfad direkt als Zielpfad verwendet wird (Zieldateiname
// wird immer aus path.basename() des eingebetteten Namens neu gebaut und mit
// einem selbst bestimmten Zielverzeichnis kombiniert), ist Path-Traversal
// strukturell ausgeschlossen (siehe wiederherstellen()).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');

const { getDb, getUserDataDir, getLogosDir, initDatabase } = require('../db');

const BACKUP_FORMAT_VERSION = 1;

function appVersion() {
    try {
        return require('electron').app.getVersion();
    } catch {
        return null;
    }
}

function dbDateiPfad() {
    return path.join(getUserDataDir(), 'rechnung-adressbuch.sqlite');
}

// Erstellt einen konsistenten Snapshot der aktuellen Datenbank (VACUUM INTO
// liefert - anders als reines Kopieren der Datei - auch bei aktivem
// WAL-Modus einen sauberen, sofort nutzbaren Stand) und liest ihn als Buffer
// wieder ein. Die temporäre Snapshot-Datei wird in jedem Fall (auch bei
// Fehlern) wieder entfernt.
function datenbankSnapshotAlsBuffer() {
    const tempPfad = path.join(getUserDataDir(), `.backup-snapshot-${Date.now()}.sqlite`);
    try {
        getDb().prepare('VACUUM INTO ?').run(tempPfad);
        return fs.readFileSync(tempPfad);
    } finally {
        fs.rm(tempPfad, { force: true }, () => {});
    }
}

// Baut das vollständige Backup-Dokument (Manifest + DB + Logos) und schreibt
// es gzip-komprimiert an zielPfad. Räumt bei einem Fehler eine eventuell
// bereits angelegte, unvollständige Zieldatei wieder auf - es soll nie ein
// halbfertiges Backup liegen bleiben (siehe Auftrag Punkt 4).
function erstelleBackup(zielPfad) {
    try {
        const datenbankBuffer = datenbankSnapshotAlsBuffer();

        const logosDir = getLogosDir();
        const logoDateien = fs.existsSync(logosDir)
            ? fs.readdirSync(logosDir).filter((name) => fs.statSync(path.join(logosDir, name)).isFile())
            : [];
        const logos = logoDateien.map((name) => ({
            name,
            data: fs.readFileSync(path.join(logosDir, name)).toString('base64')
        }));

        const manifest = {
            backupFormatVersion: BACKUP_FORMAT_VERSION,
            appVersion: appVersion(),
            createdAt: new Date().toISOString(),
            platform: process.platform,
            databaseFile: 'rechnung-adressbuch.sqlite',
            includedFiles: logos.map((l) => `logos/${l.name}`)
        };

        const dokument = {
            manifest,
            database: datenbankBuffer.toString('base64'),
            logos
        };

        const komprimiert = zlib.gzipSync(Buffer.from(JSON.stringify(dokument)), { level: 9 });

        // Erst in eine temporäre Datei im selben Verzeichnis schreiben und
        // dann atomar umbenennen - so entsteht am Zielpfad selbst nie eine
        // halbfertige Datei, falls das Schreiben mittendrin fehlschlägt
        // (z.B. Speicherplatz voll).
        const tempZiel = `${zielPfad}.tmp`;
        fs.writeFileSync(tempZiel, komprimiert);
        fs.renameSync(tempZiel, zielPfad);

        return { pfad: zielPfad, manifest };
    } catch (err) {
        fs.rm(`${zielPfad}.tmp`, { force: true }, () => {});
        throw new Error(`Backup konnte nicht erstellt werden: ${err.message}`);
    }
}

// Liest und validiert eine Backup-Datei, OHNE irgendetwas an den aktuellen
// Daten zu verändern (siehe Auftrag Punkt 6). Wirft eine verständliche
// Fehlermeldung, wenn die Datei kein gültiges/unterstütztes Backup ist.
function backupLesenUndValidieren(quellPfad) {
    let roh;
    try {
        roh = fs.readFileSync(quellPfad);
    } catch {
        throw new Error('Die Datei konnte nicht gelesen werden.');
    }

    let entpackt;
    try {
        entpackt = zlib.gunzipSync(roh);
    } catch {
        throw new Error('Die Datei ist beschädigt oder kein gültiges Backup-Archiv.');
    }

    let dokument;
    try {
        dokument = JSON.parse(entpackt.toString('utf8'));
    } catch {
        throw new Error('Die Datei ist beschädigt oder kein gültiges Backup-Archiv.');
    }

    const manifest = dokument && dokument.manifest;
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('Die Datei enthält kein gültiges Backup-Manifest.');
    }
    if (manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
        throw new Error(
            `Diese Backup-Version (${manifest.backupFormatVersion}) wird von dieser Programmversion nicht unterstützt.`
        );
    }
    if (typeof dokument.database !== 'string' || !dokument.database) {
        throw new Error('Das Backup enthält keine Datenbank.');
    }
    if (!Array.isArray(dokument.logos)) {
        throw new Error('Das Backup ist beschädigt (Logo-Liste fehlt).');
    }

    // Datenbank-Integrität prüfen, BEVOR irgendetwas an echten Daten
    // verändert wird: an einen temporären Ort schreiben und dort mit SQLites
    // eigener integrity_check-Funktion prüfen.
    const tempDbPfad = path.join(getUserDataDir(), `.restore-check-${Date.now()}.sqlite`);
    let datenbankBuffer;
    try {
        datenbankBuffer = Buffer.from(dokument.database, 'base64');
        fs.writeFileSync(tempDbPfad, datenbankBuffer);
        const testDb = new Database(tempDbPfad, { readonly: true });
        try {
            const ergebnis = testDb.pragma('integrity_check');
            const ok = Array.isArray(ergebnis) && ergebnis.length === 1 && ergebnis[0].integrity_check === 'ok';
            if (!ok) throw new Error('Die Datenbank im Backup besteht die Integritätsprüfung nicht.');

            const anzahlRechnungen = testDb.prepare(
                "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='invoices'"
            ).get().n;
            if (anzahlRechnungen === 0) {
                throw new Error('Die Datenbank im Backup enthält nicht die erwartete Struktur (Tabelle "invoices" fehlt).');
            }
        } finally {
            testDb.close();
        }
    } catch (err) {
        if (err.message.startsWith('Die Datenbank') || err.message.startsWith('Das Backup')) throw err;
        throw new Error('Die Datenbank im Backup ist beschädigt oder unlesbar.');
    } finally {
        fs.rm(tempDbPfad, { force: true }, () => {});
    }

    // Logo-Einträge validieren: nur reine Dateinamen ohne Verzeichnisanteile
    // zulassen (siehe Auftrag Punkt 6 - keine Path-Traversal-Einträge). Ein
    // Eintrag, dessen "name" nach path.basename() nicht mit sich selbst
    // übereinstimmt, enthielt einen Verzeichnisanteil (z.B. "../../etwas")
    // und wird als beschädigt/manipuliert abgelehnt statt still bereinigt -
    // ein manipuliertes Archiv soll auffallen, nicht klammheimlich "repariert"
    // werden.
    for (const logo of dokument.logos) {
        if (typeof logo.name !== 'string' || typeof logo.data !== 'string') {
            throw new Error('Das Backup enthält einen beschädigten Logo-Eintrag.');
        }
        if (path.basename(logo.name) !== logo.name || logo.name === '' || logo.name === '.' || logo.name === '..') {
            throw new Error('Das Backup enthält einen ungültigen Dateipfad und wird zur Sicherheit abgelehnt.');
        }
    }

    return { manifest, dokument, datenbankBuffer };
}

// Führt die eigentliche, geführte Wiederherstellung durch (siehe Auftrag
// Punkt 5). Reihenfolge exakt wie gefordert: validieren -> Sicherheitsbackup
// des AKTUELLEN Zustands -> DB-Verbindung schließen -> Dateien ersetzen ->
// Datenbank neu öffnen (Selbsttest) -> bei jedem Fehler zurückrollen.
function wiederherstellen(quellPfad) {
    const { manifest, dokument, datenbankBuffer } = backupLesenUndValidieren(quellPfad);

    // Sicherheitsbackup des aktuellen Zustands VOR jeder Änderung - erst wenn
    // das erfolgreich war, geht es weiter (siehe Auftrag: "Niemals einfach
    // aktuelle Daten löschen, bevor ein Sicherheitsbackup erfolgreich erstellt
    // wurde").
    const sicherheitsBackupPfad = path.join(
        getUserDataDir(),
        `vor-wiederherstellung-${new Date().toISOString().replace(/[:.]/g, '-')}.apbackup`
    );
    erstelleBackup(sicherheitsBackupPfad);

    const dbPfad = dbDateiPfad();
    const logosDir = getLogosDir();

    // Kontrollierten Datenbankzugriff stoppen, bevor die Datei ersetzt wird -
    // better-sqlite3 hält sonst offene Dateihandles (WAL/SHM) auf die alte Datei.
    try {
        getDb().close();
    } catch {
        // bereits geschlossen oder nie geöffnet - kein Problem
    }

    // Aktuelle Logo-Dateien merken, um im Fehlerfall zurückrollen zu können.
    const bisherigeLogoDateien = fs.existsSync(logosDir) ? fs.readdirSync(logosDir) : [];

    try {
        // Datenbankdatei ersetzen (inkl. eventueller WAL/SHM-Begleitdateien
        // der ALTEN Datenbank entfernen, damit nicht versehentlich alte
        // Journal-Reste mit den neuen Daten vermischt werden). Synchron
        // (fs.rmSync, nicht das asynchrone fs.rm) - die alten Begleitdateien
        // müssen GARANTIERT weg sein, BEVOR die neue Datenbankdatei geschrieben
        // und geöffnet wird, sonst könnte SQLite ein stehengebliebenes
        // WAL-Journal fälschlich gegen die neuen Daten anwenden.
        for (const suffix of ['', '-wal', '-shm', '-journal']) {
            fs.rmSync(`${dbPfad}${suffix}`, { force: true });
        }
        fs.writeFileSync(dbPfad, datenbankBuffer);

        // Logos: erst alle bisherigen entfernen, dann exakt den im Backup
        // enthaltenen Stand herstellen (vollständige Wiederherstellung, kein
        // Vermischen mit dem alten Zustand). Ebenfalls synchron - sonst könnte
        // eine verzögerte asynchrone Löschung eine gerade erst neu
        // geschriebene gleichnamige Logo-Datei wieder entfernen.
        fs.mkdirSync(logosDir, { recursive: true });
        for (const alterName of bisherigeLogoDateien) {
            fs.rmSync(path.join(logosDir, alterName), { force: true });
        }
        for (const logo of dokument.logos) {
            fs.writeFileSync(path.join(logosDir, logo.name), Buffer.from(logo.data, 'base64'));
        }

        // Datenbank neu öffnen (Selbsttest: schlägt initDatabase() fehl, ist
        // der wiederhergestellte Zustand nicht nutzbar).
        initDatabase();

        return { manifest, sicherheitsBackupPfad };
    } catch (err) {
        // Rollback: Sicherheitsbackup zurückspielen. Rekursion ist hier
        // unproblematisch, da das Sicherheitsbackup zuvor bereits erfolgreich
        // validiert wurde (es wurde ja selbst gerade erst von erstelleBackup()
        // erzeugt).
        try {
            const { dokument: alterZustand, datenbankBuffer: alteDatenbank } = backupLesenUndValidieren(sicherheitsBackupPfad);
            fs.writeFileSync(dbPfad, alteDatenbank);
            fs.mkdirSync(logosDir, { recursive: true });
            for (const logo of alterZustand.logos) {
                fs.writeFileSync(path.join(logosDir, logo.name), Buffer.from(logo.data, 'base64'));
            }
            initDatabase();
        } catch (rollbackErr) {
            throw new Error(
                `Wiederherstellung fehlgeschlagen (${err.message}) UND automatisches Zurückrollen fehlgeschlagen ` +
                `(${rollbackErr.message}). Das zuvor erstellte Sicherheitsbackup liegt unter: ${sicherheitsBackupPfad}`
            );
        }
        throw new Error(`Wiederherstellung fehlgeschlagen, ursprünglicher Zustand wurde wiederhergestellt: ${err.message}`);
    }
}

module.exports = { BACKUP_FORMAT_VERSION, erstelleBackup, backupLesenUndValidieren, wiederherstellen };
