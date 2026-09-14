// Echter SMTP-E-Mail-Versand für Rechnungen (Server, Zugangsdaten einmal
// zentral in den Einstellungen hinterlegen, dann per Knopfdruck Rechnung +
// vorformulierter Text direkt raus - im Gegensatz zum bisherigen mailto:-Weg
// in services/email.js, der nur das Standard-Mailprogramm mit Text vorbefüllt
// und die PDF lediglich im Explorer zum manuellen Anhängen anzeigt).
//
// Baut 1:1 auf demselben Muster wie der E-Mail-Versand in der Versand-
// Software (AP-Versand, app/services/rechnung_versand.py) auf: SMTP-
// Zugangsdaten global über die App hinweg (nicht je Absenderprofil - siehe
// Auftrag "E-Mail-Versand im Rechnungstool"), frei editierbarer Text mit
// Platzhaltern, eigene Testmail-Funktion ohne echte Rechnungsnummer/-daten
// zu verbrauchen.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

const settings = require('../models/settings');
const invoices = require('../models/invoices');
const customers = require('../models/customers');
const profiles = require('../models/profiles');
const { extractEmail } = require('./email');
const { formatDatum } = require('./pdf-common');

const SMTP_SCHLUESSEL = {
    host: 'smtp_host',
    port: 'smtp_port',
    benutzer: 'smtp_benutzer',
    passwort: 'smtp_passwort',
    absenderEmail: 'smtp_absender_email',
    verschluesselung: 'smtp_verschluesselung' // 'tls' | 'ssl' | 'keine'
};

const EMAIL_TEXT_SCHLUESSEL = 'email_text_rechnung';

const STANDARD_EMAIL_TEXT =
    'Guten Tag,\n\n' +
    'anbei erhalten Sie die Rechnung {rechnungsnummer} von {firmenname} über {betrag}.\n\n' +
    'Bei Fragen antworten Sie gerne auf diese E-Mail.\n\n' +
    'Mit freundlichen Grüßen\n' +
    '{firmenname}';

// Platzhalter, die im frei editierbaren E-Mail-Text verwendet werden dürfen
// (siehe view-einstellungen.js, wird dort als Hinweistext angezeigt).
const VERFUEGBARE_PLATZHALTER = ['firmenname', 'kundenname', 'rechnungsnummer', 'rechnungsdatum', 'betrag'];

function getSmtpEinstellungen() {
    return {
        host: settings.getWert(SMTP_SCHLUESSEL.host) || '',
        port: settings.getWert(SMTP_SCHLUESSEL.port) || '587',
        benutzer: settings.getWert(SMTP_SCHLUESSEL.benutzer) || '',
        passwort: settings.getWert(SMTP_SCHLUESSEL.passwort) || '',
        absenderEmail: settings.getWert(SMTP_SCHLUESSEL.absenderEmail) || '',
        verschluesselung: settings.getWert(SMTP_SCHLUESSEL.verschluesselung) || 'tls'
    };
}

function saveSmtpEinstellungen(daten) {
    settings.setWert(SMTP_SCHLUESSEL.host, daten.host || '');
    settings.setWert(SMTP_SCHLUESSEL.port, daten.port || '587');
    settings.setWert(SMTP_SCHLUESSEL.benutzer, daten.benutzer || '');
    // Leeres Passwort-Feld beim Speichern NICHT als "Passwort löschen"
    // interpretieren - Browser/Electron-Formulare zeigen ein gespeichertes
    // Passwort aus Sicherheitsgründen üblicherweise nicht im Klartext an,
    // ein versehentliches erneutes Speichern ohne Passwort-Eingabe darf das
    // bereits hinterlegte Passwort daher nicht überschreiben.
    if (daten.passwort) {
        settings.setWert(SMTP_SCHLUESSEL.passwort, daten.passwort);
    }
    settings.setWert(SMTP_SCHLUESSEL.absenderEmail, daten.absenderEmail || '');
    settings.setWert(SMTP_SCHLUESSEL.verschluesselung, daten.verschluesselung || 'tls');
}

function getEmailText() {
    return settings.getWert(EMAIL_TEXT_SCHLUESSEL) || STANDARD_EMAIL_TEXT;
}

function saveEmailText(text) {
    settings.setWert(EMAIL_TEXT_SCHLUESSEL, text || STANDARD_EMAIL_TEXT);
}

function getEmailEinstellungen() {
    return { smtp: getSmtpEinstellungen(), emailText: getEmailText(), platzhalter: VERFUEGBARE_PLATZHALTER };
}

function saveEmailEinstellungen({ smtp, emailText }) {
    if (smtp) saveSmtpEinstellungen(smtp);
    if (emailText !== undefined) saveEmailText(emailText);
    return getEmailEinstellungen();
}

function istSmtpKonfiguriert() {
    const smtp = getSmtpEinstellungen();
    return Boolean(smtp.host && smtp.absenderEmail);
}

function _transporter(smtp) {
    const port = Number(smtp.port) || 587;
    return nodemailer.createTransport({
        host: smtp.host,
        port,
        secure: smtp.verschluesselung === 'ssl', // true = implizites TLS (meist Port 465)
        requireTLS: smtp.verschluesselung === 'tls', // erzwingt STARTTLS (meist Port 587)
        auth: smtp.benutzer ? { user: smtp.benutzer, pass: smtp.passwort } : undefined,
        connectionTimeout: 15000
    });
}

// Lässt unbekannte {platzhalter} unverändert stehen statt einen Fehler zu
// werfen - ein Tippfehler im Platzhalternamen im frei editierten Text darf
// den Versand nicht verhindern (siehe AP-Versand: _PlatzhalterSicher).
function _textRendern(vorlage, werte) {
    return String(vorlage).replace(/\{(\w+)\}/g, (treffer, name) => (
        Object.prototype.hasOwnProperty.call(werte, name) ? werte[name] : treffer
    ));
}

function _platzhalterWerte(invoice) {
    return {
        firmenname: invoice.profil_name || '',
        kundenname: invoice.kunde_name || '',
        rechnungsnummer: invoice.rechnungsnummer || '',
        rechnungsdatum: formatDatum(invoice.rechnungsdatum),
        betrag: `${(invoice.summen.brutto).toFixed(2).replace('.', ',')} €`
    };
}

async function _emailSenden(smtp, { empfaenger, absender, betreff, text, anhangPfad, anhangDateiname }) {
    const transporter = _transporter(smtp);
    try {
        await transporter.sendMail({
            from: absender,
            to: empfaenger,
            subject: betreff,
            text,
            attachments: anhangPfad
                ? [{ filename: anhangDateiname, path: anhangPfad }]
                : []
        });
    } finally {
        transporter.close();
    }
}

// Zentrale Funktion für den "Per E-Mail senden"-Knopf bei Rechnungen (siehe
// register.js: invoices:sendEmail). Rendert die Rechnung als PDF an einen
// temporären Ort (Aufrufer übergibt renderInvoicePdf, um einen Zirkelbezug
// zu vermeiden - invoice-pdf.js benötigt selbst keine Kenntnis vom
// E-Mail-Versand) und verschickt sie über den zentral konfigurierten SMTP-
// Zugang. Wirft NIE - jeder Fehlerfall (keine E-Mail-Adresse, SMTP nicht
// eingerichtet, Verbindungsproblem) landet im Ergebnis-Objekt, damit die
// Renderer-Seite dem Nutzer eine verständliche Meldung zeigen kann, statt
// eine rote Konsolen-Fehlermeldung.
async function rechnungPerEmailSenden(invoiceId, renderInvoicePdfFn) {
    const invoice = invoices.get(invoiceId);
    if (!invoice) return { versendet: false, empfaenger: null, fehler: 'Rechnung nicht gefunden.' };

    const customer = customers.get(invoice.customer_id);
    const empfaenger = extractEmail(customer.kontakt);
    if (!empfaenger) {
        return {
            versendet: false, empfaenger: null,
            fehler: 'Für diesen Kunden ist keine E-Mail-Adresse im Kontaktfeld hinterlegt.'
        };
    }

    if (!istSmtpKonfiguriert()) {
        return {
            versendet: false, empfaenger,
            fehler: 'E-Mail-Versand ist noch nicht eingerichtet (Einstellungen -> E-Mail-Versand).'
        };
    }

    const profile = profiles.get(invoice.sender_profile_id);
    const smtp = getSmtpEinstellungen();
    const absender = (profile && profile.email) || smtp.absenderEmail;

    const dateiname = `${invoice.rechnungsnummer.replace(/[^\w-]/g, '_')}-${Date.now()}.pdf`;
    const pdfPfad = path.join(require('electron').app.getPath('temp'), dateiname);
    await renderInvoicePdfFn(invoiceId, pdfPfad);

    try {
        await _emailSenden(smtp, {
            empfaenger,
            absender,
            betreff: `Rechnung ${invoice.rechnungsnummer} von ${invoice.profil_name}`,
            text: _textRendern(getEmailText(), _platzhalterWerte(invoice)),
            anhangPfad: pdfPfad,
            anhangDateiname: `Rechnung_${invoice.rechnungsnummer}.pdf`
        });
        return { versendet: true, empfaenger, fehler: null };
    } catch (err) {
        return { versendet: false, empfaenger, fehler: err.message };
    } finally {
        fs.unlink(pdfPfad, () => {});
    }
}

// Baut eine simple, eigenständige Beispiel-PDF (KEINE echte Rechnung, kein
// Zugriff auf sender_profiles/customers/invoices nötig) - die Testmail darf
// unter keinen Umständen eine echte Rechnungsnummer aus einem
// Absenderprofil-Zähler verbrauchen (siehe AP-Versand: testmail_senden()).
function _testPdfErzeugen(pfad) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const stream = fs.createWriteStream(pfad);
        doc.pipe(stream);
        doc.fontSize(18).text('Beispiel-Rechnung (Testmail)', { align: 'left' });
        doc.moveDown();
        doc.fontSize(11).text(
            'Dies ist eine Testmail zur Überprüfung der E-Mail-Einstellungen - ' +
            'kein echter Vorgang, keine echte Rechnungsnummer wurde dafür verbraucht.'
        );
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

async function testmailSenden(empfaenger, emailText) {
    if (!istSmtpKonfiguriert()) {
        return { ok: false, fehler: 'E-Mail-Versand ist noch nicht eingerichtet.' };
    }
    if (!empfaenger) {
        return { ok: false, fehler: 'Bitte eine Test-Empfängeradresse angeben.' };
    }

    const smtp = getSmtpEinstellungen();
    const musterWerte = {
        firmenname: 'Beispiel-Firma',
        kundenname: 'Max Mustermann',
        rechnungsnummer: 'MUSTER-VORSCHAU',
        rechnungsdatum: formatDatum(new Date().toISOString().slice(0, 10)),
        betrag: '19,99 €'
    };

    const tempPfad = path.join(require('electron').app.getPath('temp'), `testmail-${Date.now()}.pdf`);
    try {
        await _testPdfErzeugen(tempPfad);
        await _emailSenden(smtp, {
            empfaenger,
            absender: smtp.absenderEmail,
            betreff: 'Testmail: Rechnungsversand',
            text: _textRendern(emailText || getEmailText(), musterWerte),
            anhangPfad: tempPfad,
            anhangDateiname: 'Beispiel-Rechnung.pdf'
        });
        return { ok: true, fehler: null };
    } catch (err) {
        return { ok: false, fehler: err.message };
    } finally {
        fs.unlink(tempPfad, () => {});
    }
}

module.exports = {
    getEmailEinstellungen,
    saveEmailEinstellungen,
    istSmtpKonfiguriert,
    rechnungPerEmailSenden,
    testmailSenden,
    VERFUEGBARE_PLATZHALTER
};
