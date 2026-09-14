async function renderNotizen(container, params) {
    if (params && params.neu) {
        const customers = await window.api.customers.list();
        return renderNotizFormularSeite(container, customers);
    }

    const [notizenListe, customers] = await Promise.all([
        window.api.notizen.list(),
        window.api.customers.list()
    ]);

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Notizen</h1>
                <button class="btn btn-primary" id="btn-neue-notiz">+ Neue Notiz</button>
            </div>
            <table class="tabelle">
                <thead>
                    <tr><th>Prio</th><th>Text</th><th>Kunde</th><th>Fällig bis</th><th>Erledigt</th><th></th></tr>
                </thead>
                <tbody id="notizen-tabelle-body"></tbody>
            </table>
        </div>
    `));

    const tbody = container.querySelector('#notizen-tabelle-body');
    for (const n of notizenListe) {
        tbody.appendChild(el(`
            <tr style="${n.erledigt ? 'opacity:0.5;' : ''}">
                <td>${n.prioritaet}</td>
                <td>${escapeHtml(n.text)}</td>
                <td>${escapeHtml(n.kunde_name || '')}</td>
                <td>${n.faellig_am ? formatDatum(n.faellig_am) : '-'}</td>
                <td><input type="checkbox" data-erledigt="${n.id}" ${n.erledigt ? 'checked' : ''} /></td>
                <td><button class="btn btn-klein btn-gefahr" data-delete="${n.id}">Löschen</button></td>
            </tr>
        `));
    }

    tbody.querySelectorAll('[data-erledigt]').forEach((checkbox) => {
        checkbox.addEventListener('change', async () => {
            try {
                await window.api.notizen.setErledigt(Number(checkbox.dataset.erledigt), checkbox.checked);
                renderNotizen(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Notiz wirklich löschen?')) return;
            try {
                await window.api.notizen.remove(Number(btn.dataset.delete));
                renderNotizen(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    container.querySelector('#btn-neue-notiz').addEventListener('click', () => { window.location.hash = '#/notizen?neu=1'; });
}

function renderNotizFormularSeite(container, customers) {
    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Neue Notiz</h1>
                <a href="#/notizen" class="btn btn-klein">← Zurück zu den Notizen</a>
            </div>
            <form class="formular" id="notiz-formular">
                <div class="formular-raster">
                    <label>Priorität (1 = höchste)
                        <select name="prioritaet">
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3" selected>3</option>
                            <option value="4">4</option>
                            <option value="5">5</option>
                        </select>
                    </label>
                    <label>Kunde (optional)
                        <select name="customer_id">
                            <option value="">– keiner –</option>
                            ${customers.map((k) => `<option value="${k.id}">${escapeHtml(k.kundennummer)} – ${escapeHtml(k.nachname_firma)}</option>`).join('')}
                        </select>
                    </label>
                    <label>Fällig bis (optional) <input type="date" name="faellig_am" /></label>
                </div>
                <label>Text <textarea name="text" rows="3" required></textarea></label>
                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">Speichern</button>
                    <a href="#/notizen" class="btn">Abbrechen</a>
                </div>
            </form>
        </div>
    `));

    container.querySelector('#notiz-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        try {
            await window.api.notizen.create(data);
            window.location.hash = '#/notizen';
        } catch (err) {
            showFehler(err.message);
        }
    });
}
