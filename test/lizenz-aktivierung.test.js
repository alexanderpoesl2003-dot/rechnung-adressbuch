// Tests für die Online-Aktivierung in src/main/services/lizenz.js.
// Läuft mit plain Node (node --test test/), ohne Electron und ohne Datenbank:
// das settings-Modul wird durch einen Speicher im Arbeitsspeicher ersetzt.
// Gegenstelle ist der ECHTE Aktivierungsdienst aus dem Lizenzverwaltungs-
// Projekt, gestartet mit EIGENEN Test-Schlüsseln (AP_TESTMODUS=1).
// Pfad zum Dienst: AP_AKTIVIERUNG_PROJEKT oder ../../AP Lizenzverwaltung/lizenzverwaltung/aktivierung
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const WURZEL = path.join(__dirname, '..');
const DIENST = process.env.AP_AKTIVIERUNG_PROJEKT
    || path.join(WURZEL, '..', '..', 'AP Lizenzverwaltung', 'lizenzverwaltung', 'aktivierung');
const PORT = 26069;
const ADMIN_PORT = 26070;
const ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
const TAG = 24 * 60 * 60 * 1000;

// --- settings durch einen einfachen Speicher ersetzen -------------------------
const speicher = new Map();
const settingsPfad = require.resolve(path.join(WURZEL, 'src/main/models/settings'));
const fake = new Module(settingsPfad);
fake.filename = settingsPfad;
fake.loaded = true;
fake.exports = {
    getWert: (k) => (speicher.has(k) ? speicher.get(k) : null),
    setWert: (k, v) => speicher.set(k, v)
};
require.cache[settingsPfad] = fake;

const lizenz = require(path.join(WURZEL, 'src/main/services/lizenz'));
const { payloadErstellen, payloadZuBytes, envelopeBauen } = require(path.join(WURZEL, 'src/main/services/lizenz-format'));
const { geraetAusRohId } = require(path.join(WURZEL, 'src/main/services/aktivierung-format'));
const umgebung = lizenz._umgebung;

const lizenzPaar = crypto.generateKeyPairSync('ed25519');
const aktivierungPaar = crypto.generateKeyPairSync('ed25519');
let datenOrdner;
let dienst;
let naechsteSerial = 100;
let uhr = Date.now();

function neueLizenz() {
    const payload = payloadErstellen({ serial: naechsteSerial++, ref: 'Test' });
    return { schluessel: envelopeBauen(payload, crypto.sign(null, payloadZuBytes(payload), lizenzPaar.privateKey)), serial: payload.serial };
}

function aufGeraet(rohId) {
    umgebung.geraetKennung = () => geraetAusRohId(rohId);
}

function offline() {
    umgebung.fetch = async () => { throw new TypeError('fetch failed'); };
}

function online() {
    umgebung.fetch = fetch;
}

async function admin(pfad, body) {
    const antwort = await fetch(`http://127.0.0.1:${ADMIN_PORT}${pfad}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AP-Admin': ADMIN_TOKEN },
        body: JSON.stringify(body)
    });
    assert.strictEqual(antwort.status, 200);
}

// Schaltet einen Schlüssel auf einem anderen "Rechner" (eigene Gerätekennung) frei.
async function aufAnderemRechnerAktivieren(schluessel, rohId) {
    const antwort = await fetch(`http://127.0.0.1:${PORT}/api/aktivieren`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lizenz: schluessel, geraet: geraetAusRohId(rohId) })
    });
    return antwort.status;
}

before(async () => {
    assert.ok(fs.existsSync(path.join(DIENST, 'server.js')), `Aktivierungsdienst nicht gefunden: ${DIENST}`);
    datenOrdner = fs.mkdtempSync(path.join(os.tmpdir(), 'rechnungstool-aktivierung-test-'));
    fs.writeFileSync(path.join(datenOrdner, 'aktivierungsschluessel.pem'), aktivierungPaar.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    fs.writeFileSync(path.join(datenOrdner, 'test-lizenz-public.pem'), lizenzPaar.publicKey.export({ type: 'spki', format: 'pem' }));
    fs.writeFileSync(path.join(datenOrdner, 'admin-token'), ADMIN_TOKEN);
    dienst = spawn(process.execPath, [path.join(DIENST, 'server.js')], {
        env: { ...process.env, AP_TESTMODUS: '1', DATA_DIR: datenOrdner, PORT, ADMIN_PORT, RATE_LIMIT: 1000 },
        stdio: ['ignore', 'pipe', 'inherit']
    });
    let ausgabe = '';
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Dienst startet nicht')), 5000);
        dienst.stdout.on('data', (text) => {
            ausgabe += text;
            if ((ausgabe.match(/läuft auf/g) || []).length === 2) { clearTimeout(timer); resolve(); }
        });
    });

    umgebung.lizenzPublicKeyPem = lizenzPaar.publicKey.export({ type: 'spki', format: 'pem' });
    umgebung.aktivierungPublicKeyPem = aktivierungPaar.publicKey.export({ type: 'spki', format: 'pem' });
    umgebung.aktivierungUrl = `http://127.0.0.1:${PORT}`;
    umgebung.jetzt = () => uhr;
});

after(() => {
    dienst.kill();
    fs.rmSync(datenOrdner, { recursive: true, force: true });
});

// Jeder Test beginnt wie eine frische Installation (Testzeitraum längst abgelaufen).
beforeEach(() => {
    speicher.clear();
    speicher.set('lizenz_installiert_am', new Date(Date.now() - 100 * TAG).toISOString());
    umgebung.gesperrteSeriennummern.length = 0;
    uhr = Date.now();
    aufGeraet('rechner-a');
    online();
});

test('aktivierung-format.js ist in Rechnungstool und Dienst byte-identisch', () => {
    const hier = fs.readFileSync(path.join(WURZEL, 'src/main/services/aktivierung-format.js'));
    const dort = fs.readFileSync(path.join(DIENST, 'src/aktivierung-format.js'));
    assert.ok(hier.equals(dort), 'aktivierung-format.js weicht ab');
});

// lizenz-format.js darf nicht geändert werden; die beiden Kopien unterscheiden
// sich seit jeher nur im Kopfkommentar. Verglichen wird deshalb der Code.
test('lizenz-format.js: Code in Rechnungstool und Dienst identisch', () => {
    const code = (datei) => fs.readFileSync(datei, 'utf8').split('\n').filter((z) => !z.startsWith('//')).join('\n');
    assert.strictEqual(code(path.join(WURZEL, 'src/main/services/lizenz-format.js')), code(path.join(DIENST, 'src/lizenz-format.js')));
});

test('neuer Schlüssel: online aktivieren, danach offline freigeschaltet', async () => {
    const { schluessel } = neueLizenz();
    assert.strictEqual(lizenz.lizenzstatus().grund, 'abgelaufen');
    assert.strictEqual(await lizenz.schluesselEinloesen(schluessel), true);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'lizenziert');

    offline();
    uhr += 60 * TAG;
    assert.strictEqual(lizenz.lizenzstatus().grund, 'lizenziert');
    assert.strictEqual(await lizenz.hintergrundAbgleich(), false);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'lizenziert');
});

test('neuer Schlüssel ohne Internet: verständliche Meldung, nichts gespeichert', async () => {
    offline();
    const { schluessel } = neueLizenz();
    await assert.rejects(lizenz.schluesselEinloesen(schluessel), /Internetverbindung benötigt/);
    assert.strictEqual(speicher.get('lizenz_schluessel'), undefined);
    assert.strictEqual(lizenz.lizenzstatus().freigeschaltet, false);
});

test('Schlüssel schon auf anderem Computer aktiviert -> Meldung', async () => {
    const { schluessel } = neueLizenz();
    assert.strictEqual(await aufAnderemRechnerAktivieren(schluessel, 'rechner-x'), 200);
    await assert.rejects(lizenz.schluesselEinloesen(schluessel), /bereits auf einem anderen Computer aktiviert/);
    assert.strictEqual(lizenz.lizenzstatus().freigeschaltet, false);
});

test('ungültiger oder gefälschter Schlüssel -> false, ohne Online-Anfrage', async () => {
    umgebung.fetch = async () => { throw new Error('darf nicht aufgerufen werden'); };
    const fremd = crypto.generateKeyPairSync('ed25519').privateKey;
    const payload = payloadErstellen({ serial: 5 });
    assert.strictEqual(await lizenz.schluesselEinloesen(envelopeBauen(payload, crypto.sign(null, payloadZuBytes(payload), fremd))), false);
    assert.strictEqual(await lizenz.schluesselEinloesen('AP1.quatsch.quatsch'), false);
});

test('Token von einem anderen Gerät wird abgelehnt', async () => {
    const { schluessel } = neueLizenz();
    await lizenz.schluesselEinloesen(schluessel);
    aufGeraet('rechner-b'); // z.B. Datenbank auf einen anderen Rechner kopiert
    const status = lizenz.lizenzstatus();
    assert.strictEqual(status.freigeschaltet, false);
    assert.strictEqual(status.grund, 'aktivierung_noetig');
    assert.throws(() => lizenz.requireLizenz(), /online aktiviert/);
    // Der Hintergrundabgleich versucht zu aktivieren -> 409 -> anderer Rechner
    assert.strictEqual(await lizenz.hintergrundAbgleich(), false);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'anderer_rechner');
});

test('manipuliertes Token wird abgelehnt', async () => {
    const { schluessel } = neueLizenz();
    await lizenz.schluesselEinloesen(schluessel);
    offline();
    const [kopf, payload, signatur] = speicher.get('lizenz_aktivierung_token').split('.');
    const daten = JSON.parse(Buffer.from(payload, 'base64url'));
    daten.geraet = geraetAusRohId('rechner-b');
    speicher.set('lizenz_aktivierung_token', `${kopf}.${Buffer.from(JSON.stringify(daten)).toString('base64url')}.${signatur}`);
    aufGeraet('rechner-b');
    assert.strictEqual(lizenz.lizenzstatus().freigeschaltet, false);
    // Selbst signiertes Token mit fremdem Schlüssel
    const { tokenPayloadErstellen, tokenSignieren } = require(path.join(WURZEL, 'src/main/services/aktivierung-format'));
    const p = tokenPayloadErstellen({ serial: naechsteSerial - 1, geraet: geraetAusRohId('rechner-b') });
    speicher.set('lizenz_aktivierung_token', tokenSignieren(p, crypto.generateKeyPairSync('ed25519').privateKey));
    assert.strictEqual(lizenz.lizenzstatus().freigeschaltet, false);
});

test('Seriennummer auf der eingebauten Sperrliste -> gesperrt trotz Token', async () => {
    const { schluessel, serial } = neueLizenz();
    await lizenz.schluesselEinloesen(schluessel);
    umgebung.gesperrteSeriennummern.push(serial);
    const status = lizenz.lizenzstatus();
    assert.strictEqual(status.freigeschaltet, false);
    assert.strictEqual(status.grund, 'gesperrt');
    assert.throws(() => lizenz.requireLizenz(), /gesperrt/);
});

test('Bestandsschlüssel ohne Internet: 30 Tage Frist, danach Aktivierung nötig, online wieder frei', async () => {
    const { schluessel } = neueLizenz();
    speicher.set('lizenz_schluessel', schluessel); // vor dem Update eingelöst, kein Token
    offline();
    assert.strictEqual(await lizenz.hintergrundAbgleich(), false);
    let status = lizenz.lizenzstatus();
    assert.strictEqual(status.grund, 'aktivierung_ausstehend');
    assert.strictEqual(status.aktivierungTageVerbleibend, 30);
    assert.strictEqual(status.freigeschaltet, true);

    uhr += 29 * TAG;
    assert.strictEqual(lizenz.lizenzstatus().aktivierungTageVerbleibend, 1);
    uhr += 2 * TAG;
    assert.strictEqual(lizenz.lizenzstatus().grund, 'aktivierung_noetig');

    online();
    assert.strictEqual(await lizenz.hintergrundAbgleich(), true);
    status = lizenz.lizenzstatus();
    assert.strictEqual(status.grund, 'lizenziert');
});

test('Bestandsschlüssel mit Internet: wird beim Start still aktiviert', async () => {
    const { schluessel } = neueLizenz();
    speicher.set('lizenz_schluessel', schluessel);
    assert.strictEqual(await lizenz.hintergrundAbgleich(), false); // war schon frei (Frist), bleibt frei
    assert.strictEqual(lizenz.lizenzstatus().grund, 'lizenziert');
    assert.ok(speicher.get('lizenz_aktivierung_token').startsWith('AP1A.'));
});

test('geteilter Bestandsschlüssel: der erste Rechner gewinnt, der zweite wird gesperrt', async () => {
    const { schluessel } = neueLizenz();
    assert.strictEqual(await aufAnderemRechnerAktivieren(schluessel, 'rechner-erster'), 200);
    speicher.set('lizenz_schluessel', schluessel);
    assert.strictEqual(await lizenz.hintergrundAbgleich(), true);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'anderer_rechner');
});

test('Nachprüfung: Sperre greift nach 7 Tagen, Entsperren beim nächsten Start', async () => {
    const { schluessel, serial } = neueLizenz();
    await lizenz.schluesselEinloesen(schluessel);
    await admin('/admin/sperren', { serial, gesperrt: true });

    uhr += 3 * TAG; // noch nicht fällig
    assert.strictEqual(await lizenz.hintergrundAbgleich(), false);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'lizenziert');

    uhr += 5 * TAG;
    assert.strictEqual(await lizenz.hintergrundAbgleich(), true);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'gesperrt');

    await admin('/admin/sperren', { serial, gesperrt: false });
    assert.strictEqual(await lizenz.hintergrundAbgleich(), true); // gesperrte Installationen fragen bei jedem Start
    assert.strictEqual(lizenz.lizenzstatus().grund, 'lizenziert');
});

test('Rechnerwechsel: zurücksetzen, neuer Rechner aktiviert, alter wird bei der Nachprüfung gesperrt', async () => {
    const { schluessel, serial } = neueLizenz();
    await lizenz.schluesselEinloesen(schluessel);
    await admin('/admin/zuruecksetzen', { serial });

    uhr += 8 * TAG; // zurückgesetzt, aber noch kein neuer Rechner -> alter läuft weiter
    assert.strictEqual(await lizenz.hintergrundAbgleich(), false);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'lizenziert');

    assert.strictEqual(await aufAnderemRechnerAktivieren(schluessel, 'rechner-neu'), 200);
    uhr += 8 * TAG;
    assert.strictEqual(await lizenz.hintergrundAbgleich(), true);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'anderer_rechner');
});

test('nach Zurücksetzen kann der gesperrte Rechner mit "Erneut aktivieren" wieder frei werden', async () => {
    const { schluessel, serial } = neueLizenz();
    assert.strictEqual(await aufAnderemRechnerAktivieren(schluessel, 'rechner-alt'), 200);
    speicher.set('lizenz_schluessel', schluessel);
    await lizenz.hintergrundAbgleich();
    assert.strictEqual(lizenz.lizenzstatus().grund, 'anderer_rechner');
    await assert.rejects(lizenz.gespeichertenSchluesselAktivieren(), /bereits auf einem anderen Computer/);

    await admin('/admin/zuruecksetzen', { serial });
    assert.strictEqual(await lizenz.gespeichertenSchluesselAktivieren(), true);
    assert.strictEqual(lizenz.lizenzstatus().grund, 'lizenziert');
});

test('Testzeitraum unverändert: ohne Schlüssel 30 Tage frei', () => {
    speicher.set('lizenz_installiert_am', new Date().toISOString());
    const status = lizenz.lizenzstatus();
    assert.strictEqual(status.grund, 'testzeitraum');
    assert.strictEqual(status.freigeschaltet, true);
});
