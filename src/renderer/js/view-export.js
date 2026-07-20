async function renderExport(container) {
    const profiles = await window.api.profiles.list();

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <h1>Steuerberater-Export</h1>
            <p style="color:#667085;font-size:13px;max-width:560px;">
                Exportiert alle Rechnungen eines frei wählbaren Zeitraums als CSV-Datei
                (Rechnungsnr., Datum, Netto, MwSt, Brutto, Status). Optional auf ein
                Absenderprofil eingeschränkt.
            </p>
            <form class="formular" id="export-formular" style="max-width:560px;">
                <div class="formular-raster">
                    <label>Absenderprofil
                        <select name="profileId">
                            <option value="">Alle Profile</option>
                            ${profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                        </select>
                    </label>
                    <div></div>
                    <label>Von <input type="date" name="von" required /></label>
                    <label>Bis <input type="date" name="bis" required /></label>
                </div>
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-klein" data-zeitraum="jahr">Dieses Jahr</button>
                    <button type="button" class="btn btn-klein" data-zeitraum="letztesJahr">Letztes Jahr</button>
                    <button type="button" class="btn btn-klein" data-zeitraum="quartal">Dieses Quartal</button>
                </div>
                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">Als CSV exportieren</button>
                </div>
            </form>
            <p id="export-ergebnis" style="margin-top:14px;font-size:13px;color:#667085;"></p>
        </div>
    `));

    const form = container.querySelector('#export-formular');
    const zeitraumVorbelegung = berechneZeitraum('jahr');
    form.von.value = zeitraumVorbelegung.von;
    form.bis.value = zeitraumVorbelegung.bis;

    form.querySelectorAll('[data-zeitraum]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const { von, bis } = berechneZeitraum(btn.dataset.zeitraum);
            form.von.value = von;
            form.bis.value = bis;
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ergebnisFeld = container.querySelector('#export-ergebnis');
        try {
            const result = await window.api.invoices.exportSteuerberaterCsv({
                von: form.von.value,
                bis: form.bis.value,
                profileId: form.profileId.value || null
            });
            ergebnisFeld.textContent = result
                ? `${result.anzahl} Rechnung(en) exportiert nach: ${result.pfad}`
                : 'Export abgebrochen.';
        } catch (err) {
            showFehler(err.message);
        }
    });
}

// Liefert Start-/Enddatum (ISO) für die Schnellauswahl-Buttons.
function berechneZeitraum(typ) {
    const heuteDatum = new Date();
    const jahr = heuteDatum.getFullYear();

    if (typ === 'jahr') return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
    if (typ === 'letztesJahr') return { von: `${jahr - 1}-01-01`, bis: `${jahr - 1}-12-31` };

    if (typ === 'quartal') {
        const quartal = Math.floor(heuteDatum.getMonth() / 3);
        const startMonat = quartal * 3;
        const von = new Date(jahr, startMonat, 1);
        const bis = new Date(jahr, startMonat + 3, 0);
        return { von: von.toISOString().slice(0, 10), bis: bis.toISOString().slice(0, 10) };
    }

    return { von: heute(), bis: heute() };
}
