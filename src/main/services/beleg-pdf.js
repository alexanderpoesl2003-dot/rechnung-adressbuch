const fs = require('fs');
const PDFDocument = require('pdfkit');
const profiles = require('../models/profiles');
const customers = require('../models/customers');
const belege = require('../models/belege');
const invoices = require('../models/invoices');
const { BELEG_TYPEN } = require('../beleg-typen');
const {
    PAGE_MARGIN,
    formatDatum,
    drawBriefkopf,
    drawAnschriften,
    drawBelegkopf,
    drawPositionstabelle,
    drawSummenzeile,
    drawExtraText,
    drawTextbausteine,
    drawFusszeile
} = require('./pdf-common');

// Rendert Angebot, Auftragsbestätigung, Lieferschein oder Korrektur-Rechnung.
// Lieferscheine werden ohne Preise/Summenzeile ausgegeben (siehe BELEG_TYPEN).
function renderBelegPdf(belegId, outputPath) {
    const beleg = belege.get(belegId);
    if (!beleg) throw new Error('Beleg nicht gefunden.');

    const typDef = BELEG_TYPEN[beleg.typ];
    if (!typDef) throw new Error(`Unbekannte Belegart: ${beleg.typ}`);

    const profile = profiles.get(beleg.sender_profile_id);
    const customer = customers.get(beleg.customer_id);

    const kopfZeilen = [
        [`${typDef.bezeichnung}-Nr.`, beleg.belegnummer],
        ['Datum', formatDatum(beleg.belegdatum)],
        ['Kundennummer', customer.kundennummer]
    ];
    if (beleg.bezug_invoice_id) {
        const bezugRechnung = invoices.get(beleg.bezug_invoice_id);
        if (bezugRechnung) kopfZeilen.push(['Bezug', `Rechnung ${bezugRechnung.rechnungsnummer}`]);
    }

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
        const stream = fs.createWriteStream(outputPath);
        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
        doc.on('error', reject);
        doc.pipe(stream);

        drawBriefkopf(doc, profile);
        drawAnschriften(doc, profile, customer);
        drawBelegkopf(doc, typDef.bezeichnung, kopfZeilen);
        drawPositionstabelle(doc, beleg.positionen, typDef.zeigtPreise);
        if (typDef.zeigtPreise) drawSummenzeile(doc, beleg.summen);
        if (beleg.typ === 'barbeleg') {
            doc.font('Helvetica-Bold').fontSize(9).text('Betrag dankend in bar erhalten.', PAGE_MARGIN, doc.y);
            doc.moveDown(1);
        }
        drawExtraText(doc, beleg.extra_text);
        drawTextbausteine(doc, beleg.textBausteine, beleg.freier_text);
        drawFusszeile(doc, profile);

        doc.end();
    });
}

module.exports = { renderBelegPdf };
