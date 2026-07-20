const { app } = require('electron');

let autoUpdaterInstanz = null;

// Liefert den (einmalig konfigurierten) autoUpdater. Sowohl der automatische
// Start-Check als auch der manuelle Check aus den Einstellungen teilen sich
// dieselbe Instanz und denselben "error"-Logger.
function getAutoUpdater() {
    if (!autoUpdaterInstanz) {
        autoUpdaterInstanz = require('electron-updater').autoUpdater;
        autoUpdaterInstanz.autoDownload = true;
        autoUpdaterInstanz.on('error', (err) => {
            console.error('Auto-Update-Fehler:', err.message);
        });
    }
    return autoUpdaterInstanz;
}

// Prüft beim Programmstart automatisch auf neue Versionen und installiert sie
// im Hintergrund. Der Nutzer muss dazu nichts manuell herunterladen oder
// ausführen - electron-updater fragt nach dem Download lediglich per
// Dialog, ob jetzt neu gestartet werden soll, um das Update zu übernehmen.
//
// Setzt voraus, dass unter package.json -> build.publish Releases über den
// dort konfigurierten Provider (GitHub) veröffentlicht werden - siehe README.
function checkForUpdates() {
    if (!app.isPackaged) return; // Im Entwicklungsmodus (npm start) gibt es keinen Update-Feed

    getAutoUpdater().checkForUpdatesAndNotify().catch((err) => {
        console.error('Update-Prüfung fehlgeschlagen:', err.message);
    });
}

// Manuelle Update-Prüfung (Button in den Einstellungen). Liefert das Ergebnis
// direkt an die UI zurück, damit sofort sichtbar ist, ob ein Update gefunden
// wurde - statt wie beim Start-Check nur auf die System-Benachrichtigung zu warten.
function checkForUpdatesManuell() {
    if (!app.isPackaged) {
        return Promise.resolve({ status: 'dev-mode' });
    }

    const updater = getAutoUpdater();

    return new Promise((resolve) => {
        const cleanup = () => {
            updater.removeListener('update-available', onAvailable);
            updater.removeListener('update-not-available', onNotAvailable);
            updater.removeListener('error', onError);
        };
        const onAvailable = (info) => { cleanup(); resolve({ status: 'available', version: info.version }); };
        const onNotAvailable = () => { cleanup(); resolve({ status: 'not-available' }); };
        const onError = (err) => { cleanup(); resolve({ status: 'error', message: err.message }); };

        updater.once('update-available', onAvailable);
        updater.once('update-not-available', onNotAvailable);
        updater.once('error', onError);

        updater.checkForUpdates().catch((err) => {
            cleanup();
            resolve({ status: 'error', message: err.message });
        });
    });
}

module.exports = { checkForUpdates, checkForUpdatesManuell };
