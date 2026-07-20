const { BrowserWindow } = require('electron');

// Öffnet ein eigenständiges Fenster mit dem in Chromium eingebauten
// PDF-Viewer (plugins: true) - keine externe PDF-Software nötig. Der Viewer
// bringt eigene Speichern-/Drucken-Symbole in seiner Werkzeugleiste mit.
function oeffneVorschauFenster(pdfPfad, titel) {
    const fenster = new BrowserWindow({
        width: 900,
        height: 1000,
        title: titel || 'PDF-Vorschau',
        webPreferences: { plugins: true }
    });
    fenster.loadURL(`file://${pdfPfad}`);
    return fenster;
}

// Lädt eine PDF-Datei unsichtbar und öffnet direkt den nativen
// System-Druckdialog (kein Umweg über ein externes PDF-Programm).
function druckePdf(pdfPfad) {
    return new Promise((resolve, reject) => {
        const fenster = new BrowserWindow({ show: false, webPreferences: { plugins: true } });
        fenster.webContents.once('did-finish-load', () => {
            fenster.webContents.print({ silent: false }, (erfolgreich, grund) => {
                fenster.close();
                if (erfolgreich || grund === 'cancelled') {
                    resolve();
                } else {
                    reject(new Error(grund || 'Druckvorgang fehlgeschlagen.'));
                }
            });
        });
        fenster.webContents.once('did-fail-load', (event, code, desc) => {
            fenster.close();
            reject(new Error(`PDF konnte nicht geladen werden: ${desc}`));
        });
        fenster.loadURL(`file://${pdfPfad}`);
    });
}

module.exports = { oeffneVorschauFenster, druckePdf };
