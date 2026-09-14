async function renderProfiles(container, params) {
    if (params && params.neu) {
        return renderProfilFormularSeite(container, null);
    }
    if (params && params.bearbeiten) {
        const profil = await window.api.profiles.get(Number(params.bearbeiten));
        return renderProfilFormularSeite(container, profil);
    }

    const profiles = await window.api.profiles.list();

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Absenderprofile</h1>
                <button class="btn btn-primary" id="btn-neues-profil">+ Neues Profil</button>
            </div>
            <div class="karten-liste" id="profil-karten"></div>
        </div>
    `));

    const karten = container.querySelector('#profil-karten');
    for (const p of profiles) {
        karten.appendChild(el(`
            <div class="karte">
                <h3>${escapeHtml(p.name)}</h3>
                <div class="karte-zeile">Nächste Rechnungsnr.: ${escapeHtml(p.rechnungsnummer_prefix)}${String(new Date().getFullYear() % 100).padStart(2, '0')}-${String(p.naechste_laufnummer).padStart(4, '0')}</div>
                <div class="karte-zeile">${escapeHtml(p.strasse || '')} ${escapeHtml(p.plz || '')} ${escapeHtml(p.ort || '')}</div>
                <div class="karte-zeile">IBAN: ${escapeHtml(p.iban || '-')}</div>
                <div class="karte-aktionen">
                    <button class="btn btn-klein" data-edit="${p.id}">Bearbeiten</button>
                    <button class="btn btn-klein btn-gefahr" data-delete="${p.id}">Löschen</button>
                </div>
            </div>
        `));
    }

    karten.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => { window.location.hash = `#/profiles?bearbeiten=${btn.dataset.edit}`; });
    });
    karten.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Dieses Absenderprofil wirklich löschen?')) return;
            try {
                await window.api.profiles.remove(Number(btn.dataset.delete));
                renderProfiles(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    container.querySelector('#btn-neues-profil').addEventListener('click', () => { window.location.hash = '#/profiles?neu=1'; });
}

function renderProfilFormularSeite(container, profil) {
    const p = profil || {
        name: '', briefkopf_name: '', logo_pfad: '', strasse: '', plz: '', ort: '',
        telefon: '', email: '', iban: '', bic: '', bank_name: '', steuernummer: '', ust_id: '',
        rechnungsnummer_prefix: 'R', naechste_laufnummer: 1
    };

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>${profil ? 'Profil bearbeiten' : 'Neues Profil'}</h1>
                <a href="#/profiles" class="btn btn-klein">← Zurück zu den Profilen</a>
            </div>
            <form class="formular" id="profil-formular">
                <div class="formular-raster">
                    <label>Profilname <input name="name" value="${escapeHtml(p.name)}" required /></label>
                    <label>Name im Briefkopf <input name="briefkopf_name" value="${escapeHtml(p.briefkopf_name)}" /></label>
                    <label>Straße <input name="strasse" value="${escapeHtml(p.strasse)}" /></label>
                    <label>PLZ <input name="plz" value="${escapeHtml(p.plz)}" /></label>
                    <label>Ort <input name="ort" value="${escapeHtml(p.ort)}" /></label>
                    <label>Telefon <input name="telefon" value="${escapeHtml(p.telefon)}" /></label>
                    <label>E-Mail <input name="email" value="${escapeHtml(p.email)}" /></label>
                    <label>IBAN <input name="iban" value="${escapeHtml(p.iban)}" /></label>
                    <label>BIC <input name="bic" value="${escapeHtml(p.bic)}" /></label>
                    <label>Bank <input name="bank_name" value="${escapeHtml(p.bank_name)}" /></label>
                    <label>Steuernummer <input name="steuernummer" value="${escapeHtml(p.steuernummer)}" /></label>
                    <label>USt-IdNr. <input name="ust_id" value="${escapeHtml(p.ust_id)}" /></label>
                    <label>Rechnungsnr.-Präfix <input name="rechnungsnummer_prefix" value="${escapeHtml(p.rechnungsnummer_prefix)}" /></label>
                    <label>Nächste laufende Nummer <input name="naechste_laufnummer" type="number" min="1" value="${p.naechste_laufnummer}" /></label>
                </div>
                <label>Logo
                    <div class="logo-zeile">
                        <span id="logo-pfad-anzeige">${escapeHtml(p.logo_pfad || 'kein Logo ausgewählt')}</span>
                        <button type="button" class="btn btn-klein" id="btn-logo-waehlen">Logo wählen…</button>
                    </div>
                </label>
                <input type="hidden" name="logo_pfad" value="${escapeHtml(p.logo_pfad || '')}" />
                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">Speichern</button>
                    <a href="#/profiles" class="btn">Abbrechen</a>
                </div>
            </form>
            ${profil ? '<div id="mwst-verwaltung"></div>' : ''}
        </div>
    `));

    if (profil) zeigeMwstVerwaltung(container.querySelector('#mwst-verwaltung'), profil.id);

    const form = container.querySelector('#profil-formular');
    form.querySelector('#btn-logo-waehlen').addEventListener('click', async () => {
        const pfad = await window.api.profiles.chooseLogo();
        if (pfad) {
            form.querySelector('[name="logo_pfad"]').value = pfad;
            form.querySelector('#logo-pfad-anzeige').textContent = pfad;
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        try {
            if (profil) {
                await window.api.profiles.update(profil.id, data);
            } else {
                await window.api.profiles.create(data);
            }
            window.location.hash = '#/profiles';
        } catch (err) {
            showFehler(err.message);
        }
    });
}

async function zeigeMwstVerwaltung(bereich, profileId) {
    const saetze = await window.api.mwstSaetze.list(profileId);

    bereich.innerHTML = '';
    bereich.appendChild(el(`
        <div class="formular" style="margin-top:18px;">
            <h2>MwSt-Sätze dieses Profils</h2>
            <table class="tabelle">
                <thead><tr><th>Satz</th><th>Bezeichnung</th><th></th></tr></thead>
                <tbody id="mwst-tabelle-body"></tbody>
            </table>
            <form id="mwst-neu-formular" class="formular-raster" style="margin-top:12px;">
                <label>Satz in % <input name="satz" type="number" step="0.1" min="0" max="100" required /></label>
                <label>Bezeichnung (optional) <input name="bezeichnung" /></label>
                <div class="formular-aktionen" style="align-items:flex-end;">
                    <button type="submit" class="btn btn-klein btn-primary">Satz hinzufügen</button>
                </div>
            </form>
        </div>
    `));

    const tbody = bereich.querySelector('#mwst-tabelle-body');
    for (const s of saetze) {
        tbody.appendChild(el(`
            <tr>
                <td>${formatSatzDe(s.satz)}%</td>
                <td>${escapeHtml(s.bezeichnung || '')}</td>
                <td><button type="button" class="btn btn-klein btn-gefahr" data-delete-satz="${s.id}">Löschen</button></td>
            </tr>
        `));
    }

    tbody.querySelectorAll('[data-delete-satz]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Diesen MwSt-Satz wirklich löschen? Bereits erstellte Rechnungen/Belege sind davon nicht betroffen.')) return;
            try {
                await window.api.mwstSaetze.remove(Number(btn.dataset.deleteSatz));
                zeigeMwstVerwaltung(bereich, profileId);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    bereich.querySelector('#mwst-neu-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        try {
            await window.api.mwstSaetze.create(profileId, data);
            zeigeMwstVerwaltung(bereich, profileId);
        } catch (err) {
            showFehler(err.message);
        }
    });
}
