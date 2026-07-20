const { getDb } = require('../db');
const { BELEG_TYPEN } = require('../beleg-typen');
const mwstSaetze = require('./mwst-saetze');

function list() {
    return getDb().prepare('SELECT * FROM sender_profiles ORDER BY name').all();
}

function get(id) {
    return getDb().prepare('SELECT * FROM sender_profiles WHERE id = ?').get(id);
}

function create(data) {
    const stmt = getDb().prepare(`
        INSERT INTO sender_profiles
            (name, briefkopf_name, logo_pfad, strasse, plz, ort, telefon, email,
             iban, bic, bank_name, steuernummer, ust_id,
             rechnungsnummer_prefix, naechste_laufnummer)
        VALUES
            (@name, @briefkopf_name, @logo_pfad, @strasse, @plz, @ort, @telefon, @email,
             @iban, @bic, @bank_name, @steuernummer, @ust_id,
             @rechnungsnummer_prefix, @naechste_laufnummer)
    `);
    const info = stmt.run(normalize(data));
    seedBelegZaehlerFuerProfil(info.lastInsertRowid);
    mwstSaetze.seedFuerProfil(info.lastInsertRowid);
    return get(info.lastInsertRowid);
}

function seedBelegZaehlerFuerProfil(profileId) {
    const insert = getDb().prepare(`
        INSERT OR IGNORE INTO beleg_zaehler (sender_profile_id, typ, prefix, naechste_nummer)
        VALUES (?, ?, ?, 1)
    `);
    for (const [typ, def] of Object.entries(BELEG_TYPEN)) {
        insert.run(profileId, typ, def.prefix);
    }
}

function update(id, data) {
    const stmt = getDb().prepare(`
        UPDATE sender_profiles SET
            name = @name,
            briefkopf_name = @briefkopf_name,
            logo_pfad = @logo_pfad,
            strasse = @strasse,
            plz = @plz,
            ort = @ort,
            telefon = @telefon,
            email = @email,
            iban = @iban,
            bic = @bic,
            bank_name = @bank_name,
            steuernummer = @steuernummer,
            ust_id = @ust_id,
            rechnungsnummer_prefix = @rechnungsnummer_prefix,
            naechste_laufnummer = @naechste_laufnummer
        WHERE id = @id
    `);
    stmt.run({ ...normalize(data), id });
    return get(id);
}

function remove(id) {
    const rechnungenCount = getDb()
        .prepare('SELECT COUNT(*) AS n FROM invoices WHERE sender_profile_id = ?')
        .get(id).n;
    if (rechnungenCount > 0) {
        throw new Error(
            'Profil kann nicht gelöscht werden, da bereits Rechnungen mit diesem Profil existieren.'
        );
    }
    getDb().prepare('DELETE FROM sender_profiles WHERE id = ?').run(id);
}

function normalize(data) {
    return {
        name: data.name,
        briefkopf_name: data.briefkopf_name || data.name,
        logo_pfad: data.logo_pfad || null,
        strasse: data.strasse || null,
        plz: data.plz || null,
        ort: data.ort || null,
        telefon: data.telefon || null,
        email: data.email || null,
        iban: data.iban || null,
        bic: data.bic || null,
        bank_name: data.bank_name || null,
        steuernummer: data.steuernummer || null,
        ust_id: data.ust_id || null,
        rechnungsnummer_prefix: data.rechnungsnummer_prefix || 'R',
        naechste_laufnummer: Number.isFinite(Number(data.naechste_laufnummer))
            ? Number(data.naechste_laufnummer)
            : 1
    };
}

// Erzeugt die nächste Rechnungsnummer für ein Profil im Format R[JJ]-[laufende Nummer]
// und erhöht den Zähler. Muss innerhalb derselben Transaktion wie die Rechnungserstellung
// aufgerufen werden, damit die Nummer nicht "verloren geht".
function reserveNextRechnungsnummer(profileId, rechnungsdatum) {
    const profile = get(profileId);
    if (!profile) throw new Error('Absenderprofil nicht gefunden.');

    const jahr = new Date(rechnungsdatum).getFullYear();
    const jj = String(jahr % 100).padStart(2, '0');
    const laufnummer = String(profile.naechste_laufnummer).padStart(4, '0');
    const rechnungsnummer = `${profile.rechnungsnummer_prefix}${jj}-${laufnummer}`;

    getDb()
        .prepare('UPDATE sender_profiles SET naechste_laufnummer = naechste_laufnummer + 1 WHERE id = ?')
        .run(profileId);

    return rechnungsnummer;
}

module.exports = { list, get, create, update, remove, reserveNextRechnungsnummer };
