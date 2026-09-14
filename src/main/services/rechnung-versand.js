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
const secretStorage = require('./secret-storage');
const { extractEmail } = require('./email');
const { formatDatum } = require('./pdf-common');

const SMTP_SCHLUESSEL = {
    host: 'smtp_host',
    port: 'smtp_port',
    benutzer: 'smtp_benutzer',
    // Alte, unverschlüsselte Speicherung (siehe Auftrag "SMTP-Sicherheit,
    // Secret-Handling und IPC-Härtung") - wird nur noch für die einmalige
    // Migration gelesen, nie mehr neu beschrieben.
    passwortKlartextAlt: 'smtp_passwort',
    // Neue, mit Electrons safeStorage verschlüsselte Speicherung (Base64-Text
    // in derselben bestehenden Schlüssel/Wert-Tabelle "einstellungen" - keine
    // neue Datenbank nur für Secrets, siehe Auftrag Punkt 16).
    passwortVerschluesselt: 'smtp_passwort_verschluesselt',
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

// Einmalige, verlustfreie Migration eines noch vorhandenen Klartext-
// Passworts (siehe Auftrag Punkt 3). Idempotent und gefahrlos wiederholbar:
// läuft ins Leere, sobald entweder kein Klartext mehr vorhanden ist oder
// bereits ein verschlüsselter Wert existiert. Der Klartext wird ERST
// geleert, nachdem die verschlüsselte Speicherung nachweislich geklappt hat -
// bei jedem Fehler bleibt der alte Wert unangetastet, es geht also nie
// Konfiguration verloren.
function migriereSmtpPasswortFallsNoetig() {
    const klartext = settings.getWert(SMTP_SCHLUESSEL.passwortKlartextAlt);
    const bereitsVerschluesselt = settings.getWert(SMTP_SCHLUESSEL.passwortVerschluesselt);
    if (!klartext || bereitsVerschluesselt) return;

    if (!secretStorage.verschluesselungVerfuegbar()) {
        // Bewusst NICHT den Klartext löschen und NICHT weiter versuchen - der
        // nächste Programmstart probiert es automatisch erneut, sobald die
        // sichere Speicherung (wieder) verfügbar ist. Kein stiller
        // Datenverlust, kein stiller Klartext-Fallback.
        console.error('SMTP-Passwort-Migration übersprungen: sichere Speicherung auf diesem System nicht verfügbar.');
        return;
    }

    try {
        const verschluesselt = secretStorage.verschluesseln(klartext);
        settings.setWert(SMTP_SCHLUESSEL.passwortVerschluesselt, verschluesselt);
        settings.setWert(SMTP_SCHLUESSEL.passwortKlartextAlt, '');
    } catch (err) {
        console.error('SMTP-Passwort-Migration fehlgeschlagen:', err.message);
    }
}

// Interne, NICHT exportierte Funktion mit dem entschlüsselten Passwort im
// Klartext - ausschließlich für den tatsächlichen Versand (siehe
// _transporter()) innerhalb dieser Datei verwendet. Verlässt den
// Main-Prozess nie (siehe getSmtpEinstellungen() weiter unten für die
// Renderer-taugliche, secret-freie Variante).
function _getSmtpKonfigurationRoh() {
    migriereSmtpPasswortFallsNoetig();
    const verschluesselt = settings.getWert(SMTP_SCHLUESSEL.passwortVerschluesselt);
    return {
        host: settings.getWert(SMTP_SCHLUESSEL.host) || '',
        port: settings.getWert(SMTP_SCHLUESSEL.port) || '587',
        benutzer: settings.getWert(SMTP_SCHLUESSEL.benutzer) || '',
        passwort: verschluesselt ? secretStorage.entschluesseln(verschluesselt) : '',
        absenderEmail: settings.getWert(SMTP_SCHLUESSEL.absenderEmail) || '',
        verschluesselung: settings.getWert(SMTP_SCHLUESSEL.verschluesselung) || 'tls'
    };
}

// Renderer-taugliche SMTP-Konfiguration OHNE jeden Passwortwert (weder
// Klartext noch verschlüsselt/Base64) - siehe Auftrag Punkt 4. Der Renderer
// erfährt nur, OB ein Passwort hinterlegt ist.
function getSmtpEinstellungen() {
    migriereSmtpPasswortFallsNoetig();
    return {
        host: settings.getWert(SMTP_SCHLUESSEL.host) || '',
        port: settings.getWert(SMTP_SCHLUESSEL.port) || '587',
        benutzer: settings.getWert(SMTP_SCHLUESSEL.benutzer) || '',
        passwortGespeichert: Boolean(settings.getWert(SMTP_SCHLUESSEL.passwortVerschluesselt)),
        absenderEmail: settings.getWert(SMTP_SCHLUESSEL.absenderEmail) || '',
        verschluesselung: settings.getWert(SMTP_SCHLUESSEL.verschluesselung) || 'tls'
    };
}

// Speichert die SMTP-Einstellungen. Für das Passwort gelten drei klar
// unterschiedene Fälle (siehe Auftrag Punkt 5):
//   A) daten.passwort leer/fehlt UND kein Lösch-Wunsch -> bestehendes Secret bleibt unangetastet
//   B) daten.passwort gesetzt                          -> altes Secret wird ersetzt, neu verschlüsselt
//   C) daten.passwortLoeschen === true (und kein neues Passwort eingegeben) -> Secret wird entfernt
function saveSmtpEinstellungen(daten) {
    settings.setWert(SMTP_SCHLUESSEL.host, daten.host || '');
    settings.setWert(SMTP_SCHLUESSEL.port, daten.port || '587');
    settings.setWert(SMTP_SCHLUESSEL.benutzer, daten.benutzer || '');

    if (daten.passwort) {
        // Fall B: neues Passwort ersetzt ein eventuell vorhandenes altes.
        settings.setWert(SMTP_SCHLUESSEL.passwortVerschluesselt, secretStorage.verschluesseln(daten.passwort));
    } else if (daten.passwortLoeschen) {
        // Fall C: explizite, eindeutige Aktion zum Entfernen des Passworts.
        settings.setWert(SMTP_SCHLUESSEL.passwortVerschluesselt, '');
    }
    // Fall A (Feld leer, kein Lösch-Wunsch): bewusst nichts tun - das
    // bestehende, bereits verschlüsselte Passwort bleibt unverändert.

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

// Ordnet einen Versandfehler einer der in Auftrag Punkt 6/15 geforderten,
// für Endnutzer verständlichen Kategorien zu - gibt NIE err.message direkt
// aus, da SMTP-Server-Antworten in Ausnahmefällen Teile der Kommunikation
// (z.B. den Benutzernamen) enthalten könnten. Der technische Fehler wird
// stattdessen separat (siehe Aufrufer) nur mit err.code intern geloggt.
function _klassifiziereSmtpFehler(err) {
    switch (err.code) {
        case 'EAUTH':
            return 'Die Anmeldung beim E-Mail-Server ist fehlgeschlagen. Bitte prüfen Sie Benutzername, Passwort und die SMTP-Einstellungen.';
        case 'ECONNECTION':
        case 'ETIMEDOUT':
        case 'ENOTFOUND':
        case 'EDNS':
            return 'Der E-Mail-Server konnte nicht erreicht werden. Bitte prüfen Sie die Internetverbindung sowie SMTP-Server und Port.';
        case 'ESOCKET':
            return 'Die verschlüsselte Verbindung zum E-Mail-Server ist fehlgeschlagen. Bitte prüfen Sie Verschlüsselung (TLS/SSL) und Port.';
        case 'EENVELOPE':
            return 'Die E-Mail-Adresse des Empfängers oder Absenders wurde vom E-Mail-Server abgelehnt. Bitte prüfen Sie die Adresse.';
        case 'EMESSAGE':
            return 'Die E-Mail wurde vom E-Mail-Server nicht angenommen.';
        default:
            return 'Der E-Mail-Versand ist fehlgeschlagen. Bitte prüfen Sie die E-Mail-Einstellungen.';
    }
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

    // Backend-seitige Absicherung (nicht nur UI, siehe Auftrag Block 1,
    // Punkt 11/12): eine noch nicht finalisierte Rechnung wird NICHT still
    // automatisch finalisiert und verschickt. Der Renderer führt den Nutzer
    // stattdessen durch einen bewussten "Erst abschließen, dann versenden"-
    // Ablauf (siehe view-invoices.js); dieser Check schützt zusätzlich auch
    // vor einem direkten IPC-Aufruf, der diesen Ablauf umgeht.
    if (invoice.status !== 'finalisiert') {
        return {
            versendet: false, empfaenger: null,
            fehler: 'Diese Rechnung ist noch ein Entwurf. Bitte zuerst über "Rechnung abschließen" finalisieren, bevor sie per E-Mail versendet wird.'
        };
    }

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

    // Die SMTP-Konfiguration inkl. entschlüsseltem Passwort wird ausschließlich
    // hier im Main-Prozess gelesen und verlässt diese Funktion nie - weder an
    // preload/renderer noch in Logs/Fehlermeldungen (siehe Auftrag Punkt 7).
    let smtp;
    try {
        smtp = _getSmtpKonfigurationRoh();
    } catch (err) {
        return { versendet: false, empfaenger, fehler: err.message };
    }
    if (smtp.benutzer && !smtp.passwort) {
        return {
            versendet: false, empfaenger,
            fehler: 'Für den E-Mail-Versand ist kein Passwort hinterlegt. Bitte in den E-Mail-Einstellungen ein Passwort eingeben.'
        };
    }

    const profile = profiles.get(invoice.sender_profile_id);
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
        console.error('Rechnungsversand fehlgeschlagen (Code:', err.code, ')');
        return { versendet: false, empfaenger, fehler: _klassifiziereSmtpFehler(err) };
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

    let smtp;
    try {
        smtp = _getSmtpKonfigurationRoh();
    } catch (err) {
        return { ok: false, fehler: err.message };
    }
    if (smtp.benutzer && !smtp.passwort) {
        return {
            ok: false,
            fehler: 'Für den E-Mail-Versand ist kein Passwort hinterlegt. Bitte in den E-Mail-Einstellungen ein Passwort eingeben.'
        };
    }

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
        console.error('Testmail fehlgeschlagen (Code:', err.code, ')');
        return { ok: false, fehler: _klassifiziereSmtpFehler(err) };
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
    migriereSmtpPasswortFallsNoetig,
    VERFUEGBARE_PLATZHALTER
};
