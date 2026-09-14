// Erzeugt einen neuen, gültigen Produktschlüssel - komplett offline, kein
// Server nötig (siehe src/main/services/lizenz.js für die Funktionsweise).
// Braucht lizenz-geheimnis.local.json im Projekt-Wurzelverzeichnis (liegt
// NICHT im Git-Repo, siehe .gitignore) - ohne diese Datei kann weder dieses
// Skript noch die App selbst Schlüssel erzeugen/prüfen.
//
// Aufruf (aus dem Projektverzeichnis):
//     node scripts/lizenz-schluessel-erzeugen.js <Seriennummer> ["Bezeichnung"]
//
// Die Seriennummer wählst du selbst (z.B. einfach hochzählen: 1, 2, 3, ...)
// - sie dient nur zur eigenen Übersicht/späteren Sperrbarkeit (siehe
// GESPERRTE_SERIENNUMMERN in lizenz.js), hat sonst keine Funktion. Dieselbe
// Seriennummer erzeugt IMMER denselben Schlüssel - für zwei verschiedene
// Empfänger also unterschiedliche Seriennummern verwenden.
const path = require('path');

const seriennummerText = process.argv[2];
const bezeichnung = process.argv[3] || '';

if (!seriennummerText) {
    console.error('Bitte eine Seriennummer angeben, z.B.:');
    console.error('  node scripts/lizenz-schluessel-erzeugen.js 1 "Papa"');
    process.exit(1);
}

const seriennummer = Number(seriennummerText);

// electron-Modul wird von lizenz.js nur für app.getAppPath() gebraucht -
// hier (reines Node-Skript, kein Electron-Prozess) reicht ein einfacher
// Ersatz, der direkt auf das Projekt-Wurzelverzeichnis zeigt.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return { app: { getAppPath: () => path.join(__dirname, '..') } };
    }
    return originalLoad.apply(this, arguments);
};

const lizenz = require('../src/main/services/lizenz');

try {
    const schluessel = lizenz.schluesselErzeugen(seriennummer);
    console.log('');
    console.log(`Seriennummer: ${seriennummer}${bezeichnung ? ` (${bezeichnung})` : ''}`);
    console.log(`Schlüssel:    ${schluessel}`);
    console.log('');
} catch (err) {
    console.error('Fehler:', err.message);
    process.exit(1);
}
