// Kanonisches, Ed25519-signiertes Lizenzformat (siehe Auftrag "Backup/Restore,
// Lizenzsystem, Distribution und Signing-Vorbereitung", Block 3). MUSS exakt
// derselben Logik wie ap-lizenzverwaltung/src/lizenz-format.js entsprechen
// (gleiches Format, gleiche Kodierung) - sonst kann dieses Rechnungstool die
// dort erzeugten Lizenzen nicht verifizieren. Bei Änderungen hier IMMER auch
// dort nachziehen (oder umgekehrt). Nur envelopeZerlegen() wird hier
// tatsächlich verwendet (Prüfung) - payloadErstellen()/envelopeBauen() sind
// nur für die signierende Seite (Lizenzverwaltungs-Tool) relevant und liegen
// hier nur, damit beide Dateien Byte-für-Byte identisch bleiben.
//
// Aufbau eines Lizenzcodes: "AP1.<Base64Url(Payload-JSON)>.<Base64Url(Signatur)>"
// - "AP1" markiert Format+Version, damit künftige Formate eindeutig
//   unterscheidbar bleiben und ein altes HMAC-Format (AP-XXXXX-XXXX-XXXX)
//   nie versehentlich als neues Format fehlinterpretiert wird.
// - Payload ist ein kleines, unverschlüsseltes JSON-Objekt (kein Geheimnis -
//   nur signiert, nicht verschlüsselt: die Nutzdaten selbst müssen nicht
//   geheim sein, nur fälschungssicher).
// - Die Signatur ist eine Ed25519-Signatur (64 Byte) über die exakten
//   UTF-8-Bytes des Payload-JSON-Strings.
const PRODUCT_ID = 'ap-rechnungstool';
const FORMAT_VERSION = 1;
const PREFIX = 'AP1';

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

// Baut das Nutzdaten-Objekt einer neuen Lizenz. ref ist optional (z.B. Name/
// interne Referenz des Käufers) - bewusst NICHT zwingend, um nicht unnötig
// personenbezogene Daten in jeden weitergegebenen Lizenzcode einzubetten.
function payloadErstellen({ serial, issuedAt, ref }) {
    if (!Number.isInteger(serial) || serial < 1) {
        throw new Error('serial muss eine positive ganze Zahl sein.');
    }
    const payload = {
        v: FORMAT_VERSION,
        productId: PRODUCT_ID,
        serial,
        issuedAt: issuedAt || new Date().toISOString()
    };
    if (ref) payload.ref = String(ref);
    return payload;
}

// Deterministische JSON-Serialisierung: feste Feldreihenfolge, damit Signieren
// (hier) und Verifizieren (Rechnungstool) exakt dieselben Bytes verwenden -
// sich auf die Objekt-Einfügereihenfolge von JSON.stringify zu verlassen wäre
// bei zusätzlichen/fehlenden optionalen Feldern fehleranfällig.
function payloadZuBytes(payload) {
    const geordnet = {
        v: payload.v,
        productId: payload.productId,
        serial: payload.serial,
        issuedAt: payload.issuedAt
    };
    if (payload.ref !== undefined) geordnet.ref = payload.ref;
    return Buffer.from(JSON.stringify(geordnet), 'utf8');
}

function envelopeBauen(payload, signaturBuffer) {
    return `${PREFIX}.${b64urlEncode(payloadZuBytes(payload))}.${b64urlEncode(signaturBuffer)}`;
}

// Zerlegt einen eingegebenen Lizenzcode in Payload + Rohbytes + Signatur.
// Gibt bei jedem Format-/Parsingfehler null zurück (nie eine Exception) -
// der Aufrufer muss nur auf null prüfen.
function envelopeZerlegen(eingabe) {
    const bereinigt = String(eingabe || '').trim();
    const teile = bereinigt.split('.');
    if (teile.length !== 3 || teile[0] !== PREFIX) return null;

    let payload;
    let payloadBytes;
    let signatur;
    try {
        payloadBytes = b64urlDecode(teile[1]);
        payload = JSON.parse(payloadBytes.toString('utf8'));
        signatur = b64urlDecode(teile[2]);
    } catch {
        return null;
    }
    if (typeof payload !== 'object' || payload === null) return null;
    // payloadBytes wird für die Signaturprüfung neu aus dem geparsten Payload
    // aufgebaut (nicht direkt aus dem Base64-Roheingang übernommen) - so
    // verifiziert die Prüfung immer exakt dieselben kanonischen Bytes, die
    // auch beim Signieren erzeugt wurden, unabhängig von eventuellen
    // Whitespace-/Feldreihenfolge-Unterschieden im übermittelten JSON.
    return { payload, payloadBytes: payloadZuBytes(payload), signatur };
}

module.exports = {
    PRODUCT_ID,
    FORMAT_VERSION,
    PREFIX,
    payloadErstellen,
    payloadZuBytes,
    envelopeBauen,
    envelopeZerlegen
};
