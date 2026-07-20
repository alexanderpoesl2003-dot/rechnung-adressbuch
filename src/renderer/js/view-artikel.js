async function renderArtikel(container) {
    const artikelListe = await window.api.artikel.list();

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Artikel-Stammdaten</h1>
                <button class="btn btn-primary" id="btn-neuer-artikel">+ Neuer Artikel</button>
            </div>
            <table class="tabelle">
                <thead>
                    <tr>
                        <th>Artikel-Nr.</th><th>Bezeichnung</th><th>VK netto</th>
                        <th>MwSt</th><th>Bestand</th><th>Mindestmenge</th><th></th>
                    </tr>
                </thead>
                <tbody id="artikel-tabelle-body"></tbody>
            </table>
            <div id="artikel-formular-bereich"></div>
        </div>
    `));

    const tbody = container.querySelector('#artikel-tabelle-body');
    for (const a of artikelListe) {
        const unterBestand = a.warenbestand != null && a.mindestmenge != null && a.warenbestand <= a.mindestmenge;
        tbody.appendChild(el(`
            <tr>
                <td>${escapeHtml(a.artikel_nr)}</td>
                <td>${escapeHtml(a.bezeichnung)}</td>
                <td>${formatEur(a.verkaufspreis_netto)}</td>
                <td>${a.mwst_satz}%</td>
                <td>${a.warenbestand != null ? a.warenbestand : '-'} ${unterBestand ? '<span class="status status-entwurf">niedrig</span>' : ''}</td>
                <td>${a.mindestmenge != null ? a.mindestmenge : '-'}</td>
                <td>
                    <button class="btn btn-klein" data-edit="${a.id}">Bearbeiten</button>
                    <button class="btn btn-klein btn-gefahr" data-delete="${a.id}">Löschen</button>
                </td>
            </tr>
        `));
    }

    tbody.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => zeigeArtikelFormular(container, artikelListe.find((a) => a.id === Number(btn.dataset.edit))));
    });
    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Diesen Artikel wirklich löschen?')) return;
            try {
                await window.api.artikel.remove(Number(btn.dataset.delete));
                renderArtikel(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    container.querySelector('#btn-neuer-artikel').addEventListener('click', () => zeigeArtikelFormular(container, null));
}

function zeigeArtikelFormular(container, artikel) {
    const bereich = container.querySelector('#artikel-formular-bereich');
    const a = artikel || {
        artikel_nr: '', bezeichnung: '', verkaufspreis_netto: 0, einkaufspreis_netto: '',
        mwst_satz: 19, warenbestand: '', mindestmenge: ''
    };

    bereich.innerHTML = '';
    bereich.appendChild(el(`
        <form class="formular" id="artikel-formular">
            <h2>${artikel ? 'Artikel bearbeiten' : 'Neuer Artikel'}</h2>
            <div class="formular-raster">
                <label>Artikel-Nr. <input name="artikel_nr" value="${escapeHtml(a.artikel_nr)}" required /></label>
                <label>Bezeichnung <input name="bezeichnung" value="${escapeHtml(a.bezeichnung)}" required /></label>
                <label>Verkaufspreis netto <input name="verkaufspreis_netto" type="number" step="0.01" value="${a.verkaufspreis_netto}" required /></label>
                <label>Einkaufspreis netto <input name="einkaufspreis_netto" type="number" step="0.01" value="${a.einkaufspreis_netto ?? ''}" /></label>
                <label>MwSt-Satz
                    <select name="mwst_satz">
                        <option value="19" ${Number(a.mwst_satz) === 19 ? 'selected' : ''}>19%</option>
                        <option value="7" ${Number(a.mwst_satz) === 7 ? 'selected' : ''}>7%</option>
                    </select>
                </label>
                <label>Warenbestand <input name="warenbestand" type="number" step="1" value="${a.warenbestand ?? ''}" /></label>
                <label>Mindestmenge <input name="mindestmenge" type="number" step="1" value="${a.mindestmenge ?? ''}" /></label>
            </div>
            <div class="formular-aktionen">
                <button type="submit" class="btn btn-primary">Speichern</button>
                <button type="button" class="btn" id="btn-abbrechen">Abbrechen</button>
            </div>
        </form>
    `));

    bereich.querySelector('#btn-abbrechen').addEventListener('click', () => { bereich.innerHTML = ''; });

    bereich.querySelector('#artikel-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        try {
            if (artikel) {
                await window.api.artikel.update(artikel.id, data);
            } else {
                await window.api.artikel.create(data);
            }
            renderArtikel(container);
        } catch (err) {
            showFehler(err.message);
        }
    });
}
