async function renderSuche(container, params) {
    const suchbegriff = (params && params.q) || '';

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <h1>Suche</h1>
            <form id="suche-formular" style="margin-bottom:20px;display:flex;gap:8px;max-width:420px;">
                <input type="search" name="q" value="${escapeHtml(suchbegriff)}" placeholder="Kunde, Rechnungsnr., Notiz…"
                    style="flex:1;padding:8px 10px;border:1px solid #d0d5dd;border-radius:5px;font-size:13px;" />
                <button type="submit" class="btn btn-primary">Suchen</button>
            </form>
            <div id="suche-ergebnisse"></div>
        </div>
    `));

    container.querySelector('#suche-formular').addEventListener('submit', (event) => {
        event.preventDefault();
        const begriff = event.target.q.value.trim();
        window.location.hash = `#/suche?q=${encodeURIComponent(begriff)}`;
    });

    const ergebnisBereich = container.querySelector('#suche-ergebnisse');
    if (!suchbegriff.trim()) {
        ergebnisBereich.appendChild(el('<p>Bitte einen Suchbegriff eingeben.</p>'));
        return;
    }

    const treffer = await window.api.search.global(suchbegriff);
    const anzahlGesamt = treffer.customers.length + treffer.invoices.length + treffer.notizen.length;

    ergebnisBereich.appendChild(el(`
        <div>
            <p>${anzahlGesamt} Treffer für "${escapeHtml(suchbegriff)}"</p>

            <h2>Kunden (${treffer.customers.length})</h2>
            <table class="tabelle">
                <thead><tr><th>Kd.-Nr.</th><th>Name/Firma</th><th>Ort</th><th></th></tr></thead>
                <tbody>
                    ${treffer.customers.map((k) => `
                        <tr>
                            <td>${escapeHtml(k.kundennummer)}</td>
                            <td>${escapeHtml(k.nachname_firma)}</td>
                            <td>${escapeHtml(k.ort || '')}</td>
                            <td><a href="#/customers?id=${k.id}">Details</a></td>
                        </tr>
                    `).join('') || '<tr><td colspan="4">Keine Treffer.</td></tr>'}
                </tbody>
            </table>

            <h2>Rechnungen (${treffer.invoices.length})</h2>
            <table class="tabelle">
                <thead><tr><th>Rechnungsnr.</th><th>Datum</th><th>Profil</th><th>Kunde</th><th></th></tr></thead>
                <tbody>
                    ${treffer.invoices.map((r) => `
                        <tr>
                            <td>${escapeHtml(r.rechnungsnummer)}</td>
                            <td>${formatDatum(r.rechnungsdatum)}</td>
                            <td>${escapeHtml(r.profil_name)}</td>
                            <td>${escapeHtml(r.kunde_name)}</td>
                            <td><a href="#/customers?id=${r.customer_id}">Kunde ansehen</a></td>
                        </tr>
                    `).join('') || '<tr><td colspan="5">Keine Treffer.</td></tr>'}
                </tbody>
            </table>

            <h2>Notizen (${treffer.notizen.length})</h2>
            <table class="tabelle">
                <thead><tr><th>Text</th><th>Kunde</th><th></th></tr></thead>
                <tbody>
                    ${treffer.notizen.map((n) => `
                        <tr>
                            <td>${escapeHtml(n.text)}</td>
                            <td>${escapeHtml(n.kunde_name || '')}</td>
                            <td><a href="#/notizen">Zu den Notizen</a></td>
                        </tr>
                    `).join('') || '<tr><td colspan="3">Keine Treffer.</td></tr>'}
                </tbody>
            </table>
        </div>
    `));
}
