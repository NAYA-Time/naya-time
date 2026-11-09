# NAYA TIME

Stempeluhr für Restaurant NAYA. Ein iPad dient als Terminal, die Verwaltung läuft im Browser. Ziel-Adresse: **https://zeit.naya-restaurant.de**

## Was die App kann

**Terminal (iPad, `/terminal`)**
- Mitarbeiter tippen auf ihren Namen, geben ihre PIN (4–6 Ziffern) ein und stempeln damit ein oder aus. Ob es Kommen oder Gehen ist, erkennt die App selbst.
- Bei jedem Stempeln wird mit der Frontkamera ein Foto gemacht. Ohne Foto ist kein Stempeln möglich.
- Nach 5 falschen PINs ist der Mitarbeiter für 5 Minuten gesperrt.
- Ausstempeln vergessen: Liegt das Einstempeln mehr als 16 Stunden zurück, gilt der nächste Stempel wieder als Kommen. Die offene Schicht wird im Admin rot markiert und muss dort nachgetragen werden.
- Das iPad muss einmalig über einen geheimen Link freigeschaltet werden. Ohne Freischaltung lässt sich das Terminal nicht öffnen.

**Verwaltung (`/admin`)**
- Mitarbeiter anlegen, umbenennen, eine neue PIN vergeben und deaktivieren.
- Alle Stempelungen eines Monats mit Foto ansehen. Vergessene Stempel nachtragen, falsche korrigieren oder löschen.
- Jede Änderung landet im Änderungsprotokoll.
- Monatsauswertung mit Stunden pro Tag, Wochensummen (KW) und Monatssumme.
- **Excel-Export** pro Monat: ein Übersichtsblatt plus ein Blatt pro Mitarbeiter mit Kommen, Gehen, Brutto, Pause und Netto. Die Zeiten sind echte Excel-Zeitwerte, man kann also direkt damit weiterrechnen.

**Regeln** (einstellbar in `.env`)
- Pausenabzug: 30 Minuten, wenn an einem Tag mehr als 6 Stunden gearbeitet wurde (`PAUSE_MINUTEN`, `PAUSE_AB_STUNDEN`). Steht `PAUSE_AB_STUNDEN` auf `0`, werden die 30 Minuten an jedem Arbeitstag abgezogen.
- Eine Schicht zählt zu dem Tag, an dem sie begonnen hat. Das gilt auch für Schichten über Mitternacht.
- Stempelfotos werden nach 90 Tagen automatisch gelöscht (`FOTO_AUFBEWAHRUNG_TAGE`). Die Zeiten selbst bleiben erhalten.

## Technik

Node.js 22 mit Express, SQLite (eingebaut in Node) und ExcelJS. Davor läuft Caddy, das automatisch ein HTTPS-Zertifikat holt. Alle Daten (Datenbank und Fotos) liegen im Ordner `data/`.

## Installation auf dem Hetzner-Server

Voraussetzung ist ein Hetzner-Cloud-Server mit Ubuntu 24.04. Der kleinste Typ reicht. Für die Sicherung im Hetzner-Menü **Backups** aktivieren.

```bash
# 1. Docker installieren
curl -fsSL https://get.docker.com | sh

# 2. Code holen
git clone https://github.com/NAYA-Time/naya-time.git /opt/naya-time
cd /opt/naya-time

# 3. Einstellungen anlegen
cp .env.example .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^TERMINAL_SCHLUESSEL=.*/TERMINAL_SCHLUESSEL=$(openssl rand -hex 24)/" .env
nano .env          # ADMIN_PASSWORT eintragen

# 4. Datenordner anlegen (die App läuft im Container als Benutzer 1000)
mkdir -p data && chown 1000:1000 data

# 5. Starten
docker compose up -d --build
```

Danach im DNS bei honds.de einen **A-Record** anlegen: Name `zeit`, Ziel ist die IPv4-Adresse des Servers. Sobald der Eintrag aktiv ist, holt Caddy das Zertifikat selbst.

**Update auf eine neue Version:** `cd /opt/naya-time && git pull && docker compose up -d --build`

## iPad einrichten

1. Unter `/admin` anmelden, **Einstellungen** öffnen und den Terminal-Link kopieren.
2. Den Link auf dem iPad in **Safari** öffnen und den Kamerazugriff erlauben.
3. **Teilen → Zum Home-Bildschirm** wählen. NAYA TIME startet dann wie eine App im Vollbild.
4. Empfohlen: Unter Einstellungen → Bedienungshilfen → **Geführter Zugriff** das iPad auf NAYA TIME festsetzen und Auto-Sperre auf „Nie“ stellen.

## Entwicklung

```bash
npm install
npm test
ADMIN_PASSWORT=test SESSION_SECRET=$(openssl rand -hex 32) TERMINAL_SCHLUESSEL=$(openssl rand -hex 16) npm run dev
# http://localhost:3000/admin
```

## Offen / nächste Schritte

- Abgleich mit dem Wochendienstplan (Soll und Ist). Die Details dazu sind noch zu klären.
- Optional: Monatsexport automatisch per E-Mail über zeit@naya-restaurant.de verschicken.
