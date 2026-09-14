const { app, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const profiles = require('../models/profiles');
const customers = require('../models/customers');
const invoices = require('../models/invoices');
const artikel = require('../models/artikel');
const belege = require('../models/belege');
const mahnungen = require('../models/mahnungen');
const notizen = require('../models/notizen');
const search = require('../models/search');
const { erstelleBackup } = require('../services/backup');
const settings = require('../models/settings');
const mwstSaetze = require('../models/mwst-saetze');
const { BELEG_TYPEN } = require('../beleg-typen');
const { importCustomersFromBuffer } = require('../services/csv-import');
const { renderInvoicePdf } = require('../services/invoice-pdf');
const { renderBelegPdf } = require('../services/beleg-pdf');
const { renderMahnungPdf } = require('../services/mahnung-pdf');
const { extractEmail, buildMailto } = require('../services/email');
const rechnungVersand = require('../services/rechnung-versand');
const lizenz = require('../services/lizenz');
const { oeffneVorschauFenster, druckePdf } = require('../pdf-fenster');
const { getLogosDir } = require('../db');
const { checkForUpdatesManuell } = require('../updater');
const textBausteine = require('../models/text-bausteine');

// Rendert eine PDF an einen temporären, eindeutig benannten Ort.
async function renderTempPdf(nummer, renderFn, id) {
    const dateiname = `${nummer.replace(/[^\w-]/g, '_')}-${Date.now()}.pdf`;
    const pdfPfad = path.join(app.getPath('temp'), dateiname);
    await renderFn(id, pdfPfad);
    return pdfPfad;
}

// Erzeugt die PDF eines Belegs an einem temporären Ort, zeigt sie im
// Explorer an (zum manuellen Anhängen) und öffnet das Standard-Mailprogramm
// mit vorausgefülltem Betreff/Text. mailto: kann keine Anhänge übertragen.
async function bereiteEmailVor({ nummer, kontakt, betreffPrefix, renderFn, id }) {
    const pdfPfad = await renderTempPdf(nummer, renderFn, id);
    shell.showItemInFolder(pdfPfad);

    const empfaenger = extractEmail(kontakt);
    const betreff = `${betreffPrefix} ${nummer}`;
    const text = `Guten Tag,\n\nanbei erhalten Sie ${betreffPrefix.toLowerCase()} ${nummer} als PDF.\n` +
        `Die Datei wurde im Explorer geöffnet - bitte an diese E-Mail anhängen.\n\nMit freundlichen Grüßen`;
    shell.openExternal(buildMailto(empfaenger, betreff, text));

    return { pdfPfad, empfaenger };
}

// Öffnet die Vorschau eines Belegs (eigenes Fenster, Chromium-PDF-Viewer).
async function zeigeVorschau(nummer, renderFn, id) {
    const pdfPfad = await renderTempPdf(nummer, renderFn, id);
    oeffneVorschauFenster(pdfPfad, nummer);
    return { pdfPfad };
}

// Druckt einen Beleg direkt über den nativen Systemdruckdialog.
async function druckeBeleg(nummer, renderFn, id) {
    const pdfPfad = await renderTempPdf(nummer, renderFn, id);
    await druckePdf(pdfPfad);
    return { pdfPfad };
}

function formatDatumDe(iso) {
    if (!iso) return '';
    const [jahr, monat, tag] = iso.split('-');
    return `${tag}.${monat}.${jahr}`;
}

function formatZahlDe(n) {
    return (Number(n) || 0).toFixed(2).replace('.', ',');
}

function csvFeld(wert) {
    const s = String(wert ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => {
        try {
            return { ok: true, data: await fn(...args) };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });
}

function registerIpcHandlers() {
    // Absenderprofile
    handle('profiles:list', () => profiles.list());
    handle('profiles:get', (id) => profiles.get(id));
    handle('profiles:create', (data) => profiles.create(data));
    handle('profiles:update', (id, data) => profiles.update(id, data));
    handle('profiles:remove', (id) => profiles.remove(id));

    // Adressbuch
    handle('customers:list', () => customers.list());
    handle('customers:get', (id) => customers.get(id));
    handle('customers:create', (data) => customers.create(data));
    handle('customers:update', (id, data) => customers.update(id, data));
    handle('customers:remove', (id) => customers.remove(id));
    handle('customers:nextKundennummer', () => customers.nextKundennummer());
    handle('customers:lookupOrtByPlz', (plz) => customers.lookupOrtByPlz(plz));

    // CSV-Import
    handle('customers:importCsv', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Adressbuch-CSV importieren',
            filters: [{ name: 'CSV-Dateien', extensions: ['csv'] }],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) return null;

        const buffer = fs.readFileSync(result.filePaths[0]);
        return importCustomersFromBuffer(buffer);
    });

    // Rechnungen
    handle('invoices:list', () => invoices.list());
    handle('invoices:get', (id) => invoices.get(id));
    handle('invoices:create', (data) => invoices.create(data));
    handle('invoices:update', (id, data) => invoices.update(id, data));
    handle('invoices:updateStatus', (id, status) => invoices.updateStatus(id, status));
    handle('invoices:remove', (id) => invoices.remove(id));
    handle('invoices:listTextBausteine', () => invoices.listTextBausteine());
    handle('invoices:listByCustomer', (customerId) => invoices.listByCustomer(customerId));
    handle('invoices:statistik', (params) => invoices.statistik(params || {}));

    // Übergreifende Suche über Kunden, Rechnungen und Notizen
    handle('search:global', (query) => search.globalSearch(query));

    // Steuerberater-Export: frei wählbarer Zeitraum, optional je Absenderprofil
    handle('invoices:exportSteuerberaterCsv', async (params) => {
        const rows = invoices.exportSteuerberaterRows(params || {});
        const zeitstempel = new Date().toISOString().slice(0, 10);
        const result = await dialog.showSaveDialog({
            title: 'Steuerberater-Export speichern',
            defaultPath: `Steuerberater-Export-${zeitstempel}.csv`,
            filters: [{ name: 'CSV-Dateien', extensions: ['csv'] }]
        });
        if (result.canceled || !result.filePath) return null;

        const header = ['Rechnungsnummer', 'Datum', 'Absenderprofil', 'Kunde', 'Netto', 'MwSt', 'Brutto', 'Status', 'Bezahlt', 'Bezahlt am'];
        const zeilen = [header.join(';')];
        for (const r of rows) {
            zeilen.push([
                r.rechnungsnummer,
                formatDatumDe(r.rechnungsdatum),
                r.profil,
                r.kunde,
                formatZahlDe(r.netto),
                formatZahlDe(r.mwst),
                formatZahlDe(r.brutto),
                r.status,
                r.bezahlt,
                formatDatumDe(r.bezahltAm)
            ].map(csvFeld).join(';'));
        }

        const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
        fs.writeFileSync(result.filePath, Buffer.concat([bom, Buffer.from(zeilen.join('\r\n'), 'utf8')]));
        shell.showItemInFolder(result.filePath);
        return { pfad: result.filePath, anzahl: rows.length };
    });

    // PDF-Export
    handle('invoices:exportPdf', async (id) => {
        const invoice = invoices.get(id);
        const result = await dialog.showSaveDialog({
            title: 'Rechnung als PDF speichern',
            defaultPath: `${invoice.rechnungsnummer}.pdf`,
            filters: [{ name: 'PDF-Dateien', extensions: ['pdf'] }]
        });
        if (result.canceled || !result.filePath) return null;

        await renderInvoicePdf(id, result.filePath);
        shell.showItemInFolder(result.filePath);
        return { pfad: result.filePath };
    });

    // Rechnung: Vorschau & Direktdruck
    handle('invoices:previewPdf', (id) => zeigeVorschau(invoices.get(id).rechnungsnummer, renderInvoicePdf, id));
    handle('invoices:print', (id) => druckeBeleg(invoices.get(id).rechnungsnummer, renderInvoicePdf, id));

    // Rechnung per E-Mail versenden - echter SMTP-Versand (siehe Auftrag
    // "E-Mail-Versand im Rechnungstool", services/rechnung-versand.js),
    // löst den bisherigen mailto:-Weg für Rechnungen ab. Belege/Mahnungen
    // (weiter unten) nutzen unverändert den mailto:-Weg, da dafür nicht
    // gefragt wurde.
    handle('invoices:sendEmail', (id) => rechnungVersand.rechnungPerEmailSenden(id, renderInvoicePdf));

    // E-Mail-Versand-Einstellungen (SMTP, Vorlagentext) - global für die
    // ganze App, siehe Auftrag "E-Mail-Versand im Rechnungstool".
    handle('emailVersand:get', () => rechnungVersand.getEmailEinstellungen());
    handle('emailVersand:save', (daten) => rechnungVersand.saveEmailEinstellungen(daten));
    handle('emailVersand:testmail', (empfaenger, emailText) => rechnungVersand.testmailSenden(empfaenger, emailText));

    // Artikel-Stammdaten
    handle('artikel:list', () => artikel.list());
    handle('artikel:get', (id) => artikel.get(id));
    handle('artikel:findByNr', (nr) => artikel.findByNr(nr));
    handle('artikel:create', (data) => artikel.create(data));
    handle('artikel:update', (id, data) => artikel.update(id, data));
    handle('artikel:remove', (id) => artikel.remove(id));

    // Weitere Belegarten (Angebot, Auftragsbestätigung, Lieferschein, Korrektur-Rechnung)
    handle('belege:typen', () => BELEG_TYPEN);
    handle('belege:list', (typ) => belege.list(typ));
    handle('belege:get', (id) => belege.get(id));
    handle('belege:create', (typ, data) => belege.create(typ, data));
    handle('belege:remove', (id) => belege.remove(id));
    handle('belege:exportPdf', async (id) => {
        const beleg = belege.get(id);
        const result = await dialog.showSaveDialog({
            title: 'Beleg als PDF speichern',
            defaultPath: `${beleg.belegnummer}.pdf`,
            filters: [{ name: 'PDF-Dateien', extensions: ['pdf'] }]
        });
        if (result.canceled || !result.filePath) return null;

        await renderBelegPdf(id, result.filePath);
        shell.showItemInFolder(result.filePath);
        return { pfad: result.filePath };
    });

    // Beleg: Vorschau & Direktdruck
    handle('belege:previewPdf', (id) => zeigeVorschau(belege.get(id).belegnummer, renderBelegPdf, id));
    handle('belege:print', (id) => druckeBeleg(belege.get(id).belegnummer, renderBelegPdf, id));

    // Beleg per E-Mail versenden
    handle('belege:sendEmail', async (id) => {
        const beleg = belege.get(id);
        const customer = customers.get(beleg.customer_id);
        return bereiteEmailVor({
            nummer: beleg.belegnummer,
            kontakt: customer.kontakt,
            betreffPrefix: BELEG_TYPEN[beleg.typ].bezeichnung,
            renderFn: renderBelegPdf,
            id
        });
    });

    // Mahnungen
    handle('mahnungen:list', () => mahnungen.list());
    handle('mahnungen:get', (id) => mahnungen.get(id));
    handle('mahnungen:create', (data) => mahnungen.create(data));
    handle('mahnungen:remove', (id) => mahnungen.remove(id));
    handle('mahnungen:exportPdf', async (id) => {
        const mahnung = mahnungen.get(id);
        const result = await dialog.showSaveDialog({
            title: 'Mahnung als PDF speichern',
            defaultPath: `${mahnung.belegnummer}.pdf`,
            filters: [{ name: 'PDF-Dateien', extensions: ['pdf'] }]
        });
        if (result.canceled || !result.filePath) return null;

        await renderMahnungPdf(id, result.filePath);
        shell.showItemInFolder(result.filePath);
        return { pfad: result.filePath };
    });

    // Mahnung: Vorschau & Direktdruck
    handle('mahnungen:previewPdf', (id) => zeigeVorschau(mahnungen.get(id).belegnummer, renderMahnungPdf, id));
    handle('mahnungen:print', (id) => druckeBeleg(mahnungen.get(id).belegnummer, renderMahnungPdf, id));

    // Mahnung per E-Mail versenden
    handle('mahnungen:sendEmail', async (id) => {
        const mahnung = mahnungen.get(id);
        const customer = customers.get(mahnung.customer_id);
        return bereiteEmailVor({
            nummer: mahnung.belegnummer,
            kontakt: customer.kontakt,
            betreffPrefix: 'Mahnung',
            renderFn: renderMahnungPdf,
            id
        });
    });

    // App-Info
    handle('app:version', () => app.getVersion());
    handle('app:checkForUpdates', () => checkForUpdatesManuell());

    // Rechnung bezahlt / Offene-Posten
    handle('invoices:markBezahlt', (id, data) => invoices.markBezahlt(id, data));
    handle('invoices:offenePosten', () => invoices.offenePosten());

    // Notizen
    handle('notizen:list', () => notizen.list());
    handle('notizen:create', (data) => notizen.create(data));
    handle('notizen:update', (id, data) => notizen.update(id, data));
    handle('notizen:setErledigt', (id, erledigt) => notizen.setErledigt(id, erledigt));
    handle('notizen:remove', (id) => notizen.remove(id));

    // Datensicherung
    handle('backup:erstellen', async () => {
        const zeitstempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const result = await dialog.showSaveDialog({
            title: 'Datensicherung speichern',
            defaultPath: `rechnung-adressbuch-backup-${zeitstempel}.sqlite`,
            filters: [{ name: 'SQLite-Datenbank', extensions: ['sqlite'] }]
        });
        if (result.canceled || !result.filePath) return null;

        erstelleBackup(result.filePath);
        shell.showItemInFolder(result.filePath);
        return { pfad: result.filePath };
    });

    // Produktschlüssel/Testzeitraum (siehe Auftrag "Produktschlüssel für
    // Weitergabe")
    handle('lizenz:status', () => lizenz.lizenzstatus());
    handle('lizenz:einloesen', (schluessel) => lizenz.schluesselEinloesen(schluessel));

    // Passwortschutz
    handle('settings:isPasswordSet', () => settings.isPasswordSet());
    handle('settings:setPassword', (passwort) => settings.setPassword(passwort));
    handle('settings:verifyPassword', (passwort) => settings.verifyPassword(passwort));
    handle('settings:removePassword', (aktuellesPasswort) => settings.removePassword(aktuellesPasswort));

    // MwSt-Sätze je Profil
    handle('mwstSaetze:list', (profileId) => mwstSaetze.list(profileId));
    handle('mwstSaetze:create', (profileId, data) => mwstSaetze.create(profileId, data));
    handle('mwstSaetze:remove', (id) => mwstSaetze.remove(id));

    // Textbausteine (frei verwaltbar in den Einstellungen)
    handle('textBausteine:list', () => textBausteine.list());
    handle('textBausteine:create', (data) => textBausteine.create(data));
    handle('textBausteine:update', (schluessel, data) => textBausteine.update(schluessel, data));
    handle('textBausteine:remove', (schluessel) => textBausteine.remove(schluessel));

    // Logo-Upload für Absenderprofile
    handle('profiles:chooseLogo', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Logo auswählen',
            filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg'] }],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) return null;

        const sourcePath = result.filePaths[0];
        const destPath = path.join(getLogosDir(), path.basename(sourcePath));
        fs.copyFileSync(sourcePath, destPath);
        return destPath;
    });
}

module.exports = { registerIpcHandlers };
