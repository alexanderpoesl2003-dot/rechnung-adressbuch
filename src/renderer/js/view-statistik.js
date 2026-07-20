let statistikJahrFilter = '';

async function renderStatistik(container) {
    const daten = await window.api.invoices.statistik({ jahr: statistikJahrFilter || undefined });

    container.innerHTML = '';
    const maxUmsatz = Math.max(1, ...daten.proProfil.map((p) => p.umsatzNetto));

    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Statistik / Auswertung</h1>
                <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#4b5563;">
                    Jahr
                    <select id="statistik-jahr-auswahl">
                        <option value="">Alle Jahre</option>
                        ${daten.jahre.map((j) => `<option value="${j}" ${j === statistikJahrFilter ? 'selected' : ''}>${j}</option>`).join('')}
                    </select>
                </label>
            </div>

            <div class="kachel-reihe">
                <div class="kachel">
                    <div class="kachel-zahl">${formatEur(daten.gesamtNetto)}</div>
                    <div class="kachel-label">Umsatz gesamt (netto)</div>
                </div>
                <div class="kachel">
                    <div class="kachel-zahl">${formatEur(daten.gesamtBrutto)}</div>
                    <div class="kachel-label">Umsatz gesamt (brutto)</div>
                </div>
            </div>

            <h2>Umsatz je Absenderprofil (netto)</h2>
            <div class="balkendiagramm">
                ${daten.proProfil.map((p, index) => `
                    <div class="balken-zeile">
                        <div class="balken-label">${escapeHtml(p.profilName)}</div>
                        <div class="balken-spur">
                            <div class="balken" style="width:${Math.max(2, (p.umsatzNetto / maxUmsatz) * 100)}%; background:${balkenFarbe(index)};"></div>
                        </div>
                        <div class="balken-wert">${formatEur(p.umsatzNetto)}</div>
                    </div>
                `).join('') || '<p>Für diese Auswahl sind noch keine Rechnungen vorhanden.</p>'}
            </div>

            <table class="tabelle" style="margin-top:20px;">
                <thead>
                    <tr><th>Profil</th><th>Anzahl Rechnungen</th><th>Umsatz netto</th><th>Umsatz brutto</th></tr>
                </thead>
                <tbody>
                    ${daten.proProfil.map((p) => `
                        <tr>
                            <td>${escapeHtml(p.profilName)}</td>
                            <td>${p.anzahlRechnungen}</td>
                            <td>${formatEur(p.umsatzNetto)}</td>
                            <td>${formatEur(p.umsatzBrutto)}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="4">Keine Profile angelegt.</td></tr>'}
                </tbody>
            </table>
        </div>
    `));

    container.querySelector('#statistik-jahr-auswahl').addEventListener('change', (event) => {
        statistikJahrFilter = event.target.value;
        renderStatistik(container);
    });
}

// Feste Farbfolge, zyklisch für eine beliebige Anzahl an Profilen - es gibt
// keine feste Zuordnung zu bestimmten Profilnamen.
function balkenFarbe(index) {
    const farben = ['#2f6feb', '#12b76a', '#f79009', '#9e77ed', '#f04438', '#06aed4'];
    return farben[index % farben.length];
}
