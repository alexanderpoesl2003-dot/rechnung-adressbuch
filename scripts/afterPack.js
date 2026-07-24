const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// electron-builder ermittelt "production dependencies" für node_modules über
// einen eigenen Abhängigkeits-Scanner statt einfach die files-Konfiguration
// zu befolgen. Bei bestimmten mehrfach verschachtelten/deduplizierten
// Paketstrukturen (z.B. node_modules/call-bind/node_modules/call-bind-apply-helpers
// UND node_modules/call-bind-apply-helpers gleichzeitig) übersieht dieser
// Scanner nachweislich die oberste, per Node-Modulauflösung eigentlich
// benötigte Kopie eines *echten* production dependency - selbst wenn das
// Paket gar nirgends sonst im Build vorhanden ist.
//
// Dieser Hook ermittelt deshalb über "npm ls --omit=dev" die verbindliche
// Liste aller production dependencies (inkl. verschachtelter Kopien) und
// kopiert genau diese nach, falls sie im Build fehlen - inklusive fehlender
// Top-Level-Pakete. Alles andere (insbesondere devDependencies wie
// "electron"/"electron-builder" mit ihren eigenen Build-Werkzeugen) wird
// bewusst NICHT nachkopiert, um die App nicht unnötig aufzublähen.
module.exports = async function afterPack(context) {
    const projectRoot = path.join(__dirname, '..');
    const quelle = path.join(projectRoot, 'node_modules');
    const ziel = ermittleAppNodeModulesVerzeichnis(context);

    if (!fs.existsSync(quelle) || !fs.existsSync(ziel)) return;

    const whitelist = ermittleProductionPfade(projectRoot);

    let kopiert = 0;
    for (const relPfad of whitelist) {
        const quellPfad = path.join(quelle, relPfad);
        const zielPfad = path.join(ziel, relPfad);
        if (fs.existsSync(quellPfad) && !fs.existsSync(zielPfad)) {
            fs.mkdirSync(path.dirname(zielPfad), { recursive: true });
            fs.cpSync(quellPfad, zielPfad, { recursive: true });
            kopiert++;
        }
    }

    // Zusätzlich innerhalb bereits vorhandener Pakete verbliebene Einzeldateien
    // auffüllen (z.B. einzelne .js-Dateien, die der Scanner innerhalb eines
    // ansonsten korrekt erkannten Pakets ausgelassen hat).
    for (const relPfad of whitelist) {
        const quellPfad = path.join(quelle, relPfad);
        const zielPfad = path.join(ziel, relPfad);
        if (fs.existsSync(quellPfad) && fs.existsSync(zielPfad) && fs.statSync(quellPfad).isDirectory()) {
            kopiert += ergaenzeFehlendeDateien(quellPfad, zielPfad);
        }
    }

    console.log(`afterPack: ${kopiert} fehlende production-dependency-Pfad(e) nachkopiert (Whitelist-Größe: ${whitelist.length}).`);

    // better-sqlite3 ist ein natives Modul und kann von macOS aus nicht für
    // Windows kompiliert werden - das oben kopierte better_sqlite3.node stammt
    // aus dem lokalen (macOS-)node_modules und ist für Windows unbrauchbar.
    // Es wird hier durch das echte, per "npm run prep:win-native" separat
    // heruntergeladene Windows-x64-Prebuilt ersetzt.
    if (context.electronPlatformName === 'win32') {
        const winNativeDatei = path.join(
            projectRoot, '.native-cache', 'better-sqlite3-win32-x64', 'build', 'Release', 'better_sqlite3.node'
        );
        const zielNativeDatei = path.join(ziel, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

        if (!fs.existsSync(winNativeDatei)) {
            throw new Error(
                `Windows-x64-Prebuilt für better-sqlite3 fehlt (${winNativeDatei}). ` +
                'Vorher "npm run prep:win-native" ausführen.'
            );
        }

        fs.mkdirSync(path.dirname(zielNativeDatei), { recursive: true });
        fs.copyFileSync(winNativeDatei, zielNativeDatei);
        console.log('afterPack: better_sqlite3.node durch echtes Windows-x64-Prebuilt ersetzt.');
    }
};

// Auf macOS liegt das node_modules-Verzeichnis der App verschachtelt im
// .app-Bundle ("<Produktname>.app/Contents/Resources/app/node_modules"),
// nicht flach wie bei Windows/Linux ("resources/app/node_modules"). Ohne
// diese Fallunterscheidung fand der obige Nachkopier-Fix auf dem Mac schlicht
// kein Zielverzeichnis und griff dadurch gar nicht - Folge: fehlende
// production dependencies (z.B. "call-bind-apply-helpers") führten beim
// Start der gepackten Mac-App zu "Cannot find module ...".
function ermittleAppNodeModulesVerzeichnis(context) {
    if (context.electronPlatformName === 'darwin') {
        const productFilename = context.packager.appInfo.productFilename;
        return path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'Resources', 'app', 'node_modules');
    }
    return path.join(context.appOutDir, 'resources', 'app', 'node_modules');
}

// Liefert alle production-dependency-Verzeichnisse relativ zu node_modules/,
// inklusive verschachtelter Kopien (z.B. "call-bind/node_modules/call-bind-apply-helpers").
function ermittleProductionPfade(projectRoot) {
    const ausgabe = execFileSync(
        'npm', ['ls', '--omit=dev', '--all', '--parseable'],
        { cwd: projectRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 }
    );
    const nodeModulesPrefix = path.join(projectRoot, 'node_modules') + path.sep;
    return ausgabe
        .split('\n')
        .map((zeile) => zeile.trim())
        .filter((zeile) => zeile.startsWith(nodeModulesPrefix))
        .map((zeile) => zeile.slice(nodeModulesPrefix.length));
}

function ergaenzeFehlendeDateien(quellVerzeichnis, zielVerzeichnis) {
    let anzahl = 0;
    for (const eintrag of fs.readdirSync(quellVerzeichnis, { withFileTypes: true })) {
        const quellPfad = path.join(quellVerzeichnis, eintrag.name);
        const zielPfad = path.join(zielVerzeichnis, eintrag.name);

        if (eintrag.isDirectory()) {
            // Verschachtelte node_modules-Unterordner werden bereits über die
            // Whitelist selbst behandelt - hier nur "normale" Paket-Unterordner
            // (z.B. lib/, dist/) rekursiv ergänzen, keine node_modules erzeugen.
            if (eintrag.name === 'node_modules') continue;
            if (!fs.existsSync(zielPfad)) {
                fs.cpSync(quellPfad, zielPfad, { recursive: true });
                anzahl++;
            } else {
                anzahl += ergaenzeFehlendeDateien(quellPfad, zielPfad);
            }
        } else if (!fs.existsSync(zielPfad)) {
            fs.cpSync(quellPfad, zielPfad);
            anzahl++;
        }
    }
    return anzahl;
}
