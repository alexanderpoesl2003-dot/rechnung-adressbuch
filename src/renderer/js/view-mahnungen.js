async function renderMahnungen(container, params) {
    if (params && params.neu) {
        return renderMahnungFormularSeite(container);
    }

    const mahnungenListe = await window.api.mahnungen.list();

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Mahnungen</h1>
                <button class="btn btn-primary" id="btn-neue-mahnung">+ Neue Mahnung</button>
            </div>
            <table class="tabelle">
                <thead>
                    <tr><th>Mahnungs-Nr.</th><th>Datum</th><th>Rechnung</th><th>Kunde</th><th></th></tr>
                </thead>
                <tbody id="mahnungen-tabelle-body"></tbody>
            </table>
        </div>
    `));

    const tbody = container.querySelector('#mahnungen-tabelle-body');
    for (const m of mahnungenListe) {
        tbody.appendChild(el(`
            <tr>
                <td>${escapeHtml(m.belegnummer)}</td>
                <td>${formatDatum(m.belegdatum)}</td>
                <td>${escapeHtml(m.bezug_rechnungsnummer || '-')}</td>
                <td>${escapeHtml(m.kunde_name)}</td>
                <td>
                    <button class="btn btn-klein" data-vorschau="${m.id}">Vorschau</button>
                    <button class="btn btn-klein" data-drucken="${m.id}">Drucken</button>
                    <button class="btn btn-klein" data-pdf="${m.id}">PDF exportieren</button>
                    <button class="btn btn-klein" data-email="${m.id}">Per E-Mail senden</button>
                </td>
            </tr>
        `));
    }

    tbody.querySelectorAll('[data-vorschau]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.mahnungen.previewPdf(Number(btn.dataset.vorschau));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-drucken]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.mahnungen.print(Number(btn.dataset.drucken));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-pdf]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.mahnungen.exportPdf(Number(btn.dataset.pdf));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-email]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                const result = await window.api.mahnungen.sendEmail(Number(btn.dataset.email));
                if (!result.empfaenger) {
                    alert('Für diesen Kunden ist keine E-Mail-Adresse hinterlegt. Bitte im Mailprogramm manuell eintragen. Die PDF-Datei wurde im Explorer geöffnet - zum Anhängen per Drag & Drop.');
                }
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    container.querySelector('#btn-neue-mahnung').addEventListener('click', () => { window.location.hash = '#/mahnungen?neu=1'; });
}

async function renderMahnungFormularSeite(container) {
    const [offenePosten, textBausteine] = await Promise.all([
        window.api.invoices.offenePosten(),
        window.api.invoices.listTextBausteine()
    ]);

    container.innerHTML = '';

    if (offenePosten.length === 0) {
        container.appendChild(el(`
            <div>
                <div class="view-kopf">
                    <h1>Neue Mahnung</h1>
                    <a href="#/mahnungen" class="btn btn-klein">← Zurück zu den Mahnungen</a>
                </div>
                <p>Es gibt aktuell keine offenen (unbezahlten) Rechnungen, zu denen eine Mahnung erstellt werden könnte.</p>
            </div>
        `));
        return;
    }

    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Neue Mahnung</h1>
                <a href="#/mahnungen" class="btn btn-klein">← Zurück zu den Mahnungen</a>
            </div>
            <form class="formular" id="mahnung-formular">
                <div class="formular-raster">
                    <label>Offene Rechnung
                        <select name="rechnung_id" required>
                            ${offenePosten.map((r) => `<option value="${r.id}">${escapeHtml(r.rechnungsnummer)} – ${escapeHtml(r.kunde_name)} – offen: ${formatEur(r.offener_betrag)}</option>`).join('')}
                        </select>
                    </label>
                    <label>Mahnungsdatum <input type="date" name="belegdatum" value="${heute()}" required /></label>
                    <label>Textbaustein
                        <select name="text_baustein_schluessel">
                            <option value="">– keiner –</option>
                            ${textBausteine.map((t) => `<option value="${escapeHtml(t.schluessel)}">${escapeHtml(t.titel)}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <label>Mahntext <textarea name="mahntext" rows="6">Trotz Erinnerung liegt uns für die oben genannte Rechnung noch kein Zahlungseingang vor. Wir bitten um Ausgleich des offenen Betrags innerhalb von 7 Tagen.</textarea></label>
                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">Mahnung erstellen</button>
                    <a href="#/mahnungen" class="btn">Abbrechen</a>
                </div>
            </form>
        </div>
    `));

    container.querySelector('#mahnung-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const rechnung = offenePosten.find((r) => r.id === Number(form.rechnung_id.value));

        const data = {
            sender_profile_id: rechnung.sender_profile_id,
            customer_id: rechnung.customer_id,
            belegdatum: form.belegdatum.value,
            bezug_invoice_id: rechnung.id,
            mahntext: form.mahntext.value,
            text_baustein_schluessel: form.text_baustein_schluessel.value || null
        };

        try {
            await window.api.mahnungen.create(data);
            window.location.hash = '#/mahnungen';
        } catch (err) {
            showFehler(err.message);
        }
    });
}
