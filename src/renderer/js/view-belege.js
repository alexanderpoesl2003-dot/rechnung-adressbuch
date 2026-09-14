let belegAktuellerTyp = 'angebot';

// params.korrekturVon (invoice-id) kommt von der Aktion "Korrekturrechnung
// erstellen" bei einer finalisierten Rechnung (siehe view-invoices.js) -
// öffnet direkt eine vorbelegte Korrektur-Formularseite statt der Liste.
async function renderBelege(container, params = {}) {
    const korrekturVonId = params.korrekturVon ? Number(params.korrekturVon) : null;
    if (korrekturVonId) belegAktuellerTyp = 'korrektur';

    const typen = await window.api.belege.typen();
    const typEintraege = Object.entries(typen).filter(([typ]) => typ !== 'mahnung');
    if (!typen[belegAktuellerTyp] || belegAktuellerTyp === 'mahnung') belegAktuellerTyp = typEintraege[0][0];
    const typDef = typen[belegAktuellerTyp];

    if (korrekturVonId) {
        // URL wieder bereinigen, ohne die Ansicht erneut zu rendern (history
        // API statt location.hash, damit kein zweiter hashchange ausgelöst
        // wird) - ein Neuladen der Seite soll das Formular nicht erneut öffnen.
        history.replaceState(null, '', '#/belege');
        return renderBelegFormularSeite(container, 'korrektur', typDef, korrekturVonId);
    }
    if (params.neu) {
        return renderBelegFormularSeite(container, belegAktuellerTyp, typDef);
    }

    const belegeListe = await window.api.belege.list(belegAktuellerTyp);

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>${escapeHtml(typDef.bezeichnung)}e</h1>
                <button class="btn btn-primary" id="btn-neuer-beleg">+ Neu: ${escapeHtml(typDef.bezeichnung)}</button>
            </div>
            <div class="karten-liste" id="beleg-tabs" style="margin-bottom:18px;"></div>
            <table class="tabelle">
                <thead>
                    <tr><th>Nummer</th><th>Datum</th><th>Profil</th><th>Kunde</th>${belegAktuellerTyp === 'korrektur' ? '<th>Bezug</th>' : ''}<th></th></tr>
                </thead>
                <tbody id="belege-tabelle-body"></tbody>
            </table>
        </div>
    `));

    const tabs = container.querySelector('#beleg-tabs');
    for (const [typ, def] of typEintraege) {
        const btn = el(`<button class="btn ${typ === belegAktuellerTyp ? 'btn-primary' : ''} btn-klein">${escapeHtml(def.bezeichnung)}</button>`);
        btn.addEventListener('click', () => { belegAktuellerTyp = typ; renderBelege(container); });
        tabs.appendChild(btn);
    }

    const tbody = container.querySelector('#belege-tabelle-body');
    for (const b of belegeListe) {
        tbody.appendChild(el(`
            <tr>
                <td>${escapeHtml(b.belegnummer)}</td>
                <td>${formatDatum(b.belegdatum)}</td>
                <td>${escapeHtml(b.profil_name)}</td>
                <td>${escapeHtml(b.kunde_name)}</td>
                ${belegAktuellerTyp === 'korrektur' ? `<td>${b.bezug_rechnungsnummer ? `Rechnung ${escapeHtml(b.bezug_rechnungsnummer)}` : '–'}</td>` : ''}
                <td>
                    <button class="btn btn-klein" data-vorschau="${b.id}">Vorschau</button>
                    <button class="btn btn-klein" data-drucken="${b.id}">Drucken</button>
                    <button class="btn btn-klein" data-pdf="${b.id}">PDF exportieren</button>
                    <button class="btn btn-klein" data-email="${b.id}">Per E-Mail senden</button>
                </td>
            </tr>
        `));
    }

    tbody.querySelectorAll('[data-vorschau]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.belege.previewPdf(Number(btn.dataset.vorschau));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-drucken]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.belege.print(Number(btn.dataset.drucken));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-pdf]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.belege.exportPdf(Number(btn.dataset.pdf));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-email]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                const result = await window.api.belege.sendEmail(Number(btn.dataset.email));
                if (!result.empfaenger) {
                    alert('Für diesen Kunden ist keine E-Mail-Adresse hinterlegt. Bitte im Mailprogramm manuell eintragen. Die PDF-Datei wurde im Explorer geöffnet - zum Anhängen per Drag & Drop.');
                }
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    container.querySelector('#btn-neuer-beleg').addEventListener('click', () => { window.location.hash = '#/belege?neu=1'; });
}

async function renderBelegFormularSeite(container, typ, typDef, korrekturVonId) {
    const [profiles, customers, textBausteine, alleRechnungen, korrekturVorlage] = await Promise.all([
        window.api.profiles.list(),
        window.api.customers.list(),
        window.api.invoices.listTextBausteine(),
        typ === 'korrektur' ? window.api.invoices.list() : Promise.resolve([]),
        korrekturVonId ? window.api.invoices.get(korrekturVonId) : Promise.resolve(null)
    ]);
    // Eine Korrekturrechnung soll nur auf eine bereits finalisierte (also
    // inhaltlich feststehende) Rechnung verweisen können - ein Entwurf lässt
    // sich stattdessen direkt bearbeiten (siehe Auftrag Block 1, Punkt 7).
    const finalisierteRechnungen = alleRechnungen.filter((r) => r.status === 'finalisiert');

    const vorbelegtesProfil = korrekturVorlage ? korrekturVorlage.sender_profile_id : null;
    const vorbelegterKunde = korrekturVorlage ? korrekturVorlage.customer_id : null;
    const vorbelegterExtraText = korrekturVorlage
        ? `Korrektur zu Rechnung ${korrekturVorlage.rechnungsnummer} vom ${formatDatum(korrekturVorlage.rechnungsdatum)}.`
        : '';

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Neu: ${escapeHtml(typDef.bezeichnung)}</h1>
                <a href="#/belege" class="btn btn-klein">← Zurück zur Liste</a>
            </div>
            <form class="formular" id="beleg-formular">
                <div class="formular-raster">
                    <label>Absenderprofil
                        <select name="sender_profile_id" required>
                            ${profiles.map((p) => `<option value="${p.id}" ${p.id === vorbelegtesProfil ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                        </select>
                    </label>
                    <label>Kunde
                        <select name="customer_id" required>
                            ${customers.map((k) => `<option value="${k.id}" ${k.id === vorbelegterKunde ? 'selected' : ''}>${escapeHtml(k.kundennummer)} – ${escapeHtml(k.nachname_firma)}</option>`).join('')}
                        </select>
                    </label>
                    <label>Datum <input type="date" name="belegdatum" value="${heute()}" required /></label>
                    ${typ === 'korrektur' ? `
                    <label>Bezug-Rechnung (optional, nur finalisierte Rechnungen)
                        <select name="bezug_invoice_id">
                            <option value="">– keine –</option>
                            ${finalisierteRechnungen.map((r) => `<option value="${r.id}" ${korrekturVonId === r.id ? 'selected' : ''}>${escapeHtml(r.rechnungsnummer)} – ${escapeHtml(r.kunde_name)}</option>`).join('')}
                        </select>
                    </label>` : ''}
                </div>

                <h3>Positionen</h3>
                <table class="tabelle" id="positionen-tabelle">
                    <thead>
                        <tr><th>Art.-Nr.</th><th>Bezeichnung</th><th>Menge</th>${typDef.zeigtPreise ? '<th>EP netto</th><th>MwSt</th><th>Zeilensumme</th>' : ''}<th></th></tr>
                    </thead>
                    <tbody id="positionen-body"></tbody>
                </table>
                <button type="button" class="btn btn-klein" id="btn-position-hinzufuegen">+ Position hinzufügen</button>

                ${typDef.zeigtPreise ? '<div class="summenzeile" id="summen-anzeige"></div>' : ''}

                <label>Extrafeld (individuelle Information, erscheint auf dem Beleg)
                    <textarea name="extra_text" rows="2">${escapeHtml(vorbelegterExtraText)}</textarea>
                </label>

                <h3>Textbausteine</h3>
                <div id="textbaustein-checkboxen" style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
                    ${baueTextbausteinCheckboxenHtml(textBausteine)}
                </div>
                <label>Eigener freier Text (erscheint zusätzlich zu den ausgewählten Textbausteinen)
                    <textarea name="freier_text" rows="2"></textarea>
                </label>

                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">${escapeHtml(typDef.bezeichnung)} erstellen</button>
                    <a href="#/belege" class="btn">Abbrechen</a>
                </div>
            </form>
        </div>
    `));

    const form = container.querySelector('#beleg-formular');
    const positionenBody = container.querySelector('#positionen-body');
    let aktuelleMwstSaetze = typDef.zeigtPreise ? await window.api.mwstSaetze.list(Number(form.sender_profile_id.value)) : [];

    function positionsZeile(vorbelegung) {
        const v = vorbelegung || {};
        return el(`
            <tr class="position-zeile">
                <td><input name="artikel_nr" size="6" value="${escapeHtml(v.artikel_nr || '')}" /></td>
                <td><input name="bezeichnung" required value="${escapeHtml(v.bezeichnung || '')}" /></td>
                <td><input name="menge" type="number" step="0.01" value="${v.menge != null ? v.menge : 1}" required /></td>
                ${typDef.zeigtPreise ? `
                <td><input name="einzelpreis_netto" type="number" step="0.01" value="${v.einzelpreis_netto != null ? v.einzelpreis_netto : 0}" required /></td>
                <td>
                    <select name="mwst_satz">${baueMwstOptionsHtml(aktuelleMwstSaetze, v.mwst_satz != null ? v.mwst_satz : (aktuelleMwstSaetze[0] ? aktuelleMwstSaetze[0].satz : 19))}</select>
                </td>
                <td class="zeilensumme">0,00 €</td>` : '<td><input type="hidden" name="einzelpreis_netto" value="0" /><input type="hidden" name="mwst_satz" value="19" /></td>'}
                <td><button type="button" class="btn btn-klein btn-gefahr" data-remove-position>×</button></td>
            </tr>
        `);
    }

    function aktualisiereSummen() {
        if (!typDef.zeigtPreise) return;
        const positionen = Array.from(positionenBody.querySelectorAll('.position-zeile')).map((zeile) => ({
            menge: zeile.querySelector('[name="menge"]').value,
            einzelpreis_netto: zeile.querySelector('[name="einzelpreis_netto"]').value,
            mwst_satz: zeile.querySelector('[name="mwst_satz"]').value
        }));
        positionenBody.querySelectorAll('.position-zeile').forEach((zeile) => {
            const menge = Number(zeile.querySelector('[name="menge"]').value) || 0;
            const ep = Number(zeile.querySelector('[name="einzelpreis_netto"]').value) || 0;
            zeile.querySelector('.zeilensumme').textContent = formatEur(menge * ep);
        });
        container.querySelector('#summen-anzeige').innerHTML = summenHtml(berechneSummenClientseitig(positionen));
    }

    function neuePositionHinzufuegen(vorbelegung) {
        const zeile = positionsZeile(vorbelegung);
        positionenBody.appendChild(zeile);
        zeile.querySelectorAll('input, select').forEach((feld) => feld.addEventListener('input', aktualisiereSummen));
        aktiviereArtikelAutofill(zeile, aktualisiereSummen);
        zeile.querySelector('[data-remove-position]').addEventListener('click', () => {
            zeile.remove();
            aktualisiereSummen();
        });
    }

    // Bei einer Korrekturrechnung werden die Positionen der Ursprungsrechnung
    // als sinnvoller, neutraler Ausgangspunkt unverändert übernommen (siehe
    // Auftrag Block 1, Punkt 7) - KEINE automatische Vorzeichenumkehr, da die
    // Anwendung nicht weiß, ob ein vollständiges Storno oder nur eine
    // Teilkorrektur gewünscht ist. Der Nutzer passt Mengen/Preise/Zeilen
    // anschließend selbst an.
    if (korrekturVorlage && korrekturVorlage.positionen && korrekturVorlage.positionen.length > 0) {
        korrekturVorlage.positionen.forEach((pos) => neuePositionHinzufuegen(pos));
    } else {
        neuePositionHinzufuegen();
    }
    aktualisiereSummen();

    if (typDef.zeigtPreise) {
        form.sender_profile_id.addEventListener('change', async () => {
            aktuelleMwstSaetze = await window.api.mwstSaetze.list(Number(form.sender_profile_id.value));
            aktualisiereMwstOptionenInContainer(positionenBody, aktuelleMwstSaetze);
            aktualisiereSummen();
        });
    }

    container.querySelector('#btn-position-hinzufuegen').addEventListener('click', neuePositionHinzufuegen);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const positionen = Array.from(positionenBody.querySelectorAll('.position-zeile')).map((zeile) => ({
            artikel_nr: zeile.querySelector('[name="artikel_nr"]').value,
            bezeichnung: zeile.querySelector('[name="bezeichnung"]').value,
            menge: zeile.querySelector('[name="menge"]').value,
            einzelpreis_netto: zeile.querySelector('[name="einzelpreis_netto"]').value,
            mwst_satz: zeile.querySelector('[name="mwst_satz"]').value
        }));

        const data = {
            sender_profile_id: Number(form.sender_profile_id.value),
            customer_id: Number(form.customer_id.value),
            belegdatum: form.belegdatum.value,
            extra_text: form.extra_text.value || null,
            freier_text: form.freier_text.value || null,
            textBausteineSchluessel: sammleAusgewaehlteTextbausteine(form),
            bezug_invoice_id: form.bezug_invoice_id ? Number(form.bezug_invoice_id.value) || null : null,
            positionen
        };

        try {
            await window.api.belege.create(typ, data);
            window.location.hash = '#/belege';
        } catch (err) {
            showFehler(err.message);
        }
    });
}
