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
// frei, beliebig oft.
//
// ONLINE-AKTIVIERUNG (ab Version 0.6.0, Auftrag "Lizenz-Aktivierung und
// Sperrliste"): Ein Schlüssel gilt nur noch auf EINEM Rechner. Beim Einlösen
// fragt die App einmalig den Aktivierungsdienst (lizenz.ap-services-online.de)
// und speichert das signierte Aktivierungs-Token (aktivierung-format.js).
// Danach läuft sie offline weiter. Freigeschaltet ist nur, wenn Lizenz UND
// Token gültig sind, das Token zu diesem Rechner passt und die Seriennummer
// nicht in GESPERRTE_SERIENNUMMERN steht.
// Etwa alle 7 Tage fragt die App (nur wenn online, nie blockierend) nach, ob
// die Lizenz gesperrt oder auf einem anderen Rechner aktiviert wurde.
// Bestandskunden (Schlüssel vor 0.6.0 eingelöst, noch kein Token) werden im
// Hintergrund aktiviert und haben dafür 30 Tage Zeit.
// Auch hier gilt: gesperrt wird nur die Oberfläche, nie werden Daten gelöscht.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const settings = require('../models/settings');
const { envelopeZerlegen, PRODUCT_ID, FORMAT_VERSION } = require('./lizenz-format');
const { tokenPruefen } = require('./aktivierung-format');
const { geraetKennung } = require('./geraete-kennung');

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

function ed25519PublicKey() {
    return crypto.createPublicKey(umgebung.lizenzPublicKeyPem);
}

// Öffentlicher Teil des Aktivierungsschlüssels (privater Teil nur auf dem
// S930) - prüft die Aktivierungs-Tokens. KEIN Geheimnis.
const AKTIVIERUNG_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxKSkaCRYOgSofWL+dvEUgjc9QUeIVEQR2WIf+9sdk0Y=
-----END PUBLIC KEY-----
`;
const AKTIVIERUNG_URL = 'https://lizenz.ap-services-online.de';
const NACHPRUEFUNG_TAGE = 7;
const AKTIVIERUNG_FRIST_TAGE = 30;
const ONLINE_TIMEOUT_MS = 10000;

// Nur für die Tests austauschbar (siehe test/lizenz-aktivierung.test.js).
const umgebung = {
    lizenzPublicKeyPem: ED25519_PUBLIC_KEY_PEM,
    aktivierungPublicKeyPem: AKTIVIERUNG_PUBLIC_KEY_PEM,
    aktivierungUrl: AKTIVIERUNG_URL,
    fetch: null,
    geraetKennung,
    gesperrteSeriennummern: null, // wird unten auf GESPERRTE_SERIENNUMMERN gesetzt
    jetzt: () => Date.now()
};

const TRIAL_TAGE = 30;
const INSTALLIERT_AM_SCHLUESSEL = 'lizenz_installiert_am';
const SCHLUESSEL_SCHLUESSEL = 'lizenz_schluessel';
const TOKEN_SCHLUESSEL = 'lizenz_aktivierung_token';
const FRIST_AB_SCHLUESSEL = 'lizenz_aktivierung_frist_ab';
const LETZTE_PRUEFUNG_SCHLUESSEL = 'lizenz_letzte_pruefung';
// 'gesperrt' | 'anderer_rechner' - vom Server gemeldet, sperrt die Oberfläche.
const WIDERRUF_SCHLUESSEL = 'lizenz_widerruf';
const TAG_MS = 1000 * 60 * 60 * 24;

const KONTAKT_EMAIL = 'ap-handel@gmx.de';

// 32 gut unterscheidbare Zeichen (keine 0/O- oder 1/I-Verwechslungsgefahr),
// eigenes Alphabet statt RFC4648-Base32 - einfacher zu implementieren, da
// hier ohnehin nur einzelne Zahlen (keine beliebigen Binärdaten) kodiert
// werden müssen.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const BASIS = BigInt(ALPHABET.length);

const MAX_SERIENNUMMER = 16777215; // 2^24 - 1, reichlich Luft für Einzelschlüssel

// Sperrliste: Seriennummern, die trotz gültiger Signatur nicht mehr
// akzeptiert werden (z.B. bei Missbrauch) - auch nicht mit Aktivierungs-Token.
// Die fertige Zeile steht auf der Lizenzseite (S930) unter "Gesperrte
// Seriennummern". Die Online-Nachprüfung sperrt meist schon vorher; diese
// Liste wirkt zusätzlich bei Rechnern, die nie online gehen.
const GESPERRTE_SERIENNUMMERN = [];
umgebung.gesperrteSeriennummern = GESPERRTE_SERIENNUMMERN;

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

function aktivierungPublicKey() {
    return crypto.createPublicKey(umgebung.aktivierungPublicKeyPem);
}

function jetztIso() {
    return new Date(umgebung.jetzt()).toISOString();
}

// Seriennummer steht in der eingebauten Sperrliste (Lizenz sonst gültig signiert)?
function stehtAufSperrliste(eingabe) {
    const zerlegt = envelopeZerlegen(eingabe);
    if (!zerlegt || !GESPERRTE_SERIENNUMMERN.includes(zerlegt.payload.serial)) return false;
    try {
        return crypto.verify(null, zerlegt.payloadBytes, ed25519PublicKey(), zerlegt.signatur);
    } catch {
        return false;
    }
}

// Passt das gespeicherte Aktivierungs-Token zu dieser Lizenz und diesem Rechner?
function tokenPasst(serial) {
    const payload = tokenPruefen(settings.getWert(TOKEN_SCHLUESSEL), aktivierungPublicKey());
    if (!payload || payload.serial !== serial) return false;
    try {
        return payload.geraet === umgebung.geraetKennung();
    } catch {
        return false;
    }
}

function widerrufLesen() {
    return settings.getWert(WIDERRUF_SCHLUESSEL) || null;
}

// Status einer eingelösten Ed25519-Lizenz: aktiviert, gesperrt oder (für
// Bestandskunden ohne Token) innerhalb bzw. nach der Aktivierungsfrist.
function aktivierungsstatus(serial) {
    const widerruf = widerrufLesen();
    if (widerruf) return { freigeschaltet: false, grund: widerruf };
    if (tokenPasst(serial)) return { freigeschaltet: true, grund: 'lizenziert' };
    // Ein vorhandenes, aber unpassendes Token (z.B. Datenbank auf einen anderen
    // Rechner kopiert) bekommt keine Frist - die gilt nur für Bestandskunden,
    // die vor der Online-Aktivierung noch nie ein Token hatten.
    if (settings.getWert(TOKEN_SCHLUESSEL)) return { freigeschaltet: false, grund: 'aktivierung_noetig' };

    let fristAb = settings.getWert(FRIST_AB_SCHLUESSEL);
    if (!fristAb) {
        fristAb = jetztIso();
        settings.setWert(FRIST_AB_SCHLUESSEL, fristAb);
    }
    const vergangeneTage = (umgebung.jetzt() - new Date(fristAb).getTime()) / TAG_MS;
    if (vergangeneTage < AKTIVIERUNG_FRIST_TAGE) {
        return {
            freigeschaltet: true, grund: 'aktivierung_ausstehend',
            aktivierungTageVerbleibend: Math.max(1, Math.ceil(AKTIVIERUNG_FRIST_TAGE - vergangeneTage))
        };
    }
    return { freigeschaltet: false, grund: 'aktivierung_noetig' };
}

// Gibt den aktuellen Freischaltstatus zurück - wird bei jedem Programmstart
// vom Renderer abgefragt (siehe lizenz-gate.js), analog zu
// settings.isPasswordSet()/login-gate.js. Arbeitet immer offline.
// grund: 'lizenziert' | 'aktivierung_ausstehend' | 'testzeitraum'
//      | 'abgelaufen' | 'aktivierung_noetig' | 'gesperrt' | 'anderer_rechner'
function lizenzstatus() {
    ersteStartzeitSicherstellen();
    const basis = { tageVerbleibend: null, tageVergangen: null, trialTage: TRIAL_TAGE, kontaktEmail: KONTAKT_EMAIL };

    const gespeicherterSchluessel = settings.getWert(SCHLUESSEL_SCHLUESSEL);
    if (gespeicherterSchluessel && schluesselPruefen(gespeicherterSchluessel)) {
        const format = schluesselFormat(gespeicherterSchluessel);
        const status = format === 'ed25519'
            ? aktivierungsstatus(pruefeEd25519Lizenz(gespeicherterSchluessel).serial)
            : { freigeschaltet: true, grund: 'lizenziert' };
        return { ...basis, ...status, format };
    }
    if (gespeicherterSchluessel && stehtAufSperrliste(gespeicherterSchluessel)) {
        return { ...basis, freigeschaltet: false, grund: 'gesperrt' };
    }

    const installiertAm = new Date(settings.getWert(INSTALLIERT_AM_SCHLUESSEL));
    const vergangeneTage = (Date.now() - installiertAm.getTime()) / (1000 * 60 * 60 * 24);
    const tageVerbleibend = Math.max(0, Math.ceil(TRIAL_TAGE - vergangeneTage));
    // Für die Anzeige "Tag X von 10" - mindestens Tag 1, auch direkt nach der
    // Installation (0 vergangene Tage soll nicht als "Tag 0" angezeigt werden).
    const tageVergangen = Math.min(TRIAL_TAGE, Math.max(1, Math.floor(vergangeneTage) + 1));

    if (vergangeneTage < TRIAL_TAGE) {
        return { ...basis, freigeschaltet: true, grund: 'testzeitraum', tageVerbleibend, tageVergangen };
    }
    return { ...basis, freigeschaltet: false, grund: 'abgelaufen', tageVerbleibend: 0, tageVergangen: TRIAL_TAGE };
}

// --- Online: Aktivierung und Nachprüfung -------------------------------------

const FEHLERTEXTE = {
    offline: 'Für die einmalige Aktivierung wird eine Internetverbindung benötigt. '
        + 'Bitte prüfen Sie die Verbindung und versuchen Sie es erneut.',
    ungueltig: 'Dieser Schlüssel ist ungültig.',
    gesperrt: `Dieser Lizenzschlüssel wurde gesperrt. Bitte wenden Sie sich an AP Services (${KONTAKT_EMAIL}).`,
    bereits_aktiviert: 'Dieser Lizenzschlüssel ist bereits auf einem anderen Computer aktiviert. '
        + `Bitte wenden Sie sich an AP Services (${KONTAKT_EMAIL}).`,
    zu_viele: 'Zu viele Aktivierungsversuche. Bitte versuchen Sie es in einer Stunde erneut.',
    serverfehler: 'Der Aktivierungsserver antwortet gerade nicht richtig. Bitte versuchen Sie es später erneut.'
};

function standardFetch(url, optionen) {
    // net.fetch nutzt die Proxy-Einstellungen des Systems (wichtig in Firmennetzen).
    return require('electron').net.fetch(url, optionen);
}

function appVersion() {
    try {
        return require('electron').app.getVersion();
    } catch {
        return null;
    }
}

// Liefert { status, daten }. status 0 = keine Verbindung / Zeitüberschreitung.
async function onlineAnfrage(pfad, body) {
    let antwort;
    try {
        antwort = await (umgebung.fetch || standardFetch)(`${umgebung.aktivierungUrl}${pfad}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS)
        });
    } catch {
        return { status: 0, daten: null };
    }
    const daten = await antwort.json().catch(() => null);
    return { status: antwort.status, daten: daten || {} };
}

// Aktiviert eine (offline bereits geprüfte) Lizenz auf diesem Rechner und
// speichert bei Erfolg Lizenz + Token. Liefert 'ok' oder einen Schlüssel aus
// FEHLERTEXTE. Meldet der Server für die bereits gespeicherte Lizenz
// "gesperrt" oder "anderer Rechner", wird das als Widerruf vermerkt.
async function aktivierenOnline(lizenz, serial) {
    const geraet = umgebung.geraetKennung(); // wirft mit verständlicher Meldung
    const { status, daten } = await onlineAnfrage('/api/aktivieren', { lizenz, geraet, appVersion: appVersion() });

    if (status === 200) {
        const payload = tokenPruefen(daten.token, aktivierungPublicKey());
        if (!payload || payload.serial !== serial || payload.geraet !== geraet) return 'serverfehler';
        settings.setWert(SCHLUESSEL_SCHLUESSEL, lizenz);
        settings.setWert(TOKEN_SCHLUESSEL, daten.token);
        settings.setWert(LETZTE_PRUEFUNG_SCHLUESSEL, jetztIso());
        settings.setWert(WIDERRUF_SCHLUESSEL, null);
        return 'ok';
    }
    const ergebnis = { 0: 'offline', 400: 'ungueltig', 403: 'gesperrt', 409: 'bereits_aktiviert', 429: 'zu_viele' }[status]
        || 'serverfehler';
    if (lizenz === settings.getWert(SCHLUESSEL_SCHLUESSEL)) {
        if (ergebnis === 'gesperrt') settings.setWert(WIDERRUF_SCHLUESSEL, 'gesperrt');
        if (ergebnis === 'bereits_aktiviert') settings.setWert(WIDERRUF_SCHLUESSEL, 'anderer_rechner');
    }
    return ergebnis;
}

// Versucht, einen vom Nutzer eingegebenen Schlüssel einzulösen: erst offline
// prüfen, dann online auf diesem Rechner aktivieren. Gibt false zurück, wenn
// der Schlüssel schon offline ungültig ist, true bei Erfolg, und wirft bei
// allen anderen Fehlern mit einer verständlichen deutschen Meldung.
async function schluesselEinloesen(eingabe) {
    if (!schluesselPruefen(eingabe)) return false;
    const bereinigt = String(eingabe).trim();
    if (schluesselFormat(bereinigt) === 'legacy-hmac') {
        settings.setWert(SCHLUESSEL_SCHLUESSEL, bereinigt);
        return true;
    }
    const ergebnis = await aktivierenOnline(bereinigt, pruefeEd25519Lizenz(bereinigt).serial);
    if (ergebnis !== 'ok') throw new Error(FEHLERTEXTE[ergebnis]);
    return true;
}

// "Jetzt aktivieren" für die bereits gespeicherte Lizenz (Bestandskunden,
// oder nachdem AP Services die Aktivierung zurückgesetzt hat).
async function gespeichertenSchluesselAktivieren() {
    const gespeichert = settings.getWert(SCHLUESSEL_SCHLUESSEL);
    if (!gespeichert) throw new Error('Es ist noch kein Produktschlüssel gespeichert.');
    if (!(await schluesselEinloesen(gespeichert))) throw new Error(FEHLERTEXTE.ungueltig);
    return true;
}

function nachpruefungFaellig() {
    const letzte = settings.getWert(LETZTE_PRUEFUNG_SCHLUESSEL);
    return !letzte || umgebung.jetzt() - new Date(letzte).getTime() >= NACHPRUEFUNG_TAGE * TAG_MS;
}

// Läuft bei jedem Programmstart im Hintergrund (siehe main.js) und blockiert
// nie: ohne Internet passiert einfach nichts. Aktiviert Bestandsinstallationen
// ohne Token und fragt etwa alle 7 Tage nach, ob die Lizenz gesperrt oder auf
// einem anderen Rechner aktiviert wurde. Liefert true, wenn sich dadurch der
// Freischaltzustand geändert hat (dann lädt main.js die Oberfläche neu).
async function hintergrundAbgleich() {
    const gespeichert = settings.getWert(SCHLUESSEL_SCHLUESSEL);
    const payload = gespeichert && String(gespeichert).startsWith('AP1.') ? pruefeEd25519Lizenz(gespeichert) : null;
    if (!payload) return false;

    let geraet;
    try {
        geraet = umgebung.geraetKennung();
    } catch {
        return false;
    }
    const vorher = lizenzstatus().freigeschaltet;
    const widerruf = widerrufLesen();

    if (!widerruf && !tokenPasst(payload.serial)) {
        await aktivierenOnline(gespeichert, payload.serial);
    } else if (widerruf || nachpruefungFaellig()) {
        const { status, daten } = await onlineAnfrage('/api/pruefen', { lizenz: gespeichert, geraet });
        if (status === 200) {
            settings.setWert(LETZTE_PRUEFUNG_SCHLUESSEL, jetztIso());
            if (daten.gesperrt) {
                settings.setWert(WIDERRUF_SCHLUESSEL, 'gesperrt');
            } else if (daten.gueltig) {
                settings.setWert(WIDERRUF_SCHLUESSEL, null);
            } else if (daten.grund === 'anderes_geraet') {
                settings.setWert(WIDERRUF_SCHLUESSEL, 'anderer_rechner');
            } else if (widerruf === 'gesperrt') {
                // Entsperrt, aber (noch) auf keinem Rechner aktiviert: gleich hier aktivieren.
                settings.setWert(WIDERRUF_SCHLUESSEL, null);
                if (!tokenPasst(payload.serial)) await aktivierenOnline(gespeichert, payload.serial);
            }
            // 'nicht_aktiviert' ohne Widerruf: Aktivierung wurde zurückgesetzt, das
            // Token gilt hier weiter, bis ein anderer Rechner aktiviert wird.
        }
    }
    return lizenzstatus().freigeschaltet !== vorher;
}

// Zentrale, einfache Main-seitige Lizenzprüfung (siehe Auftrag "IPC-Härtung",
// Punkt 11): wird von zentralen Schreib-/Nutzfunktionen aufgerufen (siehe
// ipc/register.js), damit ein abgelaufener Testzeitraum nicht allein dadurch
// umgangen werden kann, dass die UI übersprungen und ein IPC-Kanal direkt
// aufgerufen wird. Reine Statusabfrage der lizenzstatus()-Funktion (offline).
function requireLizenz() {
    const status = lizenzstatus();
    if (!status.freigeschaltet) {
        const texte = {
            gesperrt: FEHLERTEXTE.gesperrt,
            anderer_rechner: FEHLERTEXTE.bereits_aktiviert,
            aktivierung_noetig: 'Ihre Lizenz muss einmalig online aktiviert werden (Einstellungen -> Produktschlüssel).'
        };
        throw new Error(texte[status.grund]
            || 'Der Testzeitraum ist abgelaufen. Bitte geben Sie einen gültigen Produktschlüssel ein '
            + '(Einstellungen -> Produktschlüssel).');
    }
}

module.exports = {
    TRIAL_TAGE,
    KONTAKT_EMAIL,
    lizenzstatus,
    schluesselEinloesen,
    gespeichertenSchluesselAktivieren,
    hintergrundAbgleich,
    schluesselErzeugen,
    schluesselPruefen,
    requireLizenz,
    _umgebung: umgebung
};
