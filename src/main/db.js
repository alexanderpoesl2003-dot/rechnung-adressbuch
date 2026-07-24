const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { BELEG_TYPEN } = require('./beleg-typen');

let db = null;

function getUserDataDir() {
    const { app } = require('electron');
    return app.getPath('userData');
}

function getLogosDir() {
    const dir = path.join(getUserDataDir(), 'logos');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function initDatabase() {
    const userDataDir = getUserDataDir();
    fs.mkdirSync(userDataDir, { recursive: true });
    getLogosDir();

    const dbPath = path.join(userDataDir, 'rechnung-adressbuch.sqlite');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);

    runMigrations();
    seedDefaultProfiles();
    seedBelegZaehler();
    seedMwstSaetze();

    return db;
}

// Additive Spalten-Migrationen. SQLite kennt kein "ADD COLUMN IF NOT EXISTS",
// daher wird der Ist-Zustand vorher per PRAGMA geprüft, um die App auch bei
// bereits existierenden Datenbanken gefahrlos neu starten zu können.
function runMigrations() {
    addSpalteFallsFehlt('invoices', 'bezahlt', 'INTEGER NOT NULL DEFAULT 0');
    addSpalteFallsFehlt('invoices', 'bezahlt_am', 'TEXT');
    addSpalteFallsFehlt('invoices', 'bezahlt_betrag', 'REAL');
    addSpalteFallsFehlt('invoices', 'extra_text', 'TEXT');
    addSpalteFallsFehlt('invoices', 'freier_text', 'TEXT');
    addSpalteFallsFehlt('invoices', 'leistungsdatum', 'TEXT');
    addSpalteFallsFehlt('belege', 'extra_text', 'TEXT');
    addSpalteFallsFehlt('belege', 'freier_text', 'TEXT');
}

function addSpalteFallsFehlt(tabelle, spalte, definition) {
    const spalten = db.prepare(`PRAGMA table_info(${tabelle})`).all().map((s) => s.name);
    if (!spalten.includes(spalte)) {
        db.exec(`ALTER TABLE ${tabelle} ADD COLUMN ${spalte} ${definition}`);
    }
}

const STANDARD_MWST_SAETZE = [
    { satz: 7, bezeichnung: 'ermäßigt' },
    { satz: 7.8, bezeichnung: 'Land-/Forstwirtschaft (§24 UStG)' },
    { satz: 19, bezeichnung: 'Standard' }
];

// Legt für jedes Absenderprofil die drei Standard-MwSt-Sätze an, falls noch
// keine Sätze existieren (eigene/gelöschte Sätze werden nicht überschrieben).
function seedMwstSaetze() {
    const profile = db.prepare('SELECT id FROM sender_profiles').all();
    const insert = db.prepare(`
        INSERT OR IGNORE INTO mwst_saetze (sender_profile_id, satz, bezeichnung) VALUES (?, ?, ?)
    `);
    for (const p of profile) {
        const anzahl = db.prepare('SELECT COUNT(*) AS n FROM mwst_saetze WHERE sender_profile_id = ?').get(p.id).n;
        if (anzahl > 0) continue;
        for (const s of STANDARD_MWST_SAETZE) {
            insert.run(p.id, s.satz, s.bezeichnung);
        }
    }
}

// Legt für jedes Absenderprofil und jede Belegart (außer Rechnung) einen
// Nummernkreis an, falls noch keiner existiert.
function seedBelegZaehler() {
    const profile = db.prepare('SELECT id FROM sender_profiles').all();
    const insert = db.prepare(`
        INSERT OR IGNORE INTO beleg_zaehler (sender_profile_id, typ, prefix, naechste_nummer)
        VALUES (?, ?, ?, 1)
    `);
    for (const p of profile) {
        for (const [typ, def] of Object.entries(BELEG_TYPEN)) {
            insert.run(p.id, typ, def.prefix);
        }
    }
}

function seedDefaultProfiles() {
    const count = db.prepare('SELECT COUNT(*) AS n FROM sender_profiles').get().n;
    if (count > 0) return;

    const insert = db.prepare(`
        INSERT INTO sender_profiles
            (name, briefkopf_name, rechnungsnummer_prefix, naechste_laufnummer)
        VALUES (@name, @briefkopf_name, @rechnungsnummer_prefix, @naechste_laufnummer)
    `);

    insert.run({
        name: 'Biohof Pösl',
        briefkopf_name: 'Biohof Pösl',
        rechnungsnummer_prefix: 'R',
        naechste_laufnummer: 91
    });

    insert.run({
        name: 'Maschinengemeinschaft',
        briefkopf_name: 'Maschinengemeinschaft',
        rechnungsnummer_prefix: 'R',
        naechste_laufnummer: 1
    });
}

function getDb() {
    if (!db) throw new Error('Datenbank ist noch nicht initialisiert.');
    return db;
}

module.exports = { initDatabase, getDb, getLogosDir, getUserDataDir };
