-- Absenderprofile (z.B. "Biohof Pösl", "Maschinengemeinschaft")
CREATE TABLE IF NOT EXISTS sender_profiles (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT NOT NULL,
    briefkopf_name          TEXT NOT NULL,
    logo_pfad               TEXT,
    strasse                 TEXT,
    plz                     TEXT,
    ort                     TEXT,
    telefon                 TEXT,
    email                   TEXT,
    iban                    TEXT,
    bic                     TEXT,
    bank_name               TEXT,
    steuernummer            TEXT,
    ust_id                  TEXT,
    rechnungsnummer_prefix  TEXT NOT NULL DEFAULT 'R',
    naechste_laufnummer     INTEGER NOT NULL DEFAULT 1,
    erstellt_am             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Adressbuch
CREATE TABLE IF NOT EXISTS customers (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    kundennummer             TEXT NOT NULL UNIQUE,
    anrede                   TEXT,
    nachname_firma           TEXT NOT NULL,
    vorname_ansprechpartner  TEXT,
    strasse                  TEXT,
    plz                      TEXT,
    ort                      TEXT,
    kontakt                  TEXT,
    notiz                    TEXT,
    angelegt_am              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Umschaltbare Textbausteine unter der Summenzeile
CREATE TABLE IF NOT EXISTS text_bausteine (
    schluessel  TEXT PRIMARY KEY,
    titel       TEXT NOT NULL,
    inhalt      TEXT NOT NULL
);

INSERT OR IGNORE INTO text_bausteine (schluessel, titel, inhalt) VALUES
    ('geschaeftsbedingungen', 'Geschäftsbedingungen',
     'Zahlbar innerhalb von 14 Tagen ohne Abzug. Es gelten unsere allgemeinen Geschäftsbedingungen. [Platzhalter - bitte durch verbindlichen Text ersetzen.]'),
    ('kaelber_biokreis', 'Kälber-Biokreis-Hinweis',
     'Die gelieferten Kälber stammen aus kontrolliert biologischer Erzeugung gemäß Biokreis-Richtlinien. [Platzhalter - bitte durch verbindlichen Text ersetzen.]');

-- Rechnungen
CREATE TABLE IF NOT EXISTS invoices (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_profile_id         INTEGER NOT NULL REFERENCES sender_profiles(id),
    customer_id               INTEGER NOT NULL REFERENCES customers(id),
    rechnungsnummer           TEXT NOT NULL UNIQUE,
    rechnungsdatum            TEXT NOT NULL,
    leistungsdatum            TEXT,
    text_baustein_schluessel  TEXT REFERENCES text_bausteine(schluessel),
    status                    TEXT NOT NULL DEFAULT 'entwurf',
    erstellt_am               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rechnungspositionen
CREATE TABLE IF NOT EXISTS invoice_positions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id          INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL,
    artikel_nr          TEXT,
    bezeichnung         TEXT NOT NULL,
    menge               REAL NOT NULL DEFAULT 1,
    einzelpreis_netto   REAL NOT NULL DEFAULT 0,
    mwst_satz           REAL NOT NULL DEFAULT 19
);

CREATE INDEX IF NOT EXISTS idx_invoices_profile ON invoices(sender_profile_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_positions_invoice ON invoice_positions(invoice_id);

-- Artikel-Stammdaten
CREATE TABLE IF NOT EXISTS artikel (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    artikel_nr             TEXT NOT NULL UNIQUE,
    bezeichnung             TEXT NOT NULL,
    verkaufspreis_netto    REAL NOT NULL DEFAULT 0,
    einkaufspreis_netto    REAL,
    mwst_satz              REAL NOT NULL DEFAULT 19,
    warenbestand           REAL,
    mindestmenge           REAL,
    erstellt_am            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Getrennt fortlaufende Nummernkreise je Absenderprofil und Belegtyp
-- (Angebot, Lieferschein, Auftragsbestätigung, Mahnung, Korrektur-Rechnung).
-- Die Rechnungsnummer selbst bleibt unangetastet in sender_profiles geregelt.
CREATE TABLE IF NOT EXISTS beleg_zaehler (
    sender_profile_id  INTEGER NOT NULL REFERENCES sender_profiles(id),
    typ                 TEXT NOT NULL,
    prefix              TEXT NOT NULL,
    naechste_nummer     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (sender_profile_id, typ)
);

-- Weitere Belegarten: Angebot, Lieferschein, Auftragsbestätigung, Mahnung, Korrektur-Rechnung
CREATE TABLE IF NOT EXISTS belege (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    typ                       TEXT NOT NULL,
    sender_profile_id         INTEGER NOT NULL REFERENCES sender_profiles(id),
    customer_id               INTEGER NOT NULL REFERENCES customers(id),
    belegnummer               TEXT NOT NULL,
    belegdatum                TEXT NOT NULL,
    bezug_invoice_id          INTEGER REFERENCES invoices(id),
    mahntext                  TEXT,
    text_baustein_schluessel  TEXT REFERENCES text_bausteine(schluessel),
    status                    TEXT NOT NULL DEFAULT 'entwurf',
    erstellt_am               TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(typ, belegnummer)
);

CREATE TABLE IF NOT EXISTS beleg_positionen (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    beleg_id            INTEGER NOT NULL REFERENCES belege(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL,
    artikel_nr          TEXT,
    bezeichnung         TEXT NOT NULL,
    menge               REAL NOT NULL DEFAULT 1,
    einzelpreis_netto   REAL NOT NULL DEFAULT 0,
    mwst_satz           REAL NOT NULL DEFAULT 19
);

CREATE INDEX IF NOT EXISTS idx_belege_profile ON belege(sender_profile_id);
CREATE INDEX IF NOT EXISTS idx_belege_customer ON belege(customer_id);
CREATE INDEX IF NOT EXISTS idx_belege_typ ON belege(typ);
CREATE INDEX IF NOT EXISTS idx_beleg_positionen_beleg ON beleg_positionen(beleg_id);

-- Notizen mit Priorität und Fälligkeit, optional einem Kunden zugeordnet
CREATE TABLE IF NOT EXISTS notizen (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id  INTEGER REFERENCES customers(id),
    text         TEXT NOT NULL,
    prioritaet   INTEGER NOT NULL DEFAULT 3,
    faellig_am   TEXT,
    erledigt     INTEGER NOT NULL DEFAULT 0,
    erstellt_am  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notizen_customer ON notizen(customer_id);

-- Freie Schlüssel/Wert-Einstellungen (u.a. Passwort-Hash)
CREATE TABLE IF NOT EXISTS einstellungen (
    schluessel  TEXT PRIMARY KEY,
    wert        TEXT
);

-- Selbstlernende PLZ-zu-Ort-Zuordnung: wird bei jedem Speichern eines Kunden
-- aktualisiert und schlägt bei neuer PLZ-Eingabe den zuletzt bekannten Ort vor.
CREATE TABLE IF NOT EXISTS plz_orte (
    plz  TEXT PRIMARY KEY,
    ort  TEXT NOT NULL
);

-- Frei konfigurierbare MwSt-Sätze je Absenderprofil (Standard: 7 / 7,8 / 19 %)
CREATE TABLE IF NOT EXISTS mwst_saetze (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_profile_id  INTEGER NOT NULL REFERENCES sender_profiles(id),
    satz               REAL NOT NULL,
    bezeichnung        TEXT,
    UNIQUE(sender_profile_id, satz)
);

-- Mehrfachauswahl von Textbausteinen je Rechnung/Beleg (löst die ältere
-- Einzelauswahl über invoices.text_baustein_schluessel / belege.text_baustein_schluessel ab,
-- diese Spalten bleiben aus Kompatibilitätsgründen additiv erhalten).
CREATE TABLE IF NOT EXISTS invoice_textbausteine (
    invoice_id                INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    text_baustein_schluessel  TEXT NOT NULL REFERENCES text_bausteine(schluessel),
    PRIMARY KEY (invoice_id, text_baustein_schluessel)
);

CREATE TABLE IF NOT EXISTS beleg_textbausteine (
    beleg_id                  INTEGER NOT NULL REFERENCES belege(id) ON DELETE CASCADE,
    text_baustein_schluessel  TEXT NOT NULL REFERENCES text_bausteine(schluessel),
    PRIMARY KEY (beleg_id, text_baustein_schluessel)
);

-- Kleine, technische Ereignis-Historie zu Rechnungen (kein vollständiges
-- Audit-System). Wird per ON DELETE CASCADE automatisch mitgelöscht, falls
-- ein Entwurf (der einzige Status, der überhaupt hart gelöscht werden darf)
-- entfernt wird - finalisierte Rechnungen können nicht gelöscht werden
-- (siehe invoices.js), ihre Historie bleibt also immer erhalten.
CREATE TABLE IF NOT EXISTS invoice_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    details     TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoice_history_invoice ON invoice_history(invoice_id);
