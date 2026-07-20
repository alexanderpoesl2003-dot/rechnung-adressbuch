async function renderDashboard(container) {
    const [profiles, customers, invoices, statistik] = await Promise.all([
        window.api.profiles.list(),
        window.api.customers.list(),
        window.api.invoices.list(),
        window.api.invoices.statistik({})
    ]);

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <h1>Übersicht</h1>
            <div class="kachel-reihe">
                <a class="kachel kachel-link" href="#/profiles">
                    <div class="kachel-zahl">${profiles.length}</div>
                    <div class="kachel-label">Absenderprofile</div>
                </a>
                <a class="kachel kachel-link" href="#/customers">
                    <div class="kachel-zahl">${customers.length}</div>
                    <div class="kachel-label">Kunden im Adressbuch</div>
                </a>
                <a class="kachel kachel-link" href="#/invoices">
                    <div class="kachel-zahl">${invoices.length}</div>
                    <div class="kachel-label">Rechnungen gesamt</div>
                </a>
                <a class="kachel kachel-link" href="#/statistik">
                    <div class="kachel-zahl">${formatEur(statistik.gesamtBrutto)}</div>
                    <div class="kachel-label">Umsatz gesamt (brutto)</div>
                </a>
            </div>
            <h2>Letzte Rechnungen</h2>
            <table class="tabelle">
                <thead>
                    <tr><th>Rechnungsnr.</th><th>Datum</th><th>Profil</th><th>Kunde</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${invoices.slice(0, 8).map((r) => `
                        <tr>
                            <td>${escapeHtml(r.rechnungsnummer)}</td>
                            <td>${formatDatum(r.rechnungsdatum)}</td>
                            <td>${escapeHtml(r.profil_name)}</td>
                            <td>${escapeHtml(r.kunde_name)}</td>
                            <td><span class="status status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
                        </tr>
                    `).join('') || '<tr><td colspan="5">Noch keine Rechnungen vorhanden.</td></tr>'}
                </tbody>
            </table>
        </div>
    `));
}
