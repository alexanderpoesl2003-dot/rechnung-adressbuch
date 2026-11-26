// Produktschlüssel-/Testzeitraum-Sperre (siehe Auftrag "Produktschlüssel für
// Weitergabe", src/main/services/lizenz.js) - analog zu login-gate.js:
// blockiert die Bedienoberfläche mit einer Eingabemaske, bis ein gültiger
// Schlüssel eingegeben wurde. Läuft VOR dem Passwortschutz (siehe app.js),
// da diese Sperre grundsätzlicher ist. Bewusst nie destruktiv - siehe
// Moduldoc in lizenz.js.
// Texte der Sperrseite je nach Grund (siehe lizenzstatus() in lizenz.js).
// mitAktivieren: Knopf, der die bereits gespeicherte Lizenz erneut online aktiviert.
const LIZENZ_SPERRTEXTE = {
    abgelaufen: {
        titel: 'Testzeitraum abgelaufen',
        text: 'Der kostenlose Testzeitraum ist abgelaufen. Für einen Produktschlüssel bitte melden bei:'
    },
    aktivierung_noetig: {
        titel: 'Aktivierung erforderlich',
        text: 'Ihre Lizenz muss einmalig online aktiviert werden. Bitte stellen Sie eine Internetverbindung her '
            + 'und klicken Sie auf „Jetzt aktivieren“. Ihre Daten bleiben vollständig erhalten. Bei Fragen:',
        mitAktivieren: 'Jetzt aktivieren'
    },
    gesperrt: {
        titel: 'Lizenz gesperrt',
        text: 'Dieser Lizenzschlüssel wurde gesperrt. Ihre Daten bleiben vollständig erhalten. Bitte wenden Sie sich an:',
        mitAktivieren: 'Erneut prüfen'
    },
    anderer_rechner: {
        titel: 'Lizenz auf einem anderen Computer aktiv',
        text: 'Dieser Lizenzschlüssel ist bereits auf einem anderen Computer aktiviert. Wenn Sie den Computer '
            + 'gewechselt haben, wenden Sie sich bitte an die folgende Adresse und klicken Sie danach auf „Erneut aktivieren“:',
        mitAktivieren: 'Erneut aktivieren'
    }
};

const LIZENZ_DATENSCHUTZ_HINWEIS = 'Bei der Aktivierung werden die Seriennummer und eine anonymisierte Kennung dieses '
    + 'Computers an AP Services übertragen. Danach prüft das Programm etwa einmal pro Woche, ob die Lizenz noch gültig ist.';

async function pruefeLizenzGate() {
    let status;
    try {
        status = await window.api.lizenz.status();
    } catch (err) {
        return true; // im Zweifel nicht aussperren, falls die Prüfung selbst fehlschlägt
    }

    if (status.freigeschaltet) {
        if (status.grund === 'testzeitraum') {
            zeigeTestzeitraumHinweis(status);
        } else if (status.grund === 'aktivierung_ausstehend' && status.aktivierungTageVerbleibend <= 25) {
            zeigeAktivierungHinweis(status);
        }
        return true;
    }

    const sidebar = document.querySelector('.sidebar');
    sidebar.style.display = 'none';
    const view = document.getElementById('view');
    const texte = LIZENZ_SPERRTEXTE[status.grund] || LIZENZ_SPERRTEXTE.abgelaufen;

    return new Promise((resolve) => {
        function freigeben() {
            sidebar.style.display = '';
            resolve(true);
        }

        function zeigeFormular(fehler) {
            view.innerHTML = '';
            view.appendChild(el(`
                <div style="max-width:440px;margin:100px auto;text-align:center;">
                    <h1>${escapeHtml(texte.titel)}</h1>
                    <p>${escapeHtml(texte.text)}</p>
                    <p><strong>${escapeHtml(status.kontaktEmail)}</strong></p>
                    ${fehler ? `<p style="color:#b42318;">${escapeHtml(fehler)}</p>` : ''}
                    ${texte.mitAktivieren ? `
                        <button type="button" class="btn btn-primary" id="lizenz-aktivieren" style="width:100%;margin-bottom:24px;">
                            ${escapeHtml(texte.mitAktivieren)}
                        </button>
                        <p style="font-size:13px;">Oder einen anderen Produktschlüssel eingeben:</p>` : ''}
                    <form id="lizenz-formular">
                        <textarea name="schluessel" ${texte.mitAktivieren ? '' : 'autofocus'} rows="3"
                               style="width:100%;padding:8px;margin-bottom:10px;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:12px;word-break:break-all;"></textarea>
                        <button type="submit" class="btn ${texte.mitAktivieren ? '' : 'btn-primary'}" style="width:100%;">Freischalten</button>
                    </form>
                    <p style="font-size:12px;color:#98a2b3;margin-top:16px;">${escapeHtml(LIZENZ_DATENSCHUTZ_HINWEIS)}</p>
                </div>
            `));
            const aktivierenKnopf = view.querySelector('#lizenz-aktivieren');
            if (aktivierenKnopf) {
                aktivierenKnopf.addEventListener('click', async () => {
                    aktivierenKnopf.disabled = true;
                    aktivierenKnopf.textContent = 'Wird aktiviert …';
                    try {
                        await window.api.lizenz.aktivieren();
                        freigeben();
                    } catch (err) {
                        zeigeFormular(err.message);
                    }
                });
            }
            view.querySelector('#lizenz-formular').addEventListener('submit', async (event) => {
                event.preventDefault();
                const knopf = event.target.querySelector('button[type="submit"]');
                knopf.disabled = true;
                knopf.textContent = 'Wird aktiviert …';
                try {
                    const ok = await window.api.lizenz.einloesen(event.target.schluessel.value);
                    if (ok) {
                        freigeben();
                    } else {
                        zeigeFormular('Dieser Schlüssel ist ungültig.');
                    }
                } catch (err) {
                    zeigeFormular(err.message);
                }
            });
        }
        zeigeFormular();
    });
}

// Hinweis für Bestandskunden, deren Hintergrund-Aktivierung seit einigen
// Tagen nicht klappt (meist: kein Internet) - nicht blockierend.
function zeigeAktivierungHinweis(status) {
    const tage = status.aktivierungTageVerbleibend;
    const overlay = el(`
        <div id="aktivierung-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.35);
                     display:flex;align-items:center;justify-content:center;z-index:1000;">
            <div style="background:#fff;border-radius:10px;padding:28px 32px;max-width:400px;text-align:center;
                        box-shadow:0 8px 30px rgba(0,0,0,0.25);">
                <h2 style="margin-top:0;">Lizenz bitte aktivieren</h2>
                <p>Ihre Lizenz muss einmalig online aktiviert werden. Das hat bisher nicht geklappt, meist fehlt
                    die Internetverbindung. Noch ${tage} Tag${tage === 1 ? '' : 'e'} bis zur Sperre.</p>
                <p id="aktivierung-meldung" style="color:#b42318;"></p>
                <button type="button" class="btn btn-primary" id="aktivierung-jetzt">Jetzt aktivieren</button>
                <button type="button" class="btn" id="aktivierung-spaeter" style="margin-left:6px;">Später</button>
            </div>
        </div>
    `);
    document.body.appendChild(overlay);
    const knopf = overlay.querySelector('#aktivierung-jetzt');
    knopf.addEventListener('click', async () => {
        knopf.disabled = true;
        try {
            await window.api.lizenz.aktivieren();
            overlay.remove();
        } catch (err) {
            overlay.querySelector('#aktivierung-meldung').textContent = err.message;
            knopf.disabled = false;
        }
    });
    overlay.querySelector('#aktivierung-spaeter').addEventListener('click', () => overlay.remove());
}

// Nicht blockierender Hinweis bei JEDEM Programmstart während der
// Testphase (siehe Auftrag "Testzeitraum-Hinweis bei jedem Öffnen") -
// zeigt Tag X von Y, verbleibende Tage und die Kontakt-E-Mail für einen
// Schlüssel. Lässt sich schließen, ohne die Arbeit zu unterbrechen -
// anders als die eigentliche Sperre nach Ablauf des Testzeitraums.
function zeigeTestzeitraumHinweis(status) {
    const restText = status.tageVerbleibend === 0
        ? 'Der Testzeitraum endet heute.'
        : `Noch ${status.tageVerbleibend} Tag${status.tageVerbleibend === 1 ? '' : 'e'} übrig.`;

    const overlay = el(`
        <div id="testzeitraum-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.35);
                     display:flex;align-items:center;justify-content:center;z-index:1000;">
            <div style="background:#fff;border-radius:10px;padding:28px 32px;max-width:380px;text-align:center;
                        box-shadow:0 8px 30px rgba(0,0,0,0.25);">
                <h2 style="margin-top:0;">Testversion – Tag ${status.tageVergangen} von ${status.trialTage}</h2>
                <p>${escapeHtml(restText)}</p>
                <p>Sie haben noch keinen Produktschlüssel? Schreiben Sie uns gerne eine E-Mail an
                    <strong>${escapeHtml(status.kontaktEmail)}</strong> und fragen Sie kurz nach einem Schlüssel.
                </p>
                <p style="font-size:12px;color:#98a2b3;">Den Schlüssel können Sie jederzeit unter
                    "Einstellungen -> Produktschlüssel" eingeben, auch schon vor Ablauf der Testphase.</p>
                <button type="button" class="btn btn-primary" id="testzeitraum-schliessen" style="margin-top:8px;">
                    Weiter zur Software
                </button>
            </div>
        </div>
    `);
    document.body.appendChild(overlay);
    function schliessen() { overlay.remove(); }
    overlay.querySelector('#testzeitraum-schliessen').addEventListener('click', schliessen);
    overlay.addEventListener('click', (ereignis) => { if (ereignis.target === overlay) schliessen(); });
}
