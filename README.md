# AP Rechnungstool

Desktop-Anwendung (Electron) für Rechnungserstellung und Adressverwaltung mit
mehreren Absenderprofilen (z. B. "Biohof Pösl", "Maschinengemeinschaft"). Läuft
als eigenständiges Windows-Programm ohne sichtbaren Browser.

## Funktionen

- Mehrere Absenderprofile mit eigenem Briefkopf/Logo, Bankverbindung, St.-Nr.
  und getrennt fortlaufender Rechnungsnummer (Format `R[JJ]-[laufende Nummer]`)
- Adressverwaltung mit automatischer Kundennummer (Format `K21`)
- Rechnungserstellung mit Positionen (Artikel-#, Bezeichnung, Menge, EP netto,
  MwSt 7 %/19 %, Gesamt) und automatischer Summenberechnung
- PDF-Export der Rechnung
- Zwei umschaltbare Textbausteine unter der Summenzeile (Geschäftsbedingungen,
  Kälber-Biokreis-Hinweis) – Inhalte sind Platzhalter und müssen vor dem
  produktiven Einsatz mit dem verbindlichen Text ersetzt werden
  (`src/main/schema.sql`, Tabelle `text_bausteine`)
- CSV-Import fürs Adressbuch, robust gegenüber Windows-1252-Fehlkodierungen
  (typisch bei Excel-Exporten)
- Alle Daten liegen dauerhaft außerhalb des Installationsordners (Windows
  AppData) und bleiben bei Neuinstallation/Update erhalten – siehe
  [Datenspeicherort](#datenspeicherort)
- Automatische Update-Prüfung beim Programmstart über `electron-updater` –
  siehe [Auto-Update](#auto-update)
- Artikel-Stammdaten mit Autofill (Artikel-Nr. in einer Position eingeben →
  Bezeichnung/Preis/MwSt werden übernommen), optional Warenbestand/Mindestmenge
- Weitere Belegarten mit eigenem, getrennt fortlaufendem Nummernkreis je
  Absenderprofil: Angebot, Auftragsbestätigung, Lieferschein (ohne Preise),
  Korrektur-Rechnung (mit optionalem Bezug zu einer Rechnung)
- Mahnung zu einer offenen Rechnung (referenziert die Rechnung, zeigt den
  offenen Betrag, freier Mahntext)
- Rechnungen als bezahlt markieren (inkl. abweichendem Zahlbetrag bei
  Skontoabzug) und Offene-Posten-Liste
- Notizen mit Priorität, Fälligkeitsdatum und optionaler Kundenzuordnung
- PLZ→Ort-Vorschlag beim Anlegen von Kunden – lernt selbstständig aus bereits
  erfassten Adressen (kein bundesweiter Datenbestand, siehe Hinweis unten)
- Vollständiges Backup (Datenbank + Firmenlogos + Manifest in einer Datei,
  `.apbackup`) an einen frei wählbaren Ort, geführte Wiederherstellung direkt
  aus der App (mit automatischem Sicherheitsbackup vor jedem Restore) sowie
  optionale automatische lokale Backups mit Rotation - siehe [Backup und
  Wiederherstellung](#backup-und-wiederherstellung)
- Optionaler Passwortschutz beim Programmstart (Einstellungen-Seite)
- Rechnung/Beleg/Mahnung direkt per E-Mail versenden (öffnet das
  Standard-Mailprogramm mit vorausgefülltem Betreff/Text; die PDF wird zum
  manuellen Anhängen im Explorer angezeigt, da `mailto:` keine Anhänge
  unterstützt)
- Absenderprofile vollständig frei anlegbar/bearbeitbar (Name, Logo,
  Bankverbindung, St.-Nr., MwSt-Sätze) – keine feste Anzahl, kein Hardcoding;
  Adressbuch ist dabei profilübergreifend ein gemeinsamer Kundenstamm
- Frei konfigurierbare MwSt-Sätze je Profil (Standard: 7 %, 7,8 %, 19 % –
  Letzterer als Pauschalierungssatz Land-/Forstwirtschaft §24 UStG vorbelegt),
  eigene Sätze anlegen/löschen in der Profilverwaltung, Auswahl per Dropdown
  beim Erstellen von Rechnungen/Belegen; Summenzeile weist jeden verwendeten
  Satz einzeln mit MwSt-Betrag in Euro aus
- Barbeleg (Kassenbeleg/Quittung für Barzahlungen) als weitere Belegart
- Freies Extrafeld für individuelle Informationen auf Rechnungen/Belegen
- Mehrere Textbausteine gleichzeitig anhakbar (statt nur einer) plus ein
  zusätzliches Feld für frei eingetippten Text – alle erscheinen auf dem PDF
- PDF-Vorschau vor dem Speichern (eigenes Fenster mit dem in Electron
  eingebauten PDF-Viewer) sowie ein direkter "Drucken"-Button, der den
  nativen Systemdruckdialog öffnet – kein externes PDF-Programm nötig

## Technik

- Electron (Hauptprozess: Node.js, Renderer: reines HTML/CSS/JS ohne Framework)
- SQLite über `better-sqlite3` (lokale Datei im Windows-Benutzerprofil)
- PDF-Erzeugung über `pdfkit`
- Paketierung als Windows-Installer über `electron-builder` (NSIS)
- Auto-Update über `electron-updater`

## Datenspeicherort

Kunden- und Rechnungsdaten (SQLite-Datenbank) sowie hochgeladene Profil-Logos
liegen **nicht** im Installationsordner, sondern im Benutzerprofil unter
`app.getPath('userData')`. Unter Windows entspricht das:

```
%APPDATA%\rechnung-adressbuch\
```

Dieser Ordner wird von einer Neuinstallation oder einem Update **nicht**
angerührt – der NSIS-Installer ist zusätzlich explizit mit
`deleteAppDataOnUninstall: false` konfiguriert (`package.json`), sodass auch
eine Deinstallation die Daten nicht löscht.

## Auto-Update

Die App prüft beim Start automatisch (nur im installierten/gepackten Zustand,
nicht bei `npm start`) über `electron-updater` auf neue Versionen, lädt sie im
Hintergrund herunter und fragt den Nutzer per Dialog, ob nach dem Download
neu gestartet werden soll, um die neue Version zu übernehmen – ein manueller
Installer-Download entfällt.

Damit das funktioniert, müssen Releases tatsächlich veröffentlicht werden.
Konfiguriert ist aktuell der GitHub-Provider (`package.json` → `build.publish`,
Repo `alexanderpoesl2003-dot/rechnung-adressbuch`).

**Repo-Sichtbarkeit:** Das Repository ist aktuell **öffentlich** (nicht aus
`package.json` ableitbar, sondern per anonymem GitHub-API-Aufruf ohne Token
bestätigt). Für einen öffentlichen Repo funktioniert `electron-updater` bei
Endkunden ohne jede Authentifizierung zuverlässig - genau der aktuelle Zustand.
Soll der Quellcode für den kommerziellen Verkauf später privat werden, würde
`electron-updater` bei Endkunden **ohne** eingebauten Token keine Releases mehr
laden können - einen GitHub-PAT dafür in die Kunden-App einzubauen wäre selbst
ein Secret-Leak (jede Installation enthielte dann ein Token mit Repo-Zugriff)
und wird deshalb hier bewusst NICHT gemacht. Empfohlene Lösung für diesen Fall
(noch nicht umgesetzt, da aktuell nicht nötig): ein zweites, **öffentliches**
Repo nur für Releases (z.B. `rechnung-adressbuch-releases`, ohne jeglichen
Quellcode) als `build.publish`-Ziel, während der eigentliche Quellcode privat
bleibt - `electron-builder --publish` unterstützt ein von `owner`+`repo` des
Quellcode-Repos unabhängiges Publish-Ziel problemlos.

### Neue Version veröffentlichen

```bash
# GH_TOKEN mit Schreibrechten NUR für das Release-Repository setzen - ein
# fein-granulares GitHub-PAT (Repository access: nur dieses eine Repo,
# Permissions: Contents -> Read and write) reicht und ist deutlich sicherer
# als ein klassisches PAT mit vollem "repo"-Scope. Nur in der Build-Shell
# setzen, NIE in package.json/Quellcode/README mit echtem Wert eintragen.
export GH_TOKEN=github_pat_xxx

npm version 0.6.0   # oder gewünschte neue Versionsnummer
npm run dist:mac -- --publish always   # macOS-Build (auf einem Mac)
npm run dist -- --publish always       # Windows-Build (Cross-Build von macOS möglich)
```

Das lädt Installer + `latest.yml`/`latest-mac.yml` als GitHub-Release hoch;
ältere Installationen finden dieses Release beim nächsten Start automatisch.
Ohne veröffentlichtes Release meldet die Update-Prüfung im Hintergrund
lediglich einen Fehler (kein Absturz) und die App läuft normal weiter.

**Vollständiger Release-Ablauf (Empfehlung):**

1. Versionsnummer erhöhen (`npm version x.y.z`)
2. Changelog/Commit-Historie seit letztem Release durchsehen
3. Tests ausführen (siehe jeweilige Test-Skripte der letzten Umsetzungsblöcke)
4. Windows-Build erzeugen (`npm run dist`)
5. Falls ein echtes Code-Signing-Zertifikat vorhanden ist: signieren (siehe
   Abschnitt "Code-Signing" unten) - sonst wird unsigniert gebaut
6. `GH_TOKEN` NUR in der aktuellen Build-Shell setzen (nicht dauerhaft in der
   Profildatei speichern, falls der Rechner von mehreren Personen genutzt wird)
7. `electron-builder --publish always` (bzw. `npm run dist -- --publish always`)
8. Release auf GitHub prüfen (Assets vollständig? `latest.yml` vorhanden?)
9. Update-Test: eine ältere installierte Version starten und prüfen, ob sie
   das neue Release findet und sauber aktualisiert

### Code-Signing (Windows) - vorbereitet, noch kein echtes Zertifikat

`electron-builder` erkennt die Standard-Umgebungsvariablen `CSC_LINK` (Pfad
oder Base64-Inhalt der `.pfx`-Zertifikatsdatei) und `CSC_KEY_PASSWORD`
(Zertifikat-Passwort) automatisch, sobald sie beim Build gesetzt sind - dafür
ist **keine** zusätzliche Konfiguration in `package.json` nötig, und es steht
dort bewusst **kein** Platzhalter-/Fake-Zertifikat drin. Sobald ein echtes
Code-Signing-Zertifikat vorhanden ist, reicht:

```bash
export CSC_LINK=/pfad/zum/zertifikat.pfx   # oder Base64-Inhalt der Datei
export CSC_KEY_PASSWORD=das-zertifikat-passwort
npm run dist -- --publish always
```

Ohne signiertes Zertifikat wird weiterhin unsigniert gebaut (aktueller
Zustand) - `publisherName`/`artifactName` in `package.json` sind bereits für
einen professionell benannten Installer vorbereitet, ersetzen aber keine
echte Signatur.

**SmartScreen:** Ohne Code-Signing zeigt Windows beim ersten Start immer
"Unbekannter Herausgeber". Mit einem echten Zertifikat wird der Herausgeber
korrekt angezeigt, SmartScreens Reputationsbewertung kann aber trotzdem eine
Weile brauchen, bis Warnungen ganz verschwinden (baut sich über Download-/
Ausführungszahlen auf) - das ist normales Verhalten, keine Fehlkonfiguration,
und es gibt keinen legitimen Weg, das technisch zu umgehen.

**macOS-Signing:** Aktuell nicht konfiguriert (kein Apple-Developer-Zertifikat
vorhanden) - macOS zeigt daher eine Gatekeeper-Warnung beim ersten Start
(Rechtsklick → Öffnen umgeht das). Da der Vertriebsfokus zunächst auf Windows
liegt, ist das als späterer, noch offener Punkt vorgemerkt.

## Entwicklung

Voraussetzung: Node.js LTS (getestet mit Node 22 – **nicht** die neueste
Node-Version verwenden, da `better-sqlite3` dafür ggf. noch keine
vorkompilierten Binärpakete bereitstellt und dann eine funktionierende
Kompilierumgebung/Xcode-Toolchain voraussetzt).

```bash
npm install
npm start
```

Die Anwendungsdaten (SQLite-Datenbank, hochgeladene Logos) liegen im
Benutzerprofil (`app.getPath('userData')`), nicht im Projektordner.

## Windows-.exe erstellen

```bash
npm run dist
```

Erzeugt einen NSIS-Installer unter `dist/`. Der Befehl führt automatisch
zwei Schritte aus:

1. **`prep:win-native`** – lädt für `better-sqlite3` (natives Modul, kann
   von macOS aus nicht für Windows kompiliert werden) das offizielle
   vorkompilierte Windows-x64-Binary für die verwendete Electron-Version
   separat herunter (nach `.native-cache/`, nicht Teil des normalen
   `node_modules`, damit `npm start` weiterhin mit dem macOS-nativen Binary
   läuft).
2. **`electron-builder --win`** – packt die App. Ein `afterPack`-Hook
   (`scripts/afterPack.js`) gleicht danach ab, dass alle production
   dependencies vollständig im Build enthalten sind (electron-builders
   eigener Abhängigkeits-Scanner übersieht bei manchen tief verschachtelten
   Paketen sonst einzelne Dateien), und ersetzt `better_sqlite3.node`
   explizit durch das in Schritt 1 geladene Windows-x64-Binary.

Cross-Building von macOS aus funktioniert damit vollständig lokal, ohne
Windows-Maschine. Für Codesignatur (aktuell nicht konfiguriert, SmartScreen
zeigt daher beim ersten Start eine Warnung) sowie für einen offiziellen
Release empfiehlt sich dennoch ein Build auf einer echten Windows-Maschine
oder in CI.

## Rechnungsstatus: Entwurf / Finalisiert

Eine neue Rechnung ist zunächst ein **Entwurf** (frei bearbeitbar/löschbar).
Über "Rechnung abschließen" wird sie **finalisiert**: Rechnungsnummer,
Positionen, Beträge und alle weiteren Inhalte sind danach serverseitig
(nicht nur in der Oberfläche) gegen Änderung und Löschung gesperrt - auch ein
direkter IPC-Aufruf kann das nicht umgehen. Zahlungsstatus bleibt davon
unberührt jederzeit änderbar. Korrekturen an einer finalisierten Rechnung
laufen über eine eigene Korrekturrechnung (Belegtyp "Korrektur-Rechnung"),
nicht durch Überschreiben des Originals.

## Backup und Wiederherstellung

**Format:** Ein Backup ist eine einzelne `.apbackup`-Datei (gzip-komprimiertes
JSON, keine echte ZIP-Bibliothek nötig) mit Datenbank, allen Firmenlogos und
einem Manifest (Version, Erstellungsdatum, App-Version, enthaltene Dateien).
Backups werden **ausschließlich lokal** gespeichert - kein Cloud-Upload, keine
Telemetrie. Der Inhalt ist unverschlüsselt (bewusste Entscheidung statt
selbstgebauter Kryptografie, siehe Abschlussbericht Block 3) - der Speicherort
sollte entsprechend sorgfältig gewählt werden, da Kunden-/Rechnungsdaten
enthalten sind.

**Wiederherstellung** (Einstellungen → "Backup wiederherstellen"): validiert
das gewählte Backup (Format, Datenbank-Integritätsprüfung, keine
Path-Traversal-Einträge), warnt deutlich, dass alle aktuellen Daten ersetzt
werden, legt **automatisch ein Sicherheitsbackup des aktuellen Stands** an,
bevor irgendetwas verändert wird, und rollt bei jedem Fehler während der
Wiederherstellung auf diesen vorherigen Stand zurück. Nach erfolgreicher
Wiederherstellung wird ein Neustart der App angeboten.

**Automatische Backups** (Einstellungen → "Automatische Backups"): optional,
täglich oder wöchentlich, in ein frei wählbares Verzeichnis, mit Rotation
(nur die letzten N Sicherungen werden behalten). Kein Hintergrunddienst/
Scheduler - die Prüfung "ist ein Backup fällig?" läuft einmal beim
Programmstart.

**Lizenzdaten im Backup:** Der eingelöste Produktschlüssel liegt in derselben
Einstellungen-Tabelle wie die Geschäftsdaten und wird daher automatisch mit
gesichert/wiederhergestellt. Da das Lizenzsystem keine Geräte-/
Hardwarebindung kennt, funktioniert ein wiederhergestellter Schlüssel auch
auf einem neuen Rechner ohne weiteres Zutun.

## Lizenzsystem

Offline-Produktschlüssel ohne Aktivierungsserver, 30-tägiger Testzeitraum.
Seit Version 0.6.0 Ed25519-signiert (Format `AP1.<Payload>.<Signatur>`,
siehe `src/main/services/lizenz-format.js`): Das separate Tool
`ap-lizenzverwaltung` besitzt den privaten Schlüssel und signiert neue
Lizenzen; dieses Rechnungstool enthält ausschließlich den öffentlichen
Schlüssel und kann Lizenzen nur prüfen, nicht selbst erzeugen. Schlüssel, die
vor dieser Umstellung mit dem alten HMAC-Verfahren ausgegeben wurden, werden
weiterhin erkannt (Übergangs-Kompatibilität), sofern die alte, nicht mehr
mitgelieferte Geheimnisdatei lokal vorhanden ist - siehe Abschlussbericht
Block 3 für Details zur Migration.

## Adressbuch-Import testen

`Kundendaten_extrahiert.csv` im Projektordner kann über den Button
"CSV importieren…" im Adressbuch als Testdatensatz eingelesen werden.

## Offene Punkte für den produktiven Einsatz

- Echten Text für die beiden Textbausteine hinterlegen (aktuell Platzhalter)
- App-Icon (`assets/icons/`) und Profil-Logos ergänzen
- Weitere Belegarten (Angebot, Lieferschein, ...) können aktuell nur gelöscht,
  nicht nachträglich bearbeitet werden (Rechnungen dagegen: Entwurf frei
  bearbeitbar, nach Abschluss gesperrt + Korrekturrechnung möglich, siehe
  [Rechnungsstatus](#rechnungsstatus-entwurf--finalisiert))
- Falls ein vollständiger bundesweiter PLZ→Ort-Datenbestand gewünscht ist
  (statt der aktuellen selbstlernenden Lösung): bewusst nicht eingebaut, um
  keine Postleitzahlen-Daten unklarer Lizenz/Aktualität mitzuliefern
- `dist/` enthält ggf. einen älteren Build-Stand vor den zuletzt ergänzten
  Funktionen – vor Weitergabe mit `npm run dist` neu erzeugen
