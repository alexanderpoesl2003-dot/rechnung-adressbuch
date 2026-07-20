const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Lädt für better-sqlite3 (natives Modul, kann von macOS aus nicht für
// Windows kompiliert werden) das offizielle vorkompilierte Windows-x64-Binary
// für die aktuell verwendete Electron-Version herunter, getrennt vom lokalen
// node_modules/better-sqlite3 (das für "npm start" macOS-nativ bleiben muss).
const PROJECT_ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(PROJECT_ROOT, '.native-cache', 'better-sqlite3-win32-x64');
const ZIEL_DATEI = path.join(CACHE_DIR, 'build', 'Release', 'better_sqlite3.node');

function ermittleElectronVersion() {
    return require(path.join(PROJECT_ROOT, 'node_modules', 'electron', 'package.json')).version;
}

function main() {
    const electronVersion = ermittleElectronVersion();
    console.log(`Lade better-sqlite3-Prebuilt: Windows x64 / Electron ${electronVersion} ...`);

    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    // prebuild-install liest Name/Version aus package.json und die
    // Zielbezeichnung (module_name) aus binding.gyp im Arbeitsverzeichnis.
    for (const datei of ['package.json', 'binding.gyp']) {
        fs.copyFileSync(
            path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3', datei),
            path.join(CACHE_DIR, datei)
        );
    }

    execFileSync(
        path.join(PROJECT_ROOT, 'node_modules', '.bin', 'prebuild-install'),
        ['--runtime=electron', `--target=${electronVersion}`, '--arch=x64', '--platform=win32'],
        { cwd: CACHE_DIR, stdio: 'inherit' }
    );

    if (!fs.existsSync(ZIEL_DATEI)) {
        throw new Error(`Download war scheinbar erfolgreich, aber Datei fehlt: ${ZIEL_DATEI}`);
    }

    console.log('OK, Windows-x64-Binary bereit unter:', ZIEL_DATEI);
}

main();
