const EUR = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatEur(value) {
    return `${EUR.format(value || 0)} €`;
}

function formatDatum(isoDatum) {
    if (!isoDatum) return '';
    const [jahr, monat, tag] = isoDatum.split('-');
    return `${tag}.${monat}.${jahr}`;
}

function heute() {
    return new Date().toISOString().slice(0, 10);
}

function el(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Füllt Bezeichnung/Preis/MwSt einer Positionszeile automatisch, sobald eine
// bekannte Artikel-Nr. eingegeben und das Feld verlassen wird.
function aktiviereArtikelAutofill(zeile, aktualisiereSummenFn) {
    const artikelFeld = zeile.querySelector('[name="artikel_nr"]');
    artikelFeld.addEventListener('blur', async () => {
        const nr = artikelFeld.value.trim();
        if (!nr) return;
        try {
            const artikel = await window.api.artikel.findByNr(nr);
            if (!artikel) return;
            zeile.querySelector('[name="bezeichnung"]').value = artikel.bezeichnung;
            zeile.querySelector('[name="einzelpreis_netto"]').value = artikel.verkaufspreis_netto;
            setzeMwstWertOderErgaenze(zeile.querySelector('[name="mwst_satz"]'), artikel.mwst_satz);
            aktualisiereSummenFn();
        } catch (err) {
            // Unbekannte Artikel-Nr. oder Nachschlage-Fehler - Zeile bleibt unverändert
        }
    });
}

// Baut die <option>-Elemente für ein MwSt-Auswahlfeld aus den Sätzen eines
// Profils. ausgewaehlterSatz wird als selected markiert; ist er nicht in der
// Liste enthalten (z.B. abweichender Wert aus einem Artikel-Datensatz), wird
// er trotzdem als zusätzliche Option ergänzt, damit er nicht verloren geht.
function baueMwstOptionsHtml(saetze, ausgewaehlterSatz) {
    const vorhanden = saetze.some((s) => Number(s.satz) === Number(ausgewaehlterSatz));
    const optionen = saetze.map((s) => `<option value="${s.satz}" ${Number(s.satz) === Number(ausgewaehlterSatz) ? 'selected' : ''}>${formatSatzDe(s.satz)}%${s.bezeichnung ? ' – ' + escapeHtml(s.bezeichnung) : ''}</option>`);
    if (!vorhanden && ausgewaehlterSatz != null && ausgewaehlterSatz !== '') {
        optionen.push(`<option value="${ausgewaehlterSatz}" selected>${formatSatzDe(ausgewaehlterSatz)}%</option>`);
    }
    return optionen.join('');
}

function formatSatzDe(satz) {
    return String(satz).replace('.', ',');
}

// Setzt den Wert eines MwSt-<select> und ergänzt bei Bedarf eine passende
// Option, falls der Satz aktuell nicht in der Liste enthalten ist.
function setzeMwstWertOderErgaenze(select, satz) {
    select.value = String(satz);
    if (select.value !== String(satz)) {
        select.appendChild(el(`<option value="${satz}" selected>${formatSatzDe(satz)}%</option>`));
        select.value = String(satz);
    }
}

// Aktualisiert die Options aller MwSt-Selects innerhalb eines Containers auf
// die Sätze eines neu gewählten Profils, behält dabei die bisherige Auswahl
// bei, falls der Satz im neuen Profil ebenfalls existiert.
function aktualisiereMwstOptionenInContainer(container, saetze) {
    container.querySelectorAll('select[name="mwst_satz"]').forEach((select) => {
        const bisheriger = select.value;
        select.innerHTML = baueMwstOptionsHtml(saetze, bisheriger);
    });
}

// Baut Checkboxen für die Mehrfachauswahl von Textbausteinen. ausgewaehlt ist
// ein optionales Set bereits ausgewählter Schlüssel (z.B. beim Duplizieren
// einer Rechnung, um die bisherige Auswahl zu übernehmen).
function baueTextbausteinCheckboxenHtml(textBausteine, ausgewaehlt) {
    const ausgewaehltSet = ausgewaehlt || new Set();
    return textBausteine.map((t) => `
        <label style="display:flex;align-items:center;gap:6px;font-weight:normal;">
            <input type="checkbox" name="textbaustein" value="${escapeHtml(t.schluessel)}" ${ausgewaehltSet.has(t.schluessel) ? 'checked' : ''} />
            ${escapeHtml(t.titel)}
        </label>
    `).join('');
}

function sammleAusgewaehlteTextbausteine(form) {
    return Array.from(form.querySelectorAll('input[name="textbaustein"]:checked')).map((cb) => cb.value);
}

// Client-seitige Vorschau-Berechnung, spiegelt calculateTotals() im Hauptprozess
// (invoices.js): Aufteilung nach beliebigen, tatsächlich verwendeten MwSt-Sätzen.
function berechneSummenClientseitig(positionen) {
    const runden = (n) => Math.round(n * 100) / 100;
    const nachSatz = new Map();
    let netto = 0;

    for (const pos of positionen) {
        const satz = Number(pos.mwst_satz) || 0;
        const zeilenNetto = Number(pos.menge) * Number(pos.einzelpreis_netto) || 0;
        netto += zeilenNetto;
        const eintrag = nachSatz.get(satz) || { satz, netto: 0, mwstBetrag: 0 };
        eintrag.netto += zeilenNetto;
        eintrag.mwstBetrag += zeilenNetto * (satz / 100);
        nachSatz.set(satz, eintrag);
    }

    const aufteilung = Array.from(nachSatz.values())
        .sort((a, b) => a.satz - b.satz)
        .map((a) => ({ satz: a.satz, netto: runden(a.netto), mwstBetrag: runden(a.mwstBetrag) }));
    const mwstGesamt = aufteilung.reduce((sum, a) => sum + a.mwstBetrag, 0);

    return { netto: runden(netto), mwstGesamt: runden(mwstGesamt), brutto: runden(netto + mwstGesamt), aufteilung };
}

function summenHtml(summen) {
    const zeilen = summen.aufteilung.map((a) => `<div>MwSt ${formatSatzDe(a.satz)}%: ${formatEur(a.mwstBetrag)}</div>`).join('');
    return `
        <div>Nettosumme: ${formatEur(summen.netto)}</div>
        ${zeilen}
        <div class="summe-gesamt">Gesamtbetrag: ${formatEur(summen.brutto)}</div>
    `;
}

function showFehler(message) {
    const banner = el(`<div class="fehler-banner">${escapeHtml(message)}</div>`);
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 4000);
}
