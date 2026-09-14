// Produktschlüssel-/Testzeitraum-Sperre (siehe Auftrag "Produktschlüssel für
// Weitergabe", src/main/services/lizenz.js) - analog zu login-gate.js:
// blockiert die Bedienoberfläche mit einer Eingabemaske, bis ein gültiger
// Schlüssel eingegeben wurde. Läuft VOR dem Passwortschutz (siehe app.js),
// da diese Sperre grundsätzlicher ist. Bewusst nie destruktiv - siehe
// Moduldoc in lizenz.js.
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
        }
        return true;
    }

    const sidebar = document.querySelector('.sidebar');
    sidebar.style.display = 'none';
    const view = document.getElementById('view');

    return new Promise((resolve) => {
        function zeigeFormular(fehler) {
            view.innerHTML = '';
            view.appendChild(el(`
                <div style="max-width:420px;margin:100px auto;text-align:center;">
                    <h1>Testzeitraum abgelaufen</h1>
                    <p>Der kostenlose Testzeitraum ist abgelaufen. Für einen Produktschlüssel bitte melden bei:</p>
                    <p><strong>${escapeHtml(status.kontaktEmail)}</strong></p>
                    ${fehler ? `<p style="color:#b42318;">${escapeHtml(fehler)}</p>` : ''}
                    <form id="lizenz-formular">
                        <input type="text" name="schluessel" placeholder="AP-XXXXX-XXXX-XXXX" autofocus
                               style="width:100%;padding:8px;margin-bottom:10px;box-sizing:border-box;text-align:center;letter-spacing:1px;" />
                        <button type="submit" class="btn btn-primary" style="width:100%;">Freischalten</button>
                    </form>
                </div>
            `));
            view.querySelector('#lizenz-formular').addEventListener('submit', async (event) => {
                event.preventDefault();
                const schluessel = event.target.schluessel.value;
                try {
                    const ok = await window.api.lizenz.einloesen(schluessel);
                    if (ok) {
                        sidebar.style.display = '';
                        resolve(true);
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
