// Blockiert die Bedienoberfläche mit einer Passwortabfrage, sofern in den
// Einstellungen ein Passwort hinterlegt wurde. Wird bei jedem Programmstart
// erneut abgefragt (kein dauerhaftes "angemeldet bleiben").
async function pruefeLoginGate() {
    let gesetzt;
    try {
        gesetzt = await window.api.settings.isPasswordSet();
    } catch (err) {
        return true;
    }
    if (!gesetzt) return true;

    const sidebar = document.querySelector('.sidebar');
    sidebar.style.display = 'none';
    const view = document.getElementById('view');

    return new Promise((resolve) => {
        function zeigeFormular(fehler) {
            view.innerHTML = '';
            view.appendChild(el(`
                <div style="max-width:320px;margin:120px auto;text-align:center;">
                    <h1>Passwort erforderlich</h1>
                    ${fehler ? `<p style="color:#b42318;">${escapeHtml(fehler)}</p>` : ''}
                    <form id="login-formular">
                        <input type="password" name="passwort" autofocus style="width:100%;padding:8px;margin-bottom:10px;box-sizing:border-box;" />
                        <button type="submit" class="btn btn-primary" style="width:100%;">Entsperren</button>
                    </form>
                </div>
            `));
            view.querySelector('#login-formular').addEventListener('submit', async (event) => {
                event.preventDefault();
                const passwort = event.target.passwort.value;
                try {
                    const ok = await window.api.settings.verifyPassword(passwort);
                    if (ok) {
                        sidebar.style.display = '';
                        resolve(true);
                    } else {
                        zeigeFormular('Falsches Passwort.');
                    }
                } catch (err) {
                    zeigeFormular(err.message);
                }
            });
        }
        zeigeFormular();
    });
}
