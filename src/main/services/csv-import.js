const iconv = require('iconv-lite');
const customers = require('../models/customers');

// Erkennt gängige Mojibake-Muster, die entstehen, wenn eine eigentlich
// Windows-1252-kodierte Datei (typischer Excel-CSV-Export) fälschlich als
// UTF-8 gelesen wird (z.B. "Ã¶" statt "ö", "ß" -> "ÃŸ").
const MOJIBAKE_PATTERN = /Ã[\x80-\xBF]|Â[\x80-\xBF]/;

// Liest CSV-Rohdaten (Buffer) robust als Text ein: bevorzugt UTF-8, erkennt
// aber typische Windows-1252-Fehlkodierungen und dekodiert dann neu.
function decodeCsvBuffer(buffer) {
    const utf8Text = buffer.toString('utf8');
    const hasReplacementChar = utf8Text.includes('�');

    if (!hasReplacementChar && !MOJIBAKE_PATTERN.test(utf8Text)) {
        // Byte-Order-Mark entfernen, falls vorhanden
        return utf8Text.replace(/^﻿/, '');
    }

    return iconv.decode(buffer, 'win1252');
}

function parseCsv(text) {
    const lines = text.split(/\r\n|\n|\r/).filter((line) => line.length > 0);
    if (lines.length === 0) return { header: [], rows: [] };

    const header = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(parseCsvLine);
    return { header, rows };
}

// Einfacher CSV-Zeilen-Parser mit Unterstützung für in Anführungszeichen
// stehende Felder (die Kommas oder Anführungszeichen enthalten können).
function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);
    return fields;
}

function parseDatum(wert) {
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((wert || '').trim());
    if (!match) return null;
    const [, tag, monat, jahr] = match;
    return `${jahr}-${monat}-${tag}`;
}

// Erwartete Spalten: Nachname/Firma,Vorname/Ansprechpartner,Anrede,Strasse,PLZ,Ort,
// Telefon/Email/Sonstiges,Datum_angelegt
function importCustomersFromBuffer(buffer) {
    const text = decodeCsvBuffer(buffer);
    const { header, rows } = parseCsv(text);

    const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
    const idx = {
        nachname_firma: col('Nachname/Firma'),
        vorname: col('Vorname/Ansprechpartner'),
        anrede: col('Anrede'),
        strasse: col('Strasse'),
        plz: col('PLZ'),
        ort: col('Ort'),
        kontakt: col('Telefon/Email/Sonstiges'),
        datum: col('Datum_angelegt')
    };

    if (idx.nachname_firma === -1) {
        throw new Error('CSV-Spalte "Nachname/Firma" wurde nicht gefunden. Import abgebrochen.');
    }

    const result = { importiert: 0, uebersprungen: 0, fehler: [] };

    for (const [rowIndex, row] of rows.entries()) {
        const nachnameFirma = (row[idx.nachname_firma] || '').trim();
        if (!nachnameFirma) {
            result.uebersprungen++;
            continue;
        }
        try {
            customers.create({
                nachname_firma: nachnameFirma,
                vorname_ansprechpartner: idx.vorname >= 0 ? row[idx.vorname] : null,
                anrede: idx.anrede >= 0 ? row[idx.anrede] : null,
                strasse: idx.strasse >= 0 ? row[idx.strasse] : null,
                plz: idx.plz >= 0 ? row[idx.plz] : null,
                ort: idx.ort >= 0 ? row[idx.ort] : null,
                kontakt: idx.kontakt >= 0 ? row[idx.kontakt] : null,
                angelegt_am: idx.datum >= 0 ? (parseDatum(row[idx.datum]) || undefined) : undefined
            });
            result.importiert++;
        } catch (err) {
            result.fehler.push(`Zeile ${rowIndex + 2}: ${err.message}`);
        }
    }

    return result;
}

module.exports = { importCustomersFromBuffer, decodeCsvBuffer, parseCsv };
