const fs = require('fs');

const PAGE_MARGIN = 50;
const EUR = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatEur(value) {
    return `${EUR.format(value)} €`;
}

function formatDatum(isoDatum) {
    const [jahr, monat, tag] = isoDatum.split('-');
    return `${tag}.${monat}.${jahr}`;
}

// Deutsche Schreibweise für MwSt-Sätze mit Nachkommastellen, z.B. 7.8 -> "7,8"
function formatSatz(satz) {
    return String(satz).replace('.', ',');
}

const LOGO_BREITE = 140;
const LOGO_HOEHE = 70;
const SEITENBREITE_NUTZBAR = 495; // A4 (595pt) abzüglich zweier PAGE_MARGIN

function drawBriefkopf(doc, profile) {
    doc
        .fontSize(18)
        .font('Helvetica-Bold')
        .text(profile.briefkopf_name, PAGE_MARGIN, PAGE_MARGIN, {
            width: SEITENBREITE_NUTZBAR - LOGO_BREITE - 15
        });

    if (profile.logo_pfad && fs.existsSync(profile.logo_pfad)) {
        try {
            doc.image(
                profile.logo_pfad,
                PAGE_MARGIN + SEITENBREITE_NUTZBAR - LOGO_BREITE,
                PAGE_MARGIN,
                { fit: [LOGO_BREITE, LOGO_HOEHE] }
            );
        } catch (err) {
            // Beschädigtes/nicht unterstütztes Bildformat - Briefkopf ohne Logo fortsetzen
        }
    }
    doc.y = PAGE_MARGIN + LOGO_HOEHE + 10;
}

function drawAnschriften(doc, profile, customer) {
    const y = 140;
    doc
        .fontSize(8)
        .font('Helvetica')
        .text(
            [profile.briefkopf_name, profile.strasse, [profile.plz, profile.ort].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(' · '),
            PAGE_MARGIN,
            y
        );

    doc
        .fontSize(11)
        .text(
            [
                customer.anrede,
                customer.vorname_ansprechpartner,
                customer.nachname_firma,
                customer.strasse,
                [customer.plz, customer.ort].filter(Boolean).join(' ')
            ]
                .filter(Boolean)
                .join('\n'),
            PAGE_MARGIN,
            y + 20
        );
}

// Zeichnet Titel (z.B. "Rechnung", "Angebot") und darunter beliebige
// Label/Wert-Zeilen (z.B. Belegnummer, Datum, Kundennummer).
function drawBelegkopf(doc, titel, zeilen) {
    const y = 245;
    doc.fontSize(16).font('Helvetica-Bold').text(titel, PAGE_MARGIN, y);
    doc.fontSize(10).font('Helvetica');
    zeilen.forEach(([label, wert], index) => {
        doc.text(`${label}: ${wert}`, PAGE_MARGIN, y + 22 + index * 13);
    });
    doc.y = y + 22 + zeilen.length * 13 + 12;
}

const COLS = {
    artikel: { x: PAGE_MARGIN, width: 60 },
    bezeichnung: { x: PAGE_MARGIN + 60, width: 175 },
    menge: { x: PAGE_MARGIN + 235, width: 45 },
    ep: { x: PAGE_MARGIN + 280, width: 65 },
    mwst: { x: PAGE_MARGIN + 345, width: 45 },
    gesamt: { x: PAGE_MARGIN + 390, width: 65 }
};

// zeigtPreise=false blendet EP/MwSt/Gesamt aus (z.B. für Lieferscheine).
function drawPositionstabelle(doc, positionen, zeigtPreise = true) {
    const startY = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Art.-Nr.', COLS.artikel.x, startY, { width: COLS.artikel.width });
    doc.text('Bezeichnung', COLS.bezeichnung.x, startY, { width: COLS.bezeichnung.width });
    doc.text('Menge', COLS.menge.x, startY, { width: COLS.menge.width, align: 'right' });
    if (zeigtPreise) {
        doc.text('EP netto', COLS.ep.x, startY, { width: COLS.ep.width, align: 'right' });
        doc.text('MwSt', COLS.mwst.x, startY, { width: COLS.mwst.width, align: 'right' });
        doc.text('Gesamt', COLS.gesamt.x, startY, { width: COLS.gesamt.width, align: 'right' });
    }

    let y = startY + 15;
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + 455, y).strokeColor('#999').stroke();
    y += 5;

    doc.font('Helvetica').fontSize(9);
    for (const pos of positionen) {
        doc.text(pos.artikel_nr || '', COLS.artikel.x, y, { width: COLS.artikel.width });
        doc.text(pos.bezeichnung, COLS.bezeichnung.x, y, { width: COLS.bezeichnung.width });
        doc.text(String(pos.menge), COLS.menge.x, y, { width: COLS.menge.width, align: 'right' });
        if (zeigtPreise) {
            const zeilenGesamt = pos.menge * pos.einzelpreis_netto;
            doc.text(formatEur(pos.einzelpreis_netto), COLS.ep.x, y, { width: COLS.ep.width, align: 'right' });
            doc.text(`${formatSatz(pos.mwst_satz)}%`, COLS.mwst.x, y, { width: COLS.mwst.width, align: 'right' });
            doc.text(formatEur(zeilenGesamt), COLS.gesamt.x, y, { width: COLS.gesamt.width, align: 'right' });
        }
        y += 15;
    }

    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + 455, y).strokeColor('#999').stroke();
    doc.y = y + 8;
}

// summen.aufteilung: [{ satz, netto, mwstBetrag }, ...] - beliebig viele,
// je nach den auf den Positionen tatsächlich verwendeten MwSt-Sätzen.
function drawSummenzeile(doc, summen) {
    const labelX = PAGE_MARGIN + 280;
    const valueX = COLS.gesamt.x;
    let y = doc.y;

    doc.font('Helvetica').fontSize(9);
    const zeilen = [
        ['Nettosumme', summen.netto],
        ...summen.aufteilung.map((a) => [`zzgl. MwSt ${formatSatz(a.satz)}%`, a.mwstBetrag])
    ];

    for (const [label, value] of zeilen) {
        doc.text(label, labelX, y, { width: 110 });
        doc.text(formatEur(value), valueX, y, { width: COLS.gesamt.width, align: 'right' });
        y += 13;
    }

    doc.font('Helvetica-Bold');
    doc.text('Gesamtbetrag', labelX, y, { width: 110 });
    doc.text(formatEur(summen.brutto), valueX, y, { width: COLS.gesamt.width, align: 'right' });
    y += 20;

    doc.y = y;
}

// Rendert mehrere ausgewählte Textbausteine hintereinander sowie optional
// einen frei eingetippten Zusatztext ("Weitere Anmerkung").
function drawTextbausteine(doc, textBausteine, freierText) {
    for (const textBaustein of textBausteine || []) {
        doc
            .font('Helvetica-Bold')
            .fontSize(9)
            .text(textBaustein.titel, PAGE_MARGIN, doc.y);
        doc
            .font('Helvetica')
            .fontSize(8)
            .text(textBaustein.inhalt, PAGE_MARGIN, doc.y + 2, { width: 455 });
        doc.moveDown(0.6);
    }

    if (freierText) {
        doc.font('Helvetica-Bold').fontSize(9).text('Weitere Anmerkung', PAGE_MARGIN, doc.y);
        doc.font('Helvetica').fontSize(8).text(freierText, PAGE_MARGIN, doc.y + 2, { width: 455 });
        doc.moveDown(0.6);
    }
}

// Freies Extrafeld für individuelle Informationen (z.B. Lieferhinweis).
function drawExtraText(doc, extraText) {
    if (!extraText) return;
    doc.font('Helvetica').fontSize(8).text(extraText, PAGE_MARGIN, doc.y, { width: 455 });
    doc.moveDown(0.6);
}

function drawFusszeile(doc, profile) {
    const zeilen = [
        [profile.telefon && `Tel: ${profile.telefon}`, profile.email && `E-Mail: ${profile.email}`]
            .filter(Boolean)
            .join(' · '),
        [
            profile.bank_name && `Bank: ${profile.bank_name}`,
            profile.iban && `IBAN: ${profile.iban}`,
            profile.bic && `BIC: ${profile.bic}`
        ]
            .filter(Boolean)
            .join(' · '),
        profile.steuernummer && `Steuernummer: ${profile.steuernummer}`,
        profile.ust_id && `USt-IdNr.: ${profile.ust_id}`
    ].filter(Boolean);
    if (zeilen.length === 0) return;
    const text = zeilen.join('\n');

    doc.fontSize(7).font('Helvetica').fillColor('#555');
    // Fußzeile immer bündig über dem unteren Seitenrand platzieren (statt einer
    // fixen y-Position), damit sie unabhängig von der Anzahl gefüllter Zeilen
    // zuverlässig auf der aktuellen Seite bleibt und nicht knapp über den
    // unteren Rand hinausragt (was pdfkit sonst mit einem automatischen
    // Seitenumbruch quittiert).
    const hoehe = doc.heightOfString(text, { width: 495, align: 'center' });
    const y = doc.page.height - PAGE_MARGIN - hoehe;
    doc.text(text, PAGE_MARGIN, y, { width: 495, align: 'center' });
    doc.fillColor('#000');
}

module.exports = {
    PAGE_MARGIN,
    COLS,
    formatEur,
    formatDatum,
    formatSatz,
    drawBriefkopf,
    drawAnschriften,
    drawBelegkopf,
    drawPositionstabelle,
    drawSummenzeile,
    drawTextbausteine,
    drawExtraText,
    drawFusszeile
};
