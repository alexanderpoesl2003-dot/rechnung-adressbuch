// Aktivierungs-Token für das AP Rechnungstool. MUSS byte-identisch sein mit
// rechnung-adressbuch/src/main/services/aktivierung-format.js (ein Test
// vergleicht beide Kopien). Bei Änderungen IMMER beide Dateien nachziehen.
//
// Ein Token bestätigt: "Lizenz mit Seriennummer X ist auf Gerät Y aktiviert".
// Aufbau: "AP1A.<Base64Url(Payload-JSON)>.<Base64Url(Ed25519-Signatur)>"
// Signiert wird mit dem Aktivierungsschlüssel (NICHT mit dem Lizenz-
// Signierschlüssel) - der öffentliche Aktivierungsdienst kann so Geräte
// bestätigen, aber keine neuen Lizenzen erzeugen.
//
// "geraet" ist nie die Roh-Gerätekennung, sondern ein gekürzter SHA-256-Hash
// davon (siehe geraetAusRohId).
const crypto = require('crypto');

const PRODUCT_ID = 'ap-rechnungstool';
const FORMAT_VERSION = 1;
const PREFIX = 'AP1A';
const GERAET_MUSTER = /^[0-9a-f]{32}$/;

function b64urlEncode(buffer) {
    return Buffer.from(buffer).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function b64urlDecode(text) {
    const normalisiert = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const padLaenge = (4 - (normalisiert.length % 4)) % 4;
    return Buffer.from(normalisiert + '='.repeat(padLaenge), 'base64');
}

function geraetAusRohId(rohId) {
    const id = String(rohId || '').trim();
    if (!id) throw new Error('Leere Gerätekennung.');
    return crypto.createHash('sha256').update(`ap-rechnungstool:${id}`, 'utf8').digest('hex').slice(0, 32);
}

function tokenPayloadErstellen({ serial, geraet, aktiviertAm }) {
    if (!Number.isInteger(serial) || serial < 1) throw new Error('serial muss eine positive ganze Zahl sein.');
    if (!GERAET_MUSTER.test(String(geraet))) throw new Error('geraet hat ein ungültiges Format.');
    return {
        v: FORMAT_VERSION,
        productId: PRODUCT_ID,
        serial,
        geraet,
        aktiviertAm: aktiviertAm || new Date().toISOString()
    };
}

// Feste Feldreihenfolge, damit Signieren und Prüfen dieselben Bytes verwenden.
function tokenPayloadZuBytes(payload) {
    const geordnet = {
        v: payload.v,
        productId: payload.productId,
        serial: payload.serial,
        geraet: payload.geraet,
        aktiviertAm: payload.aktiviertAm
    };
    return Buffer.from(JSON.stringify(geordnet), 'utf8');
}

function tokenSignieren(payload, privateKey) {
    const signatur = crypto.sign(null, tokenPayloadZuBytes(payload), privateKey);
    return `${PREFIX}.${b64urlEncode(tokenPayloadZuBytes(payload))}.${b64urlEncode(signatur)}`;
}

// Gibt bei jedem Format-/Parsingfehler null zurück (nie eine Exception).
function tokenZerlegen(eingabe) {
    const teile = String(eingabe || '').trim().split('.');
    if (teile.length !== 3 || teile[0] !== PREFIX) return null;
    let payload;
    let signatur;
    try {
        payload = JSON.parse(b64urlDecode(teile[1]).toString('utf8'));
        signatur = b64urlDecode(teile[2]);
    } catch {
        return null;
    }
    if (typeof payload !== 'object' || payload === null) return null;
    return { payload, payloadBytes: tokenPayloadZuBytes(payload), signatur };
}

// Prüft Format, Felder und Signatur. Liefert den Payload oder null.
function tokenPruefen(token, publicKey) {
    const zerlegt = tokenZerlegen(token);
    if (!zerlegt) return null;
    const { payload, payloadBytes, signatur } = zerlegt;
    if (payload.v !== FORMAT_VERSION || payload.productId !== PRODUCT_ID) return null;
    if (!Number.isInteger(payload.serial) || payload.serial < 1) return null;
    if (!GERAET_MUSTER.test(String(payload.geraet))) return null;
    if (typeof payload.aktiviertAm !== 'string') return null;
    try {
        if (!crypto.verify(null, payloadBytes, publicKey, signatur)) return null;
    } catch {
        return null;
    }
    return payload;
}

module.exports = {
    PRODUCT_ID,
    FORMAT_VERSION,
    PREFIX,
    GERAET_MUSTER,
    geraetAusRohId,
    tokenPayloadErstellen,
    tokenPayloadZuBytes,
    tokenSignieren,
    tokenZerlegen,
    tokenPruefen
};
