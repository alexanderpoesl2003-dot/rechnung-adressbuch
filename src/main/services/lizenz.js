// Produktschlüssel + Testzeitraum (siehe Auftrag "Produktschlüssel für
// Weitergabe"). Ziel ist bewusst KEIN hartes Kopierschutz-System (bei einer
// lokal laufenden, offline funktionierenden Desktop-App ohne eigenen Server
// technisch ohnehin nicht wirklich durchsetzbar - wer will, kann eine
// Electron-App immer auseinandernehmen) - sondern eine einfache, robuste
// Hürde gegen achtloses Weiterreichen, wie vom Auftraggeber selbst so
// gewünscht.
//
// Funktionsweise: jeder Schlüssel kodiert eine Seriennummer + eine Prüfsumme
// (HMAC-SHA256 mit einem Geheimnis, das NICHT im Git-Repo liegt - siehe
// lizenz-geheimnis.local.json, .gitignore). Die App selbst braucht nur
// dieses eine Geheimnis, um JEDEN damit erzeugten Schlüssel offline zu
// prüfen - es muss also keine Liste "gültiger Schlüssel" mitgeliefert oder
// online abgeglichen werden. Neue Schlüssel lassen sich jederzeit (auch
// offline) über scripts/lizenz-schluessel-erzeugen.js erstellen.
//
// WICHTIG (ausdrücklicher Auftrag): niemals destruktiv. Ohne gültigen
// Schlüssel nach Ablauf des Testzeitraums wird die Bedienoberfläche nur
// GESPERRT (wie der bestehende Passwortschutz, siehe login-gate.js) - keine
// Daten werden gelöscht/verändert. Ein einmal erfolgreich eingelöster
// Schlüssel bleibt dauerhaft gültig (kein "Verbrauch"); geht der
// gespeicherte Zustand doch einmal verloren (z.B. nach einem Update), zeigt
// die App einfach wieder die Sperre - derselbe Schlüssel schaltet sie erneut
// frei, beliebig oft.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const settings = require('../models/settings');

const TRIAL_TAGE = 10;
const INSTALLIERT_AM_SCHLUESSEL = 'lizenz_installiert_am';
const SCHLUESSEL_SCHLUESSEL = 'lizenz_schluessel';

const KONTAKT_EMAIL = 'alexanderpoesl2003@icloud.com';

// 32 gut unterscheidbare Zeichen (keine 0/O- oder 1/I-Verwechslungsgefahr),
// eigenes Alphabet statt RFC4648-Base32 - einfacher zu implementieren, da
// hier ohnehin nur einzelne Zahlen (keine beliebigen Binärdaten) kodiert
// werden müssen.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const BASIS = BigInt(ALPHABET.length);

const MAX_SERIENNUMMER = 16777215; // 2^24 - 1, reichlich Luft für Einzelschlüssel

// Hier künftig Seriennummern eintragen, die trotz korrekter Prüfsumme nicht
// mehr akzeptiert werden sollen (z.B. bei Missbrauch) - wirkt erst, sobald
// die betroffene Installation die nächste App-Version bekommt (kein
// Online-Abgleich, siehe Moduldoc oben).
const GESPERRTE_SERIENNUMMERN = [];

let geheimnisCache = null;

function geheimnisPfad() {
    // app.getAppPath() zeigt sowohl im Entwicklungsmodus (npm start) als
    // auch in der fertig gebauten App (asar ist deaktiviert, siehe
    // package.json) auf denselben Ort relativ zum Projekt-Wurzelverzeichnis.
    const { app } = require('electron');
    return path.join(app.getAppPath(), 'lizenz-geheimnis.local.json');
}

function geheimnisLesen() {
    if (geheimnisCache) return geheimnisCache;
    const pfad = geheimnisPfad();
    if (!fs.existsSync(pfad)) {
        throw new Error(
            `Lizenz-Geheimnisdatei fehlt (${pfad}) - ohne sie kann die App keine ` +
            'Produktschlüssel prüfen. Siehe lizenz-geheimnis.local.json.beispiel.'
        );
    }
    const inhalt = JSON.parse(fs.readFileSync(pfad, 'utf8'));
    if (!inhalt.geheimnis) throw new Error('Lizenz-Geheimnisdatei ist ungültig (Feld "geheimnis" fehlt).');
    geheimnisCache = inhalt.geheimnis;
    return geheimnisCache;
}

function zahlKodieren(n, zielLaenge) {
    let wert = BigInt(n);
    let ergebnis = '';
    do {
        ergebnis = ALPHABET[Number(wert % BASIS)] + ergebnis;
        wert /= BASIS;
    } while (wert > 0n);
    return ergebnis.padStart(zielLaenge, ALPHABET[0]);
}

function zahlDekodieren(text) {
    let wert = 0n;
    for (const zeichen of text) {
        const index = ALPHABET.indexOf(zeichen);
        if (index === -1) return null;
        wert = wert * BASIS + BigInt(index);
    }
    return wert;
}

function pruefsummeFuerSeriennummer(seriennummer) {
    const hmac = crypto.createHmac('sha256', geheimnisLesen()).update(String(seriennummer)).digest();
    // 5 Bytes = 40 Bit = exakt 8 Zeichen im 32er-Alphabet (2^5 = 32 pro
    // Zeichen), kein Rundungsverlust.
    const ausschnitt = hmac.subarray(0, 5);
    let wert = 0n;
    for (const byte of ausschnitt) wert = (wert << 8n) | BigInt(byte);
    return zahlKodieren(wert, 8);
}

// Erzeugt einen fertig formatierten Schlüssel für eine Seriennummer - wird
// NICHT von der App selbst aufgerufen, sondern nur vom separaten
// Generator-Skript (scripts/lizenz-schluessel-erzeugen.js).
function schluesselErzeugen(seriennummer) {
    if (!Number.isInteger(seriennummer) || seriennummer < 1 || seriennummer > MAX_SERIENNUMMER) {
        throw new Error(`Seriennummer muss eine ganze Zahl zwischen 1 und ${MAX_SERIENNUMMER} sein.`);
    }
    const serialTeil = zahlKodieren(seriennummer, 5);
    const pruefsummeTeil = pruefsummeFuerSeriennummer(seriennummer);
    return `AP-${serialTeil}-${pruefsummeTeil.slice(0, 4)}-${pruefsummeTeil.slice(4, 8)}`;
}

// Prüft eine vom Nutzer eingegebene Zeichenkette - tolerant gegenüber
// Groß-/Kleinschreibung, zusätzlichen Leerzeichen und fehlenden/zusätzlichen
// Bindestrichen, damit ein abgetippter oder per Hand eingefügter Schlüssel
// nicht an reiner Formatierung scheitert.
function schluesselPruefen(eingabe) {
    if (!eingabe) return false;
    const bereinigt = String(eingabe).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const OHNE_PREFIX = bereinigt.startsWith('AP') ? bereinigt.slice(2) : bereinigt;
    if (OHNE_PREFIX.length !== 13) return false; // 5 Seriennummer + 8 Prüfsumme

    const serialTeil = OHNE_PREFIX.slice(0, 5);
    const pruefsummeTeil = OHNE_PREFIX.slice(5, 13);

    const seriennummerBig = zahlDekodieren(serialTeil);
    if (seriennummerBig === null || seriennummerBig < 1n || seriennummerBig > BigInt(MAX_SERIENNUMMER)) return false;
    const seriennummer = Number(seriennummerBig);
    if (GESPERRTE_SERIENNUMMERN.includes(seriennummer)) return false;

    let erwarteteChecksumme;
    try {
        erwarteteChecksumme = pruefsummeFuerSeriennummer(seriennummer);
    } catch {
        return false;
    }

    // Zeitkonstanter Vergleich, damit die Prüfung keine Rückschlüsse per
    // Timing-Angriff erlaubt (in der Praxis für eine lokale Desktop-App zwar
    // kein realistisches Bedrohungsszenario, aber ein etablierter
    // Standard-Kniff ohne Nachteil).
    const a = Buffer.from(pruefsummeTeil);
    const b = Buffer.from(erwarteteChecksumme);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ersteStartzeitSicherstellen() {
    if (!settings.getWert(INSTALLIERT_AM_SCHLUESSEL)) {
        settings.setWert(INSTALLIERT_AM_SCHLUESSEL, new Date().toISOString());
    }
}

// Gibt den aktuellen Freischaltstatus zurück - wird bei jedem Programmstart
// vom Renderer abgefragt (siehe lizenz-gate.js), analog zu
// settings.isPasswordSet()/login-gate.js.
function lizenzstatus() {
    ersteStartzeitSicherstellen();

    const gespeicherterSchluessel = settings.getWert(SCHLUESSEL_SCHLUESSEL);
    if (gespeicherterSchluessel && schluesselPruefen(gespeicherterSchluessel)) {
        return {
            freigeschaltet: true, grund: 'lizenziert', tageVerbleibend: null, tageVergangen: null,
            trialTage: TRIAL_TAGE, kontaktEmail: KONTAKT_EMAIL
        };
    }

    const installiertAm = new Date(settings.getWert(INSTALLIERT_AM_SCHLUESSEL));
    const vergangeneTage = (Date.now() - installiertAm.getTime()) / (1000 * 60 * 60 * 24);
    const tageVerbleibend = Math.max(0, Math.ceil(TRIAL_TAGE - vergangeneTage));
    // Für die Anzeige "Tag X von 10" - mindestens Tag 1, auch direkt nach der
    // Installation (0 vergangene Tage soll nicht als "Tag 0" angezeigt werden).
    const tageVergangen = Math.min(TRIAL_TAGE, Math.max(1, Math.floor(vergangeneTage) + 1));

    if (vergangeneTage < TRIAL_TAGE) {
        return {
            freigeschaltet: true, grund: 'testzeitraum', tageVerbleibend, tageVergangen,
            trialTage: TRIAL_TAGE, kontaktEmail: KONTAKT_EMAIL
        };
    }
    return {
        freigeschaltet: false, grund: 'abgelaufen', tageVerbleibend: 0, tageVergangen: TRIAL_TAGE,
        trialTage: TRIAL_TAGE, kontaktEmail: KONTAKT_EMAIL
    };
}

// Versucht, einen vom Nutzer eingegebenen Schlüssel einzulösen - bei
// Erfolg dauerhaft gespeichert (kein erneutes Abfragen mehr, siehe
// Moduldoc). Wirft nie - gibt bei ungültigem Schlüssel einfach false zurück.
function schluesselEinloesen(eingabe) {
    if (!schluesselPruefen(eingabe)) return false;
    settings.setWert(SCHLUESSEL_SCHLUESSEL, String(eingabe).trim());
    return true;
}

module.exports = {
    TRIAL_TAGE,
    KONTAKT_EMAIL,
    lizenzstatus,
    schluesselEinloesen,
    schluesselErzeugen,
    schluesselPruefen
};
