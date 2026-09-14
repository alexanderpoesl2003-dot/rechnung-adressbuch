const { app, BrowserWindow, Menu, MenuItem } = require('electron');
const path = require('path');
const { initDatabase } = require('./db');
const { registerIpcHandlers } = require('./ipc/register');
const { checkForUpdates } = require('./updater');
const { migriereSmtpPasswortFallsNoetig } = require('./services/rechnung-versand');
const { autoBackupFallsFaelligAusfuehren } = require('./services/auto-backup');

let mainWindow = null;

// Bekannter Electron/Windows-Bug: Bei manchen GPU-Treibern bricht die
// Hardware-Beschleunigung den Fokus/Text-Cursor in Inputs, obwohl Klicks auf
// Buttons/Menüs weiterhin funktionieren (Klick landet, aber kein Cursor
// blinkt, Tippen bleibt wirkungslos). app.disableHardwareAcceleration()
// alleine reicht auf manchen Geräten/Treiberversionen nicht aus - die beiden
// zusätzlichen Chromium-Schalter unten sind der verbreitete Rest der
// Community-Lösung für genau dieses Symptom. Nur für Windows, macOS ist
// davon nicht betroffen. Muss vor app.whenReady() gesetzt werden.
if (process.platform === 'win32') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'AP Rechnungstool',
        icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    Menu.setApplicationMenu(null);

    // Bugfix "Rechtsklick geht nicht (Einfügen)": Electron bringt anders als
    // ein normaler Browser KEIN eingebautes Rechtsklick-Kontextmenü mit (auch
    // nicht für einfache Textfelder) - ohne diesen Handler passiert bei einem
    // Rechtsklick schlicht gar nichts, "Einfügen" war also nie erreichbar.
    // Zeigt je nach Feldtyp/Auswahl ein passendes Menü (Ausschneiden/Kopieren/
    // Einfügen/Alles auswählen für Eingabefelder, Kopieren für reinen Text).
    mainWindow.webContents.on('context-menu', (_event, params) => {
        const menu = new Menu();

        if (params.isEditable) {
            menu.append(new MenuItem({ label: 'Ausschneiden', role: 'cut', enabled: params.editFlags.canCut }));
            menu.append(new MenuItem({ label: 'Kopieren', role: 'copy', enabled: params.editFlags.canCopy }));
            menu.append(new MenuItem({ label: 'Einfügen', role: 'paste', enabled: params.editFlags.canPaste }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ label: 'Alles auswählen', role: 'selectAll', enabled: params.editFlags.canSelectAll }));
        } else if (params.selectionText) {
            menu.append(new MenuItem({ label: 'Kopieren', role: 'copy' }));
        } else {
            return; // kein Eingabefeld, keine Auswahl - kein Menü nötig
        }

        menu.popup();
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
    initDatabase();
    // Einmalige, gefahrlos wiederholbare Migration eines noch vorhandenen
    // Klartext-SMTP-Passworts auf sichere Speicherung (siehe Auftrag "SMTP-
    // Sicherheit, Secret-Handling und IPC-Härtung") - läuft bei jedem Start,
    // analog zu den Datenbank-Migrationen in initDatabase().
    migriereSmtpPasswortFallsNoetig();
    // Einfache Prüfung "wann war das letzte automatische Backup" bei jedem
    // Start - kein Scheduler (siehe Auftrag Block 3, Punkt 7).
    autoBackupFallsFaelligAusfuehren();
    registerIpcHandlers();
    createWindow();
    checkForUpdates();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
