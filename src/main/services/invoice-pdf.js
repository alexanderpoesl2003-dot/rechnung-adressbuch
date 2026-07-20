const fs = require('fs');
const PDFDocument = require('pdfkit');
const profiles = require('../models/profiles');
const customers = require('../models/customers');
const invoices = require('../models/invoices');
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

// Rendert eine Rechnung als PDF im Layout: Briefkopf/Logo, Absender- und
// Kundenanschrift, Rechnungskopf, Positionstabelle, Summenzeile (MwSt je
// verwendetem Satz getrennt in Euro ausgewiesen), Extrafeld und die
// gewählten Textbausteine/Freitext darunter.
// Gibt ein Promise zurück, das erst auflöst, wenn die Datei vollständig
// geschrieben wurde (pdfkit schreibt asynchron über einen Stream).
function renderInvoicePdf(invoiceId, outputPath) {
    const invoice = invoices.get(invoiceId);
    if (!invoice) throw new Error('Rechnung nicht gefunden.');

    const profile = profiles.get(invoice.sender_profile_id);
    const customer = customers.get(invoice.customer_id);

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
        const stream = fs.createWriteStream(outputPath);
        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
        doc.on('error', reject);
        doc.pipe(stream);

        drawBriefkopf(doc, profile);
        drawAnschriften(doc, profile, customer);
        drawBelegkopf(doc, 'Rechnung', [
            ['Rechnungsnummer', invoice.rechnungsnummer],
            ['Rechnungsdatum', formatDatum(invoice.rechnungsdatum)],
            ['Kundennummer', customer.kundennummer]
        ]);
        drawPositionstabelle(doc, invoice.positionen);
        drawSummenzeile(doc, invoice.summen);
        drawExtraText(doc, invoice.extra_text);
        drawTextbausteine(doc, invoice.textBausteine, invoice.freier_text);
        drawFusszeile(doc, profile);

        doc.end();
    });
}

module.exports = { renderInvoicePdf };
