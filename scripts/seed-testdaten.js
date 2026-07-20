// Legt einmalig realistische Testdaten an (mehrere Kunden, Rechnungen über
// beide vorhandenen Absenderprofile und unterschiedliche Zeiträume), damit
// Statistik/Auswertung und Kundendetailansicht sinnvoll befüllt sind.
//
// Läuft als eigener Electron-Prozess (nicht mit "node", da better-sqlite3
// für die Electron-ABI gebaut ist) auf derselben lokalen Datenbank wie die App:
//   ./node_modules/.bin/electron scripts/seed-testdaten.js
//
// Rein lokal für Testzwecke - die Datenbank (*.sqlite) ist in .gitignore und
// wird nicht committet/gepusht.
const path = require('path');
const { app } = require('electron');
const { initDatabase } = require('../src/main/db');
const profiles = require('../src/main/models/profiles');
const customers = require('../src/main/models/customers');
const invoices = require('../src/main/models/invoices');
const settings = require('../src/main/models/settings');
const pkg = require('../package.json');

const SEED_MARKER = 'testdaten_v1_angelegt_am';

// Electron leitet den userData-Ordner normalerweise aus dem Namen in
// package.json ab - das schlägt aber fehl, wenn Electron (wie hier) direkt
// mit einem Skriptpfad statt dem Projektordner gestartet wird ("electron
// scripts/seed-testdaten.js" statt "electron ."). Ohne diese Zeile würde
// das Skript sonst eine andere, leere Datenbank befüllen als die App selbst
// (die immer mit "electron ." bzw. "npm start" läuft).
app.setName(pkg.name);
app.setPath('userData', path.join(app.getPath('appData'), pkg.name));

if (process.platform === 'darwin' && app.dock) app.dock.hide();

app.whenReady().then(() => {
    initDatabase();

    const bereitsAngelegt = settings.getWert(SEED_MARKER);
    if (bereitsAngelegt) {
        console.log(`Testdaten wurden bereits am ${bereitsAngelegt} angelegt - überspringe (keine Duplikate).`);
        app.exit(0);
        return;
    }

    const alleProfile = profiles.list();
    if (alleProfile.length < 2) {
        console.error('Es sind weniger als 2 Absenderprofile vorhanden. Testdaten benötigen mindestens 2 Profile.');
        app.exit(1);
        return;
    }
    const [profilA, profilB] = alleProfile;

    const kundenDaten = [
        { anrede: 'Firma', nachname_firma: 'Sennerei Huber GmbH', vorname_ansprechpartner: 'Andreas Huber', strasse: 'Almweg 4', plz: '83022', ort: 'Rosenheim', kontakt: 'huber@sennerei-huber.de' },
        { anrede: 'Firma', nachname_firma: 'Landgasthof Zur Post', vorname_ansprechpartner: 'Maria Steiner', strasse: 'Marktplatz 1', plz: '83278', ort: 'Traunstein', kontakt: 'info@gasthof-zurpost.de' },
        { anrede: 'Firma', nachname_firma: 'Biomarkt Grünwald', vorname_ansprechpartner: 'Julia Lang', strasse: 'Wiesenstr. 12', plz: '82031', ort: 'Grünwald', kontakt: 'einkauf@biomarkt-gruenwald.de' },
        { anrede: 'Herr', nachname_firma: 'Wagner', vorname_ansprechpartner: 'Thomas Wagner', strasse: 'Dorfstr. 8', plz: '83334', ort: 'Inzell', kontakt: 'th.wagner@web.de' },
        { anrede: 'Firma', nachname_firma: 'Agrargenossenschaft Chiemgau eG', vorname_ansprechpartner: 'Stefan Bauer', strasse: 'Gewerbering 9', plz: '83224', ort: 'Grassau', kontakt: 'kontakt@agrar-chiemgau.de' }
    ];
    const kunden = kundenDaten.map((k) => customers.create(k));
    const [huber, gasthof, biomarkt, wagner, agrar] = kunden;

    function neueRechnung({ profil, kunde, datum, status, bezahlt, positionen, extraText }) {
        const erstellt = invoices.create({
            sender_profile_id: profil.id,
            customer_id: kunde.id,
            rechnungsdatum: datum,
            status: status || 'entwurf',
            extra_text: extraText || null,
            positionen
        });
        if (bezahlt) {
            invoices.markBezahlt(erstellt.id, { bezahlt: true, bezahltAm: datum });
        }
        return erstellt;
    }

    // Vergangenes Jahr (2025) - fünf Rechnungen über beide Profile
    neueRechnung({
        profil: profilA, kunde: huber, datum: '2025-01-14', status: 'versendet', bezahlt: true,
        positionen: [
            { bezeichnung: 'Kartoffeln, 25kg-Sack', menge: 40, einzelpreis_netto: 12.5, mwst_satz: 7 },
            { bezeichnung: 'Frische Eier, 10er-Palette', menge: 15, einzelpreis_netto: 3.2, mwst_satz: 7 }
        ]
    });
    neueRechnung({
        profil: profilB, kunde: gasthof, datum: '2025-04-02', status: 'versendet', bezahlt: true,
        positionen: [
            { bezeichnung: 'Traktor-Miete inkl. Fahrer, Stunde', menge: 6, einzelpreis_netto: 55, mwst_satz: 19 },
            { bezeichnung: 'Grasschnitt Wiese, ha', menge: 2, einzelpreis_netto: 90, mwst_satz: 19 }
        ]
    });
    neueRechnung({
        profil: profilA, kunde: biomarkt, datum: '2025-06-20', status: 'entwurf', bezahlt: false,
        positionen: [
            { bezeichnung: 'Heu, Rundballen', menge: 20, einzelpreis_netto: 18, mwst_satz: 7.8 },
            { bezeichnung: 'Stroh, Rundballen', menge: 10, einzelpreis_netto: 14, mwst_satz: 7.8 }
        ]
    });
    neueRechnung({
        profil: profilB, kunde: wagner, datum: '2025-09-11', status: 'versendet', bezahlt: true,
        positionen: [
            { bezeichnung: 'Pflügen, ha', menge: 3, einzelpreis_netto: 75, mwst_satz: 19 }
        ]
    });
    neueRechnung({
        profil: profilA, kunde: agrar, datum: '2025-11-05', status: 'versendet', bezahlt: true,
        positionen: [
            { bezeichnung: 'Kälber, Fleckvieh männl.', menge: 4, einzelpreis_netto: 420, mwst_satz: 7.8 }
        ]
    });

    // Laufendes Jahr (2026) - sieben Rechnungen, verteilt über mehrere Quartale
    neueRechnung({
        profil: profilB, kunde: huber, datum: '2026-01-20', status: 'versendet', bezahlt: false,
        positionen: [
            { bezeichnung: 'Mähdrescher-Einsatz, ha', menge: 5, einzelpreis_netto: 110, mwst_satz: 19 }
        ]
    });
    neueRechnung({
        profil: profilA, kunde: gasthof, datum: '2026-03-15', status: 'versendet', bezahlt: true,
        positionen: [
            { bezeichnung: 'Frischmilch, Liter', menge: 200, einzelpreis_netto: 0.65, mwst_satz: 7 },
            { bezeichnung: 'Bergkäse, kg', menge: 12, einzelpreis_netto: 14.5, mwst_satz: 7 }
        ]
    });
    neueRechnung({
        profil: profilB, kunde: biomarkt, datum: '2026-04-30', status: 'entwurf', bezahlt: false,
        positionen: [
            { bezeichnung: 'Häckseln Silomais, ha', menge: 4, einzelpreis_netto: 130, mwst_satz: 19 }
        ]
    });
    neueRechnung({
        profil: profilA, kunde: wagner, datum: '2026-05-18', status: 'versendet', bezahlt: true,
        positionen: [
            { bezeichnung: 'Heuballen, rund', menge: 30, einzelpreis_netto: 19, mwst_satz: 7.8 }
        ]
    });
    neueRechnung({
        profil: profilB, kunde: agrar, datum: '2026-06-25', status: 'versendet', bezahlt: false,
        positionen: [
            { bezeichnung: 'Traktor-Miete inkl. Fahrer, Stunde', menge: 10, einzelpreis_netto: 55, mwst_satz: 19 },
            { bezeichnung: 'Anhänger-Miete, Tag', menge: 2, einzelpreis_netto: 40, mwst_satz: 19 }
        ]
    });
    neueRechnung({
        profil: profilA, kunde: huber, datum: '2026-07-08', status: 'versendet', bezahlt: true,
        positionen: [
            { bezeichnung: 'Kartoffeln, 25kg-Sack', menge: 25, einzelpreis_netto: 13, mwst_satz: 7 },
            { bezeichnung: 'Frische Eier, 10er-Palette', menge: 20, einzelpreis_netto: 3.3, mwst_satz: 7 }
        ]
    });
    neueRechnung({
        profil: profilB, kunde: gasthof, datum: '2026-07-15', status: 'entwurf', bezahlt: false,
        positionen: [
            { bezeichnung: 'Grasschnitt Wiese, ha', menge: 3, einzelpreis_netto: 90, mwst_satz: 19 }
        ]
    });

    settings.setWert(SEED_MARKER, new Date().toISOString());
    console.log(`Testdaten angelegt: ${kunden.length} Kunden, 12 Rechnungen über die Profile "${profilA.name}" und "${profilB.name}".`);
    app.exit(0);
});
