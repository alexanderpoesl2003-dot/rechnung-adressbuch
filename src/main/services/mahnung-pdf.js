const fs = require('fs');
const PDFDocument = require('pdfkit');
const profiles = require('../models/profiles');
const customers = require('../models/customers');
const invoices = require('../models/invoices');
const mahnungen = require('../models/mahnungen');
const {
    PAGE_MARGIN,
    formatDatum,
    formatEur,
    drawBriefkopf,
    drawAnschriften,
    drawBelegkopf,
    drawFusszeile
} = require('./pdf-common');

// Mahnungen haben keine Positionstabelle, sondern verweisen auf den offenen
// Betrag der referenzierten Rechnung und enthalten einen freien Mahntext.
function renderMahnungPdf(mahnungId, outputPath) {
    const mahnung = mahnungen.get(mahnungId);
    if (!mahnung) throw new Error('Mahnung nicht gefunden.');

    const profile = profiles.get(mahnung.sender_profile_id);
    const customer = customers.get(mahnung.customer_id);
    const rechnung = invoices.get(mahnung.bezug_invoice_id);
    const offenerBetrag = rechnung
        ? Math.round((rechnung.summen.brutto - (rechnung.bezahlt_betrag || 0)) * 100) / 100
        : null;

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
        const stream = fs.createWriteStream(outputPath);
        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
        doc.on('error', reject);
        doc.pipe(stream);

        drawBriefkopf(doc, profile);
        drawAnschriften(doc, profile, customer);
        drawBelegkopf(doc, 'Mahnung', [
            ['Mahnungs-Nr.', mahnung.belegnummer],
            ['Datum', formatDatum(mahnung.belegdatum)],
            ['Rechnungsnummer', rechnung ? rechnung.rechnungsnummer : '-'],
            ['Rechnungsdatum', rechnung ? formatDatum(rechnung.rechnungsdatum) : '-'],
            ['Offener Betrag', offenerBetrag != null ? formatEur(offenerBetrag) : '-']
        ]);

        if (mahnung.mahntext) {
            doc.font('Helvetica').fontSize(10).text(mahnung.mahntext, PAGE_MARGIN, doc.y, { width: 455 });
        }

        drawFusszeile(doc, profile);
        doc.end();
    });
}

module.exports = { renderMahnungPdf };
