async function renderCustomers(container, params) {
    if (params && params.id) {
        return renderKundenDetail(container, Number(params.id));
    }

    const customers = await window.api.customers.list();

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Adressbuch</h1>
                <div>
                    <button class="btn" id="btn-csv-import">CSV importieren…</button>
                    <button class="btn btn-primary" id="btn-neuer-kunde">+ Neuer Kunde</button>
                </div>
            </div>
            <table class="tabelle">
                <thead>
                    <tr>
                        <th>Kd.-Nr.</th><th>Name/Firma</th><th>Ansprechpartner</th>
                        <th>Adresse</th><th>Kontakt</th><th></th>
                    </tr>
                </thead>
                <tbody id="kunden-tabelle-body"></tbody>
            </table>
            <div id="kunden-formular-bereich"></div>
        </div>
    `));

    const tbody = container.querySelector('#kunden-tabelle-body');
    for (const k of customers) {
        tbody.appendChild(el(`
            <tr>
                <td><a href="#/customers?id=${k.id}">${escapeHtml(k.kundennummer)}</a></td>
                <td><a href="#/customers?id=${k.id}">${escapeHtml(k.nachname_firma)}</a></td>
                <td>${escapeHtml(k.vorname_ansprechpartner || '')}</td>
                <td>${escapeHtml(k.strasse || '')} ${escapeHtml(k.plz || '')} ${escapeHtml(k.ort || '')}</td>
                <td>${escapeHtml(k.kontakt || '')}</td>
                <td>
                    <button class="btn btn-klein" data-details="${k.id}">Details</button>
                    <button class="btn btn-klein" data-edit="${k.id}">Bearbeiten</button>
                    <button class="btn btn-klein btn-gefahr" data-delete="${k.id}">Löschen</button>
                </td>
            </tr>
        `));
    }

    tbody.querySelectorAll('[data-details]').forEach((btn) => {
        btn.addEventListener('click', () => { window.location.hash = `#/customers?id=${btn.dataset.details}`; });
    });
    tbody.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => zeigeKundenFormular(container, customers.find((k) => k.id === Number(btn.dataset.edit))));
    });
    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Diesen Kunden wirklich löschen?')) return;
            try {
                await window.api.customers.remove(Number(btn.dataset.delete));
                renderCustomers(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    container.querySelector('#btn-neuer-kunde').addEventListener('click', () => zeigeKundenFormular(container, null));
    container.querySelector('#btn-csv-import').addEventListener('click', async () => {
        try {
            const result = await window.api.customers.importCsv();
            if (!result) return;
            let meldung = `${result.importiert} Kunden importiert, ${result.uebersprungen} übersprungen.`;
            if (result.fehler.length > 0) meldung += ` ${result.fehler.length} Fehler.`;
            alert(meldung);
            renderCustomers(container);
        } catch (err) {
            showFehler(err.message);
        }
    });
}

// Kundendetailansicht: zeigt Stammdaten sowie alle bisherigen Rechnungen
// dieses Kunden auf einen Blick (inkl. Umsatzsumme).
async function renderKundenDetail(container, customerId) {
    const kunde = await window.api.customers.get(customerId);

    if (!kunde) {
        container.innerHTML = '';
        container.appendChild(el('<div><p>Kunde nicht gefunden.</p><a href="#/customers">← Zurück zum Adressbuch</a></div>'));
        return;
    }

    const rechnungen = await window.api.invoices.listByCustomer(customerId);
    const umsatzGesamt = rechnungen.reduce((sum, r) => sum + r.summen.brutto, 0);

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>${escapeHtml(kunde.nachname_firma)}</h1>
                <a href="#/customers" class="btn btn-klein">← Zurück zum Adressbuch</a>
            </div>

            <div class="karte" style="width:auto;max-width:420px;margin-bottom:24px;">
                <div class="karte-zeile">Kundennummer: ${escapeHtml(kunde.kundennummer)}</div>
                ${kunde.vorname_ansprechpartner ? `<div class="karte-zeile">${escapeHtml(kunde.vorname_ansprechpartner)}</div>` : ''}
                <div class="karte-zeile">${escapeHtml(kunde.strasse || '')} ${escapeHtml(kunde.plz || '')} ${escapeHtml(kunde.ort || '')}</div>
                ${kunde.kontakt ? `<div class="karte-zeile">${escapeHtml(kunde.kontakt)}</div>` : ''}
                <div class="karte-aktionen"><button class="btn btn-klein" id="btn-kunde-bearbeiten">Bearbeiten</button></div>
            </div>

            <div class="kachel-reihe">
                <div class="kachel">
                    <div class="kachel-zahl">${rechnungen.length}</div>
                    <div class="kachel-label">Rechnungen</div>
                </div>
                <div class="kachel">
                    <div class="kachel-zahl">${formatEur(umsatzGesamt)}</div>
                    <div class="kachel-label">Umsatz gesamt (brutto)</div>
                </div>
            </div>

            <h2>Alle Rechnungen dieses Kunden</h2>
            <table class="tabelle">
                <thead>
                    <tr><th>Rechnungsnr.</th><th>Datum</th><th>Profil</th><th>Status</th><th>Bezahlt</th><th>Brutto</th></tr>
                </thead>
                <tbody>
                    ${rechnungen.map((r) => `
                        <tr>
                            <td>${escapeHtml(r.rechnungsnummer)}</td>
                            <td>${formatDatum(r.rechnungsdatum)}</td>
                            <td>${escapeHtml(r.profil_name)}</td>
                            <td><span class="status status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
                            <td>${r.bezahlt ? 'bezahlt' : 'offen'}</td>
                            <td>${formatEur(r.summen.brutto)}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="6">Noch keine Rechnungen für diesen Kunden.</td></tr>'}
                </tbody>
            </table>
            <div id="kunden-formular-bereich"></div>
        </div>
    `));

    container.querySelector('#btn-kunde-bearbeiten').addEventListener('click', () => zeigeKundenFormular(container, kunde));
}

function zeigeKundenFormular(container, kunde) {
    const bereich = container.querySelector('#kunden-formular-bereich');
    const k = kunde || {
        kundennummer: '', anrede: '', nachname_firma: '', vorname_ansprechpartner: '',
        strasse: '', plz: '', ort: '', kontakt: '', notiz: ''
    };

    bereich.innerHTML = '';
    bereich.appendChild(el(`
        <form class="formular" id="kunden-formular">
            <h2>${kunde ? 'Kunde bearbeiten' : 'Neuer Kunde'}</h2>
            <div class="formular-raster">
                <label>Kundennummer <input name="kundennummer" placeholder="wird automatisch vergeben" value="${escapeHtml(k.kundennummer)}" /></label>
                <label>Anrede <input name="anrede" value="${escapeHtml(k.anrede)}" /></label>
                <label>Name/Firma <input name="nachname_firma" value="${escapeHtml(k.nachname_firma)}" required /></label>
                <label>Ansprechpartner <input name="vorname_ansprechpartner" value="${escapeHtml(k.vorname_ansprechpartner)}" /></label>
                <label>Straße <input name="strasse" value="${escapeHtml(k.strasse)}" /></label>
                <label>PLZ <input name="plz" value="${escapeHtml(k.plz)}" /></label>
                <label>Ort <input name="ort" value="${escapeHtml(k.ort)}" /></label>
                <label>Telefon/E-Mail/Sonstiges <input name="kontakt" value="${escapeHtml(k.kontakt)}" /></label>
            </div>
            <label>Notiz <textarea name="notiz">${escapeHtml(k.notiz || '')}</textarea></label>
            <div class="formular-aktionen">
                <button type="submit" class="btn btn-primary">Speichern</button>
                <button type="button" class="btn" id="btn-abbrechen">Abbrechen</button>
            </div>
        </form>
    `));

    bereich.querySelector('#btn-abbrechen').addEventListener('click', () => { bereich.innerHTML = ''; });

    const plzFeld = bereich.querySelector('[name="plz"]');
    const ortFeld = bereich.querySelector('[name="ort"]');
    plzFeld.addEventListener('blur', async () => {
        if (!plzFeld.value.trim() || ortFeld.value.trim()) return;
        try {
            const ort = await window.api.customers.lookupOrtByPlz(plzFeld.value.trim());
            if (ort) ortFeld.value = ort;
        } catch (err) {
            // Automatik ist optional - Fehler hier ignorieren
        }
    });

    bereich.querySelector('#kunden-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        try {
            if (kunde) {
                await window.api.customers.update(kunde.id, data);
            } else {
                await window.api.customers.create(data);
            }
            renderCustomers(container);
        } catch (err) {
            showFehler(err.message);
        }
    });
}
