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
- Ein-Klick-Datensicherung der kompletten Datenbank an einen frei wählbaren Ort
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
Konfiguriert ist aktuell der GitHub-Provider (`package.json` →
`build.publish`, Repo `alexanderpoesl2003-dot/rechnung-adressbuch`). Um eine
neue Version auszurollen:

```bash
# GH_TOKEN mit "repo"-Rechten für das genannte Repository setzen
export GH_TOKEN=ghp_xxx
npm version 0.2.0   # oder gewünschte neue Versionsnummer
npm run dist -- --publish always
```

Das lädt Installer + `latest.yml` als GitHub-Release hoch; ältere Installationen
finden dieses Release beim nächsten Start automatisch. Ohne veröffentlichtes
Release meldet die Update-Prüfung im Hintergrund lediglich einen Fehler (kein
Absturz) und die App läuft normal weiter.

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

## Adressbuch-Import testen

`Kundendaten_extrahiert.csv` im Projektordner kann über den Button
"CSV importieren…" im Adressbuch als Testdatensatz eingelesen werden.

## Offene Punkte für den produktiven Einsatz

- Echten Text für die beiden Textbausteine hinterlegen (aktuell Platzhalter)
- App-Icon (`assets/icons/`) und Profil-Logos ergänzen
- Rechnungen bearbeiten/stornieren (aktuell nur Anlegen + Status "versendet"
  nach PDF-Export)
- Falls ein vollständiger bundesweiter PLZ→Ort-Datenbestand gewünscht ist
  (statt der aktuellen selbstlernenden Lösung): bewusst nicht eingebaut, um
  keine Postleitzahlen-Daten unklarer Lizenz/Aktualität mitzuliefern
- `dist/` enthält ggf. einen älteren Build-Stand vor den zuletzt ergänzten
  Funktionen – vor Weitergabe mit `npm run dist` neu erzeugen
