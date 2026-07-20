const { getDb } = require('../db');

// Erstellt eine konsistente, eigenständige Kopie der Datenbank an einem frei
// wählbaren Ort. VACUUM INTO liefert (anders als reines Kopieren der Datei)
// auch bei aktivem WAL-Modus einen sauberen, sofort nutzbaren Snapshot.
function erstelleBackup(zielPfad) {
    getDb().prepare('VACUUM INTO ?').run(zielPfad);
    return zielPfad;
}

module.exports = { erstelleBackup };
