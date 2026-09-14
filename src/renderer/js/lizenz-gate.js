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
        if (status.grund === 'testzeitraum' && status.tageVerbleibend <= 3) {
            zeigeTestzeitraumHinweis(status.tageVerbleibend);
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

// Kleiner, nicht blockierender Hinweis in den letzten Testtagen - erinnert
// rechtzeitig, ohne die Arbeit zu unterbrechen (anders als die eigentliche
// Sperre nach Ablauf).
function zeigeTestzeitraumHinweis(tageVerbleibend) {
    const text = tageVerbleibend === 0
        ? 'Der Testzeitraum endet heute.'
        : `Noch ${tageVerbleibend} Tag${tageVerbleibend === 1 ? '' : 'e'} Testzeitraum.`;
    const hinweis = el(`
        <div style="position:fixed;bottom:12px;right:12px;background:#fffbea;border:1px solid #f0c36d;
                     color:#7a5b00;padding:8px 14px;border-radius:6px;font-size:12px;z-index:999;">
            ${escapeHtml(text)}
        </div>
    `);
    document.body.appendChild(hinweis);
    setTimeout(() => hinweis.remove(), 6000);
}
