let rechnungenAnsicht = 'alle';

async function renderInvoices(container, params) {
    if (params && params.neu) {
        return renderRechnungFormularSeite(container, null);
    }
    if (params && params.duplizierenVon) {
        const vorlage = await window.api.invoices.get(Number(params.duplizierenVon));
        return renderRechnungFormularSeite(container, vorlage);
    }
    if (params && params.bearbeiten) {
        const rechnung = await window.api.invoices.get(Number(params.bearbeiten));
        return renderRechnungFormularSeite(container, rechnung, rechnung.id);
    }

    const invoices = rechnungenAnsicht === 'offen'
        ? await window.api.invoices.offenePosten()
        : await window.api.invoices.list();

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>Rechnungen</h1>
                <button class="btn btn-primary" id="btn-neue-rechnung">+ Neue Rechnung</button>
            </div>
            <div style="margin-bottom:14px;">
                <button class="btn btn-klein ${rechnungenAnsicht === 'alle' ? 'btn-primary' : ''}" id="btn-ansicht-alle">Alle Rechnungen</button>
                <button class="btn btn-klein ${rechnungenAnsicht === 'offen' ? 'btn-primary' : ''}" id="btn-ansicht-offen">Offene Posten</button>
            </div>
            <table class="tabelle" id="rechnungen-tabelle">
                <thead>
                    <tr>
                        <th>Rechnungsnr.</th><th>Datum</th><th>Profil</th><th>Kunde</th><th>Status</th>
                        <th>Bezahlt</th>${rechnungenAnsicht === 'offen' ? '<th>Offener Betrag</th>' : ''}<th></th>
                    </tr>
                </thead>
                <tbody id="rechnungen-tabelle-body"></tbody>
            </table>
        </div>
    `));

    const tbody = container.querySelector('#rechnungen-tabelle-body');
    for (const r of invoices) {
        const istFinalisiert = r.status === 'finalisiert';
        tbody.appendChild(el(`
            <tr>
                <td>${escapeHtml(r.rechnungsnummer)}</td>
                <td>${formatDatum(r.rechnungsdatum)}</td>
                <td>${escapeHtml(r.profil_name)}</td>
                <td>${escapeHtml(r.kunde_name)}</td>
                <td><span class="status status-${escapeHtml(r.status)}">${istFinalisiert ? 'Finalisiert' : 'Entwurf'}</span></td>
                <td>
                    <button class="btn btn-klein ${r.bezahlt ? '' : 'btn-gefahr'}" data-toggle-bezahlt="${r.id}">
                        ${r.bezahlt ? `bezahlt am ${formatDatum(r.bezahlt_am)}` : 'offen'}
                    </button>
                </td>
                ${rechnungenAnsicht === 'offen' ? `<td>${formatEur(r.offener_betrag)}</td>` : ''}
                <td>
                    <div class="aktionen-zelle">
                        <button class="btn btn-klein" data-vorschau="${r.id}">Vorschau</button>
                        <button class="btn btn-klein" data-drucken="${r.id}">Drucken</button>
                        <button class="btn btn-klein" data-pdf="${r.id}">PDF exportieren</button>
                        <button class="btn btn-klein" data-email="${r.id}">Per E-Mail senden</button>
                        <button class="btn btn-klein" data-duplizieren="${r.id}">Duplizieren</button>
                        ${istFinalisiert ? `
                        <button class="btn btn-klein" data-korrektur="${r.id}">Korrekturrechnung erstellen</button>
                        ` : `
                        <button class="btn btn-klein" data-bearbeiten="${r.id}">Bearbeiten</button>
                        <button class="btn btn-klein btn-primary" data-finalisieren="${r.id}">Rechnung abschließen</button>
                        <button class="btn btn-klein btn-gefahr" data-delete="${r.id}">Löschen</button>
                        `}
                    </div>
                </td>
            </tr>
        `));
    }

    tbody.querySelectorAll('[data-vorschau]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.invoices.previewPdf(Number(btn.dataset.vorschau));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-drucken]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.invoices.print(Number(btn.dataset.drucken));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-pdf]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await window.api.invoices.exportPdf(Number(btn.dataset.pdf));
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-email]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.email);
            const rechnung = invoices.find((r) => r.id === id);

            // Eine Rechnung, die tatsächlich per E-Mail verschickt wird, muss
            // vorher abgeschlossen sein (siehe Auftrag Block 1, Punkt 11) -
            // nicht still und unbemerkt, sondern über eine bewusste Abfrage.
            if (rechnung && rechnung.status !== 'finalisiert') {
                const bestaetigt = confirm(
                    'Diese Rechnung ist noch ein Entwurf. Vor dem Versand muss sie abgeschlossen werden.\n\n' +
                    'Jetzt abschließen und anschließend versenden?'
                );
                if (!bestaetigt) return;
                try {
                    await window.api.invoices.finalisieren(id);
                } catch (err) {
                    showFehler(err.message);
                    return;
                }
            }

            btn.disabled = true;
            const textVorher = btn.textContent;
            btn.textContent = 'Sende...';
            try {
                const result = await window.api.invoices.sendEmail(id);
                if (result.versendet) {
                    renderInvoices(container);
                } else {
                    showFehler(`E-Mail konnte nicht gesendet werden: ${result.fehler}`);
                }
            } catch (err) {
                showFehler(err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = textVorher;
            }
        });
    });

    tbody.querySelectorAll('[data-finalisieren]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.finalisieren);
            const rechnung = invoices.find((r) => r.id === id);
            const bestaetigt = confirm(
                `Rechnung ${rechnung ? rechnung.rechnungsnummer : ''} abschließen?\n\n` +
                'Rechnungsnummer, Positionen, Beträge und alle weiteren Rechnungsinhalte können ' +
                'danach nicht mehr geändert werden. Korrekturen sind anschließend nur noch über ' +
                'eine Korrekturrechnung möglich.'
            );
            if (!bestaetigt) return;
            try {
                await window.api.invoices.finalisieren(id);
                renderInvoices(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-korrektur]').forEach((btn) => {
        btn.addEventListener('click', () => {
            window.location.hash = `#/belege?korrekturVon=${btn.dataset.korrektur}`;
        });
    });

    tbody.querySelectorAll('[data-duplizieren]').forEach((btn) => {
        btn.addEventListener('click', () => {
            window.location.hash = `#/invoices?duplizierenVon=${btn.dataset.duplizieren}`;
        });
    });

    tbody.querySelectorAll('[data-bearbeiten]').forEach((btn) => {
        btn.addEventListener('click', () => {
            window.location.hash = `#/invoices?bearbeiten=${btn.dataset.bearbeiten}`;
        });
    });

    tbody.querySelectorAll('[data-toggle-bezahlt]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.toggleBezahlt);
            const rechnung = invoices.find((r) => r.id === id);
            try {
                if (rechnung.bezahlt) {
                    await window.api.invoices.markBezahlt(id, { bezahlt: false });
                } else {
                    const betragEingabe = prompt('Erhaltener Betrag in €:', String(rechnung.summen.brutto));
                    if (betragEingabe === null) return;
                    await window.api.invoices.markBezahlt(id, {
                        bezahlt: true,
                        bezahltAm: heute(),
                        bezahltBetrag: betragEingabe
                    });
                }
                renderInvoices(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Diese Rechnung wirklich unwiderruflich löschen?')) return;
            try {
                await window.api.invoices.remove(Number(btn.dataset.delete));
                renderInvoices(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    container.querySelector('#btn-neue-rechnung').addEventListener('click', () => { window.location.hash = '#/invoices?neu=1'; });
    container.querySelector('#btn-ansicht-alle').addEventListener('click', () => { rechnungenAnsicht = 'alle'; renderInvoices(container); });
    container.querySelector('#btn-ansicht-offen').addEventListener('click', () => { rechnungenAnsicht = 'offen'; renderInvoices(container); });
}

// Eigene Seite zum Anlegen/Bearbeiten/Duplizieren (statt Inline-Formular unter
// der Liste). vorlage ist optional: eine bestehende Rechnung (aus
// invoices.get()), von der Profil/Kunde/Positionen/Texte übernommen werden
// ("Rechnung duplizieren"). Datum und Rechnungsnummer werden dabei immer neu
// vergeben. bearbeitenId ist optional: die id einer bestehenden Rechnung, die
// damit statt dupliziert tatsächlich bearbeitet (überschrieben) wird - dann
// bleiben Rechnungsdatum, Leistungsdatum und Rechnungsnummer aus der Vorlage
// erhalten.
async function renderRechnungFormularSeite(container, vorlage, bearbeitenId) {
    const [profiles, customers, textBausteine] = await Promise.all([
        window.api.profiles.list(),
        window.api.customers.list(),
        window.api.invoices.listTextBausteine()
    ]);

    const istBearbeiten = Boolean(bearbeitenId);
    const vorbelegtesProfil = vorlage ? vorlage.sender_profile_id : null;
    const vorbelegterKunde = vorlage ? vorlage.customer_id : null;
    const ausgewaehlteTextbausteine = new Set(((vorlage && vorlage.textBausteine) || []).map((t) => t.schluessel));
    const rechnungsdatumWert = istBearbeiten && vorlage ? vorlage.rechnungsdatum : heute();
    const leistungsdatumWert = istBearbeiten && vorlage ? (vorlage.leistungsdatum || vorlage.rechnungsdatum) : heute();

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <div class="view-kopf">
                <h1>${istBearbeiten ? 'Rechnung bearbeiten' : (vorlage ? 'Rechnung duplizieren' : 'Neue Rechnung')}</h1>
                <a href="#/invoices" class="btn btn-klein">← Zurück zu den Rechnungen</a>
            </div>
            <form class="formular" id="rechnung-formular">
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
                    <label>Rechnungsdatum <input type="date" name="rechnungsdatum" value="${rechnungsdatumWert}" required /></label>
                    <label>Leistungsdatum (Datum der Lieferung/Leistung, ggf. abweichend vom Rechnungsdatum)
                        <input type="date" name="leistungsdatum" value="${leistungsdatumWert}" required />
                    </label>
                    <label>Rechnungsnummer ${istBearbeiten ? '' : '(optional – leer lassen für automatische Vergabe)'}
                        <input type="text" name="rechnungsnummer" value="${istBearbeiten && vorlage ? escapeHtml(vorlage.rechnungsnummer) : ''}" placeholder="${istBearbeiten ? '' : 'wird automatisch vergeben'}" />
                    </label>
                </div>

                <h3>Positionen</h3>
                <table class="tabelle" id="positionen-tabelle">
                    <thead>
                        <tr><th>Art.-Nr.</th><th>Bezeichnung</th><th>Menge</th><th>EP netto</th><th>MwSt</th><th>Zeilensumme</th><th></th></tr>
                    </thead>
                    <tbody id="positionen-body"></tbody>
                </table>
                <button type="button" class="btn btn-klein" id="btn-position-hinzufuegen">+ Position hinzufügen</button>

                <div class="summenzeile" id="summen-anzeige"></div>

                <label>Extrafeld (individuelle Information, erscheint auf der Rechnung)
                    <textarea name="extra_text" rows="2">${escapeHtml(vorlage ? vorlage.extra_text : '')}</textarea>
                </label>

                <h3>Textbausteine</h3>
                <div id="textbaustein-checkboxen" style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
                    ${baueTextbausteinCheckboxenHtml(textBausteine, ausgewaehlteTextbausteine)}
                </div>
                <label>Eigener freier Text (erscheint zusätzlich zu den ausgewählten Textbausteinen)
                    <textarea name="freier_text" rows="2">${escapeHtml(vorlage ? vorlage.freier_text : '')}</textarea>
                </label>

                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">${istBearbeiten ? 'Änderungen speichern' : 'Rechnung erstellen'}</button>
                    <a href="#/invoices" class="btn">Abbrechen</a>
                </div>
            </form>
        </div>
    `));

    const form = container.querySelector('#rechnung-formular');
    const positionenBody = container.querySelector('#positionen-body');
    let aktuelleMwstSaetze = await window.api.mwstSaetze.list(Number(form.sender_profile_id.value));

    function positionsZeile(vorbelegung) {
        const v = vorbelegung || {};
        return el(`
            <tr class="position-zeile">
                <td><input name="artikel_nr" size="6" value="${escapeHtml(v.artikel_nr || '')}" /></td>
                <td><input name="bezeichnung" required value="${escapeHtml(v.bezeichnung || '')}" /></td>
                <td><input name="menge" type="number" step="0.01" value="${v.menge != null ? v.menge : 1}" required /></td>
                <td><input name="einzelpreis_netto" type="number" step="0.01" value="${v.einzelpreis_netto != null ? v.einzelpreis_netto : 0}" required /></td>
                <td>
                    <select name="mwst_satz">${baueMwstOptionsHtml(aktuelleMwstSaetze, v.mwst_satz != null ? v.mwst_satz : (aktuelleMwstSaetze[0] ? aktuelleMwstSaetze[0].satz : 19))}</select>
                </td>
                <td class="zeilensumme">0,00 €</td>
                <td><button type="button" class="btn btn-klein btn-gefahr" data-remove-position>×</button></td>
            </tr>
        `);
    }

    function aktualisiereSummen() {
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

    if (vorlage && vorlage.positionen && vorlage.positionen.length > 0) {
        vorlage.positionen.forEach((pos) => neuePositionHinzufuegen(pos));
    } else {
        neuePositionHinzufuegen();
    }
    aktualisiereSummen();

    form.sender_profile_id.addEventListener('change', async () => {
        aktuelleMwstSaetze = await window.api.mwstSaetze.list(Number(form.sender_profile_id.value));
        aktualisiereMwstOptionenInContainer(positionenBody, aktuelleMwstSaetze);
        aktualisiereSummen();
    });

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
            rechnungsdatum: form.rechnungsdatum.value,
            leistungsdatum: form.leistungsdatum.value || null,
            rechnungsnummer: form.rechnungsnummer.value || null,
            extra_text: form.extra_text.value || null,
            freier_text: form.freier_text.value || null,
            textBausteineSchluessel: sammleAusgewaehlteTextbausteine(form),
            positionen
        };

        try {
            if (istBearbeiten) {
                await window.api.invoices.update(bearbeitenId, data);
            } else {
                await window.api.invoices.create(data);
            }
            window.location.hash = '#/invoices';
        } catch (err) {
            showFehler(err.message);
        }
    });
}
