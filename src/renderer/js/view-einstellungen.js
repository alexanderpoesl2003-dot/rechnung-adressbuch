async function renderEinstellungen(container) {
    const [passwortGesetzt, version] = await Promise.all([
        window.api.settings.isPasswordSet(),
        window.api.app.version()
    ]);

    container.innerHTML = '';
    container.appendChild(el(`
        <div>
            <h1>Einstellungen</h1>

            <h2>Produktschlüssel</h2>
            <div id="lizenz-bereich"></div>

            <h2>Datensicherung</h2>
            <p>Backups werden ausschließlich lokal auf diesem Rechner gespeichert - kein Cloud-Upload, keine Übertragung an Dritte.</p>
            <p>Erstellt eine eigenständige Kopie aller Daten (Datenbank inkl. Kunden/Rechnungen/Belege/Artikel sowie Firmenlogos) in einer einzigen Datei.</p>
            <button class="btn btn-primary" id="btn-backup">Backup jetzt erstellen</button>
            <button class="btn btn-gefahr" id="btn-restore">Backup wiederherstellen</button>

            <h3 style="font-size:14px;margin-top:24px;">Automatische Backups</h3>
            <div id="auto-backup-bereich"></div>

            <h2>Textbausteine</h2>
            <p>Frei verwaltbare Textbausteine, die beim Schreiben von Rechnungen, Belegen und Mahnungen zum Anhaken zur Verfügung stehen.</p>
            <div id="textbausteine-bereich"></div>

            <h2>E-Mail-Versand</h2>
            <p>Einmal eingerichtet, kann jede Rechnung per Knopfdruck direkt per E-Mail verschickt werden (Text + Rechnung als PDF-Anhang), statt nur das Mailprogramm vorzubefüllen.</p>
            <div id="email-versand-bereich"></div>

            <h2>Passwortschutz</h2>
            <p>Status: <strong>${passwortGesetzt ? 'aktiviert' : 'deaktiviert'}</strong></p>
            <div id="passwort-bereich"></div>

            <h2>Updates</h2>
            <p>Aktuelle Version: <strong>${escapeHtml(version)}</strong></p>
            <button class="btn" id="btn-update-check">Jetzt nach Updates suchen</button>

            <div style="margin-top:40px;font-size:12px;color:#98a2b3;">
                Version ${escapeHtml(version)} · Entwickelt von Alexander Pösl
            </div>
        </div>
    `));

    container.querySelector('#btn-backup').addEventListener('click', async () => {
        try {
            const result = await window.api.backup.erstellen();
            if (result) alert(`Backup gespeichert unter:\n${result.pfad}`);
        } catch (err) {
            showFehler(err.message);
        }
    });

    container.querySelector('#btn-restore').addEventListener('click', async () => {
        try {
            const auswahl = await window.api.backup.auswaehlenUndValidieren();
            if (!auswahl) return; // Nutzer hat den Dateidialog abgebrochen

            const m = auswahl.manifest;
            const bestaetigt = confirm(
                'ACHTUNG: Beim Wiederherstellen werden ALLE aktuellen Daten (Kunden, Rechnungen, Belege, ' +
                'Einstellungen) durch den Stand aus diesem Backup ERSETZT.\n\n' +
                `Backup vom: ${m.createdAt ? new Date(m.createdAt).toLocaleString('de-DE') : 'unbekannt'}\n` +
                `Erstellt mit Version: ${m.appVersion || 'unbekannt'}\n` +
                `Enthaltene Logo-Dateien: ${(m.includedFiles || []).length}\n\n` +
                'Von deinem AKTUELLEN Stand wird vor der Wiederherstellung automatisch ' +
                'ein Sicherheitsbackup angelegt.\n\n' +
                'Wirklich fortfahren?'
            );
            if (!bestaetigt) return;

            const ergebnis = await window.api.backup.wiederherstellen(auswahl.pfad);
            const neustart = confirm(
                'Wiederherstellung erfolgreich!\n\n' +
                `Sicherheitsbackup des vorherigen Stands liegt unter:\n${ergebnis.sicherheitsBackupPfad}\n\n` +
                'Die Anwendung muss jetzt neu gestartet werden, damit alle Ansichten den ' +
                'wiederhergestellten Stand korrekt anzeigen. Jetzt neu starten?'
            );
            if (neustart) await window.api.app.neustart();
        } catch (err) {
            showFehler(err.message);
        }
    });

    await renderAutoBackupBereich(container.querySelector('#auto-backup-bereich'));

    container.querySelector('#btn-update-check').addEventListener('click', async (event) => {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = 'Suche...';
        try {
            const result = await window.api.app.checkForUpdates();
            if (result.status === 'available') {
                alert(`Update auf Version ${result.version} gefunden - wird im Hintergrund heruntergeladen. Du wirst benachrichtigt, sobald neu gestartet werden kann.`);
            } else if (result.status === 'not-available') {
                alert('Kein Update verfügbar - du verwendest bereits die neueste Version.');
            } else if (result.status === 'dev-mode') {
                alert('Im Entwicklungsmodus (npm start) ist keine Update-Prüfung möglich.');
            } else {
                showFehler(result.message || 'Update-Prüfung fehlgeschlagen.');
            }
        } catch (err) {
            showFehler(err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Jetzt nach Updates suchen';
        }
    });

    await renderLizenzBereich(container.querySelector('#lizenz-bereich'));
    await renderTextbausteineBereich(container.querySelector('#textbausteine-bereich'));
    await renderEmailVersandBereich(container.querySelector('#email-versand-bereich'));

    const passwortBereich = container.querySelector('#passwort-bereich');
    if (passwortGesetzt) {
        passwortBereich.appendChild(el(`
            <form class="formular" id="passwort-aendern-formular" style="max-width:400px;">
                <label>Aktuelles Passwort <input type="password" name="aktuell" required /></label>
                <label>Neues Passwort <input type="password" name="neu" required /></label>
                <label>Neues Passwort bestätigen <input type="password" name="neu2" required /></label>
                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">Passwort ändern</button>
                    <button type="button" class="btn btn-gefahr" id="btn-passwort-entfernen">Passwortschutz entfernen</button>
                </div>
            </form>
        `));

        passwortBereich.querySelector('#passwort-aendern-formular').addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.target;
            if (form.neu.value !== form.neu2.value) {
                showFehler('Die neuen Passwörter stimmen nicht überein.');
                return;
            }
            try {
                const ok = await window.api.settings.verifyPassword(form.aktuell.value);
                if (!ok) { showFehler('Aktuelles Passwort ist falsch.'); return; }
                await window.api.settings.setPassword(form.neu.value);
                alert('Passwort wurde geändert.');
                renderEinstellungen(container);
            } catch (err) {
                showFehler(err.message);
            }
        });

        passwortBereich.querySelector('#btn-passwort-entfernen').addEventListener('click', async () => {
            const aktuell = prompt('Aktuelles Passwort zur Bestätigung eingeben:');
            if (aktuell === null) return;
            try {
                await window.api.settings.removePassword(aktuell);
                alert('Passwortschutz wurde entfernt.');
                renderEinstellungen(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    } else {
        passwortBereich.appendChild(el(`
            <form class="formular" id="passwort-setzen-formular" style="max-width:400px;">
                <label>Neues Passwort <input type="password" name="neu" required minlength="4" /></label>
                <label>Neues Passwort bestätigen <input type="password" name="neu2" required /></label>
                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">Passwortschutz aktivieren</button>
                </div>
            </form>
        `));

        passwortBereich.querySelector('#passwort-setzen-formular').addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.target;
            if (form.neu.value !== form.neu2.value) {
                showFehler('Die Passwörter stimmen nicht überein.');
                return;
            }
            try {
                await window.api.settings.setPassword(form.neu.value);
                alert('Passwortschutz wurde aktiviert.');
                renderEinstellungen(container);
            } catch (err) {
                showFehler(err.message);
            }
        });
    }
}

// Automatische Backups (siehe Auftrag Block 3, Punkt 7): Ein/Aus, Intervall,
// Zielverzeichnis, Anzahl zu behaltender Sicherungen (Rotation).
async function renderAutoBackupBereich(bereich) {
    const einstellungen = await window.api.backup.autoEinstellungenGet();

    bereich.innerHTML = '';
    bereich.appendChild(el(`
        <form class="formular" id="auto-backup-formular" style="max-width:480px;">
            <label style="flex-direction:row;align-items:center;gap:6px;">
                <input type="checkbox" name="aktiv" style="width:auto;" ${einstellungen.aktiv ? 'checked' : ''} />
                <span>Automatische Backups aktivieren</span>
            </label>
            <label>Intervall
                <select name="intervall">
                    <option value="taeglich" ${einstellungen.intervall === 'taeglich' ? 'selected' : ''}>Täglich</option>
                    <option value="woechentlich" ${einstellungen.intervall === 'woechentlich' ? 'selected' : ''}>Wöchentlich</option>
                </select>
            </label>
            <label>Backup-Verzeichnis
                <div style="display:flex;gap:8px;">
                    <input type="text" name="verzeichnisAnzeige" readonly value="${escapeHtml(einstellungen.verzeichnis || '(noch nicht gewählt)')}" style="flex:1;" />
                    <button type="button" class="btn btn-klein" id="btn-auto-backup-verzeichnis">Auswählen…</button>
                </div>
            </label>
            <label>Anzahl zu behaltender automatischer Backups
                <input type="number" name="anzahlBehalten" min="1" max="100" value="${einstellungen.anzahlBehalten}" style="max-width:100px;" />
            </label>
            <p style="font-size:12px;color:#98a2b3;">
                Läuft nur, wenn die App gestartet wird (kein Hintergrunddienst) - beim Start wird geprüft,
                ob das gewählte Intervall seit dem letzten automatischen Backup abgelaufen ist.
                ${einstellungen.letzterZeitpunkt ? `Letztes automatisches Backup: ${new Date(einstellungen.letzterZeitpunkt).toLocaleString('de-DE')}.` : 'Bisher noch kein automatisches Backup erstellt.'}
            </p>
            <div class="formular-aktionen">
                <button type="submit" class="btn btn-primary">Speichern</button>
            </div>
        </form>
    `));

    let gewaehltesVerzeichnis = einstellungen.verzeichnis;

    bereich.querySelector('#btn-auto-backup-verzeichnis').addEventListener('click', async () => {
        const pfad = await window.api.backup.autoVerzeichnisWaehlen();
        if (!pfad) return;
        gewaehltesVerzeichnis = pfad;
        bereich.querySelector('[name="verzeichnisAnzeige"]').value = pfad;
    });

    bereich.querySelector('#auto-backup-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        try {
            await window.api.backup.autoEinstellungenSave({
                aktiv: form.aktiv.checked,
                intervall: form.intervall.value,
                verzeichnis: gewaehltesVerzeichnis,
                anzahlBehalten: form.anzahlBehalten.value
            });
            alert('Einstellungen für automatische Backups wurden gespeichert.');
            renderAutoBackupBereich(bereich);
        } catch (err) {
            showFehler(err.message);
        }
    });
}

async function renderTextbausteineBereich(bereich) {
    const textBausteine = await window.api.textBausteine.list();

    bereich.innerHTML = '';
    bereich.appendChild(el(`
        <div>
            <table class="tabelle">
                <thead><tr><th>Titel</th><th>Inhalt</th><th></th></tr></thead>
                <tbody id="textbausteine-tabelle-body"></tbody>
            </table>
            <div id="textbaustein-formular-bereich"></div>
            <button type="button" class="btn btn-klein" id="btn-neuer-textbaustein" style="margin-top:10px;">+ Neuer Textbaustein</button>
        </div>
    `));

    const tbody = bereich.querySelector('#textbausteine-tabelle-body');
    for (const t of textBausteine) {
        tbody.appendChild(el(`
            <tr>
                <td>${escapeHtml(t.titel)}</td>
                <td>${escapeHtml(t.inhalt.length > 80 ? t.inhalt.slice(0, 80) + '…' : t.inhalt)}</td>
                <td>
                    <button type="button" class="btn btn-klein" data-edit="${escapeHtml(t.schluessel)}">Bearbeiten</button>
                    <button type="button" class="btn btn-klein btn-gefahr" data-delete="${escapeHtml(t.schluessel)}">Löschen</button>
                </td>
            </tr>
        `));
    }

    tbody.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const t = textBausteine.find((x) => x.schluessel === btn.dataset.edit);
            zeigeTextbausteinFormular(bereich, t);
        });
    });

    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Diesen Textbaustein wirklich löschen?')) return;
            try {
                await window.api.textBausteine.remove(btn.dataset.delete);
                renderTextbausteineBereich(bereich);
            } catch (err) {
                showFehler(err.message);
            }
        });
    });

    bereich.querySelector('#btn-neuer-textbaustein').addEventListener('click', () => zeigeTextbausteinFormular(bereich, null));
}

function zeigeTextbausteinFormular(bereich, textBaustein) {
    const formularBereich = bereich.querySelector('#textbaustein-formular-bereich');
    formularBereich.innerHTML = '';
    formularBereich.appendChild(el(`
        <form class="formular" id="textbaustein-formular" style="max-width:520px;">
            <h3>${textBaustein ? 'Textbaustein bearbeiten' : 'Neuer Textbaustein'}</h3>
            <label>Titel <input name="titel" value="${escapeHtml(textBaustein ? textBaustein.titel : '')}" required /></label>
            <label>Inhalt <textarea name="inhalt" rows="4" required>${escapeHtml(textBaustein ? textBaustein.inhalt : '')}</textarea></label>
            <div class="formular-aktionen">
                <button type="submit" class="btn btn-primary">Speichern</button>
                <button type="button" class="btn" id="btn-textbaustein-abbrechen">Abbrechen</button>
            </div>
        </form>
    `));

    formularBereich.querySelector('#btn-textbaustein-abbrechen').addEventListener('click', () => { formularBereich.innerHTML = ''; });

    formularBereich.querySelector('#textbaustein-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        try {
            if (textBaustein) {
                await window.api.textBausteine.update(textBaustein.schluessel, data);
            } else {
                await window.api.textBausteine.create(data);
            }
            renderTextbausteineBereich(bereich);
        } catch (err) {
            showFehler(err.message);
        }
    });
}

// E-Mail-Versand: SMTP-Zugangsdaten + frei editierbarer Vorlagentext, einmal
// zentral für die ganze App (siehe Auftrag "E-Mail-Versand im
// Rechnungstool") - genutzt vom "Per E-Mail senden"-Knopf bei Rechnungen.
async function renderEmailVersandBereich(bereich) {
    const { smtp, emailText, platzhalter } = await window.api.emailVersand.get();

    bereich.innerHTML = '';
    bereich.appendChild(el(`
        <div>
            <form class="formular" id="email-versand-formular" style="max-width:480px;">
                <label>SMTP-Server <input name="host" value="${escapeHtml(smtp.host)}" placeholder="z.B. smtp.strato.de" /></label>
                <label>Port <input name="port" value="${escapeHtml(smtp.port)}" placeholder="587" /></label>
                <label>Verschlüsselung
                    <select name="verschluesselung">
                        <option value="tls" ${smtp.verschluesselung === 'tls' ? 'selected' : ''}>STARTTLS (meist Port 587)</option>
                        <option value="ssl" ${smtp.verschluesselung === 'ssl' ? 'selected' : ''}>SSL/TLS (meist Port 465)</option>
                        <option value="keine" ${smtp.verschluesselung === 'keine' ? 'selected' : ''}>Keine</option>
                    </select>
                </label>
                <label>Benutzername <input name="benutzer" value="${escapeHtml(smtp.benutzer)}" /></label>
                <label>Passwort
                    <input type="password" name="passwort" placeholder="${smtp.passwortGespeichert ? '•••••••• (hinterlegt - leer lassen, um es beizubehalten)' : ''}" />
                </label>
                ${smtp.passwortGespeichert ? `
                <label style="flex-direction:row;align-items:center;gap:6px;">
                    <input type="checkbox" name="passwortLoeschen" style="width:auto;" />
                    <span>Gespeichertes Passwort entfernen</span>
                </label>` : ''}
                <label>Standard-Absenderadresse <input name="absenderEmail" value="${escapeHtml(smtp.absenderEmail)}" placeholder="rechnung@beispiel.de" /></label>
                <label>E-Mail-Text
                    <textarea name="emailText" rows="8">${escapeHtml(emailText)}</textarea>
                </label>
                <p style="font-size:12px;color:#98a2b3;">Verfügbare Platzhalter: ${platzhalter.map((p) => `{${p}}`).join(', ')}</p>
                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">Speichern</button>
                </div>
            </form>

            <div style="margin-top:16px;max-width:480px;display:flex;gap:8px;align-items:flex-end;">
                <label style="flex:1;">Testmail an
                    <input type="email" id="testmail-empfaenger" placeholder="deine@email.de" />
                </label>
                <button type="button" class="btn" id="btn-testmail-senden">Testmail senden</button>
            </div>
        </div>
    `));

    bereich.querySelector('#email-versand-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        try {
            await window.api.emailVersand.save({
                smtp: {
                    host: form.host.value.trim(),
                    port: form.port.value.trim(),
                    verschluesselung: form.verschluesselung.value,
                    benutzer: form.benutzer.value.trim(),
                    passwort: form.passwort.value,
                    // Eindeutige, separate Aktion zum Entfernen (siehe Auftrag
                    // "SMTP-Sicherheit", Fall C) - wird ignoriert, sobald oben
                    // ein neues Passwort eingegeben wurde (das hat Vorrang).
                    passwortLoeschen: form.passwortLoeschen ? form.passwortLoeschen.checked : false,
                    absenderEmail: form.absenderEmail.value.trim()
                },
                emailText: form.emailText.value
            });
            alert('E-Mail-Einstellungen wurden gespeichert.');
            renderEmailVersandBereich(bereich);
        } catch (err) {
            showFehler(err.message);
        }
    });

    bereich.querySelector('#btn-testmail-senden').addEventListener('click', async () => {
        const btn = bereich.querySelector('#btn-testmail-senden');
        const empfaenger = bereich.querySelector('#testmail-empfaenger').value.trim();
        const aktuellerText = bereich.querySelector('[name="emailText"]').value;
        btn.disabled = true;
        btn.textContent = 'Sende...';
        try {
            const result = await window.api.emailVersand.testmail(empfaenger, aktuellerText);
            if (result.ok) {
                alert(`Testmail wurde an ${empfaenger} gesendet.`);
            } else {
                showFehler(`Testmail fehlgeschlagen: ${result.fehler}`);
            }
        } catch (err) {
            showFehler(err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Testmail senden';
        }
    });
}

// Produktschlüssel: Status anzeigen + jederzeit einlösbar (auch VOR Ablauf
// des Testzeitraums, siehe Auftrag "Schlüssel jederzeit eingeben können") -
// ergänzt die Sperre in lizenz-gate.js, die nur nach Ablauf erscheint.
async function renderLizenzBereich(bereich) {
    const status = await window.api.lizenz.status();

    bereich.innerHTML = '';
    if (status.grund === 'lizenziert') {
        bereich.appendChild(el(`
            <div>
                <p>Status: <strong style="color:#12794c;">freigeschaltet</strong></p>
            </div>
        `));
        return;
    }

    const statusText = status.grund === 'abgelaufen'
        ? 'Testzeitraum abgelaufen - Software ist gesperrt, bis ein gültiger Schlüssel eingegeben wird.'
        : `Testversion, Tag ${status.tageVergangen} von ${status.trialTage} (noch ${status.tageVerbleibend} Tag${status.tageVerbleibend === 1 ? '' : 'e'}).`;

    bereich.appendChild(el(`
        <div>
            <p>Status: <strong>${escapeHtml(statusText)}</strong></p>
            <form class="formular" id="lizenz-einloesen-formular" style="max-width:480px;">
                <label>Produktschlüssel (per E-Mail erhalten, komplett einfügen)
                    <textarea name="schluessel" rows="3" style="font-family:ui-monospace,monospace;font-size:12px;word-break:break-all;"></textarea>
                </label>
                <div class="formular-aktionen">
                    <button type="submit" class="btn btn-primary">Einlösen</button>
                </div>
            </form>
        </div>
    `));

    bereich.querySelector('#lizenz-einloesen-formular').addEventListener('submit', async (event) => {
        event.preventDefault();
        const schluessel = event.target.schluessel.value;
        try {
            const ok = await window.api.lizenz.einloesen(schluessel);
            if (ok) {
                alert('Schlüssel wurde erfolgreich eingelöst - die Software ist jetzt dauerhaft freigeschaltet.');
                renderLizenzBereich(bereich);
            } else {
                showFehler('Dieser Schlüssel ist ungültig.');
            }
        } catch (err) {
            showFehler(err.message);
        }
    });
}
