const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { initDatabase } = require('./db');
const { registerIpcHandlers } = require('./ipc/register');
const { checkForUpdates } = require('./updater');

let mainWindow = null;

// Bekannter Electron/Windows-Bug: Bei manchen GPU-Treibern bricht die
// Hardware-Beschleunigung den Fokus/Text-Cursor in Inputs, obwohl Klicks auf
// Buttons/Menüs weiterhin funktionieren. Deaktivierung behebt das zuverlässig.
if (process.platform === 'win32') {
    app.disableHardwareAcceleration();
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
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
    initDatabase();
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
