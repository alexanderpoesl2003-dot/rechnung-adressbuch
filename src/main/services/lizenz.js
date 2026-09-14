// Produktschlüssel + Testzeitraum (siehe Auftrag "Produktschlüssel für
// Weitergabe", später erweitert um Ed25519 in Block 3 "Backup/Restore,
// Lizenzsystem, Distribution und Signing-Vorbereitung"). Ziel ist bewusst
// KEIN hartes Kopierschutz-System (bei einer lokal laufenden, offline
// funktionierenden Desktop-App ohne eigenen Server technisch ohnehin nicht
// wirklich durchsetzbar - wer will, kann eine Electron-App immer
// auseinandernehmen) - sondern eine einfache, robuste Hürde gegen achtloses
// Weiterreichen, wie vom Auftraggeber selbst so gewünscht.
//
// NEUE Funktionsweise (ab Block 3): jeder Schlüssel ist ein Ed25519-signierter
// Datensatz (siehe lizenz-format.js, Präfix "AP1."). Signiert wird
// ausschließlich im separaten Lizenzverwaltungs-Tool (ap-lizenzverwaltung),
// das den privaten Schlüssel besitzt - DIESES Rechnungstool enthält
// ausschließlich den öffentlichen Schlüssel (siehe ED25519_PUBLIC_KEY_PEM
// unten, kein Geheimnis) und kann Signaturen nur PRÜFEN, niemals neue
// gültige Lizenzen erzeugen.
//
// ALTE Funktionsweise (bis Version 0.5.0, siehe schluesselPruefenLegacyHmac
// unten): ein Schlüssel im Format AP-XXXXX-XXXX-XXXX kodierte eine
// Seriennummer + eine HMAC-SHA256-Prüfsumme mit einem geteilten Geheimnis
// (lizenz-geheimnis.local.json). Dieses Geheimnis wird AB SOFORT nicht mehr
// mit ausgeliefert (siehe package.json: build.files) - die Legacy-Prüfung
// bleibt im Code nur für bereits vor der Umstellung ausgegebene Schlüssel
// erhalten und funktioniert nur noch dort, wo diese Datei lokal noch
// vorhanden ist (z.B. Entwicklungsrechner). Details siehe Abschlussbericht.
//
// WICHTIG (ausdrücklicher Auftrag): niemals destruktiv. Ohne gültigen
// Schlüssel nach Ablauf des Testzeitraums wird die Bedienoberfläche nur
// GESPERRT (wie der bestehende Passwortschutz, siehe login-gate.js) - keine
// Daten werden gelöscht/verändert. Ein einmal erfolgreich eingelöster
// Schlüssel bleibt dauerhaft gültig (kein "Verbrauch"); geht der
// gespeicherte Zustand doch einmal verloren (z.B. nach einem Update), zeigt
// die App einfach wieder die Sperre - derselbe Schlüssel schaltet sie erneut
// frei, beliebig oft. Keine Gerätebindung, keine Online-Aktivierung.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const settings = require('../models/settings');
const { envelopeZerlegen, PRODUCT_ID, FORMAT_VERSION } = require('./lizenz-format');

// Öffentlicher Ed25519-Schlüssel des Lizenzverwaltungs-Tools - KEIN Geheimnis,
// darf offen im Quellcode/Build liegen (siehe Auftrag Block 3, Punkt 18).
// Erzeugt am 14.09.2026 im separaten Tool ap-lizenzverwaltung
// (ed25519-schluessel.js) - bei einem Schlüsselwechsel dort muss dieser
// Konstante-Wert hier manuell nachgezogen werden, sonst werden neu
// ausgegebene Lizenzen von dieser App-Version nicht mehr akzeptiert.
const ED25519_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALPcGLoht1nfw4DxdOMu2fGbf/jH2Ay7D9vpjnpXeSLY=
-----END PUBLIC KEY-----
`;

let ed25519PublicKeyObjekt = null;
function ed25519PublicKey() {
    if (!ed25519PublicKeyObjekt) ed25519PublicKeyObjekt = crypto.createPublicKey(ED25519_PUBLIC_KEY_PEM);
    return ed25519PublicKeyObjekt;
}

const TRIAL_TAGE = 30;
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

// VERALTET (Legacy-HMAC, siehe Auftrag Block 3): erzeugt einen Schlüssel im
// ALTEN Format. Wird NICHT von der App selbst aufgerufen. Das frühere
// Generator-Skript (scripts/lizenz-schluessel-erzeugen.js) sowie die dafür
// nötige lizenz-geheimnis.local.json wurden nach der Ed25519-Umstellung
// entfernt (keine aktive Legacy-Lizenz mehr im Umlauf) - diese Funktion bleibt
// nur noch als dokumentierter, aktuell funktionsloser Code-Pfad stehen
// (geheimnisLesen() wirft ohne die Datei zuverlässig einen Fehler). Für neue
// Lizenzen bitte ausschließlich das Lizenzverwaltungs-Tool (ap-lizenzverwaltung,
// Ed25519) verwenden.
function schluesselErzeugen(seriennummer) {
    if (!Number.isInteger(seriennummer) || seriennummer < 1 || seriennummer > MAX_SERIENNUMMER) {
        throw new Error(`Seriennummer muss eine ganze Zahl zwischen 1 und ${MAX_SERIENNUMMER} sein.`);
    }
    const serialTeil = zahlKodieren(seriennummer, 5);
    const pruefsummeTeil = pruefsummeFuerSeriennummer(seriennummer);
    return `AP-${serialTeil}-${pruefsummeTeil.slice(0, 4)}-${pruefsummeTeil.slice(4, 8)}`;
}

// LEGACY: prüft einen Schlüssel im alten HMAC-Format (AP-XXXXX-XXXX-XXXX) -
// tolerant gegenüber Groß-/Kleinschreibung, zusätzlichen Leerzeichen und
// fehlenden/zusätzlichen Bindestrichen. Wird von schluesselPruefen() nur noch
// als Fallback für VOR der Ed25519-Umstellung ausgegebene Schlüssel benutzt
// (siehe Auftrag Block 3, Punkt 13) - funktioniert nur, wenn
// lizenz-geheimnis.local.json lokal noch vorhanden ist (siehe Moduldoc oben;
// in ausgelieferten Builds ab dieser Version NICHT mehr der Fall).
function schluesselPruefenLegacyHmac(eingabe) {
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

// Prüft einen Ed25519-signierten Lizenzcode (siehe lizenz-format.js). Gibt
// bei Gültigkeit den geprüften Payload zurück, sonst null - wirft nie.
function pruefeEd25519Lizenz(eingabe) {
    const zerlegt = envelopeZerlegen(eingabe);
    if (!zerlegt) return null;
    const { payload, payloadBytes, signatur } = zerlegt;

    if (payload.v !== FORMAT_VERSION) return null;
    if (payload.productId !== PRODUCT_ID) return null;
    if (!Number.isInteger(payload.serial) || payload.serial < 1) return null;
    if (GESPERRTE_SERIENNUMMERN.includes(payload.serial)) return null;

    try {
        if (!crypto.verify(null, payloadBytes, ed25519PublicKey(), signatur)) return null;
    } catch {
        return null; // z.B. falsch geformte Signatur-Bytes
    }
    return payload;
}

// Prüft eine vom Nutzer eingegebene Zeichenkette. Erkennt zuerst das neue
// Ed25519-Format (Präfix "AP1.", siehe lizenz-format.js) - nur wenn dieses
// Präfix NICHT vorliegt, wird das alte HMAC-Format versucht (siehe Auftrag
// Block 3, Punkt 13: Übergangsstrategie für bereits ausgegebene Lizenzen).
// Ein erkanntes, aber ungültiges AP1-Format fällt bewusst NICHT auf die
// Legacy-Prüfung zurück (sonst könnte eine absichtlich verfälschte neue
// Lizenz fälschlich nochmal nach altem Muster interpretiert werden).
function schluesselPruefen(eingabe) {
    if (!eingabe) return false;
    const bereinigt = String(eingabe).trim();
    if (bereinigt.startsWith('AP1.')) {
        return pruefeEd25519Lizenz(bereinigt) !== null;
    }
    return schluesselPruefenLegacyHmac(bereinigt);
}

// Liefert 'ed25519' | 'legacy-hmac' | null (kein gültiger Schlüssel) - nur
// zur internen Information/Anzeige, ändert nichts an der Prüfung selbst.
function schluesselFormat(eingabe) {
    if (!eingabe) return null;
    const bereinigt = String(eingabe).trim();
    if (bereinigt.startsWith('AP1.')) {
        return pruefeEd25519Lizenz(bereinigt) !== null ? 'ed25519' : null;
    }
    return schluesselPruefenLegacyHmac(bereinigt) ? 'legacy-hmac' : null;
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
            trialTage: TRIAL_TAGE, kontaktEmail: KONTAKT_EMAIL,
            format: schluesselFormat(gespeicherterSchluessel)
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

// Zentrale, einfache Main-seitige Lizenzprüfung (siehe Auftrag "IPC-Härtung",
// Punkt 11): wird von zentralen Schreib-/Nutzfunktionen aufgerufen (siehe
// ipc/register.js), damit ein abgelaufener Testzeitraum nicht allein dadurch
// umgangen werden kann, dass die UI übersprungen und ein IPC-Kanal direkt
// aufgerufen wird. Ändert NICHTS am Lizenzformat/-algorithmus selbst (siehe
// Block 3) - reine Statusabfrage der bestehenden lizenzstatus()-Funktion.
function requireLizenz() {
    if (!lizenzstatus().freigeschaltet) {
        throw new Error(
            'Der Testzeitraum ist abgelaufen. Bitte geben Sie einen gültigen Produktschlüssel ein ' +
            '(Einstellungen -> Produktschlüssel).'
        );
    }
}

module.exports = {
    TRIAL_TAGE,
    KONTAKT_EMAIL,
    lizenzstatus,
    schluesselEinloesen,
    schluesselErzeugen,
    schluesselPruefen,
    requireLizenz
};
