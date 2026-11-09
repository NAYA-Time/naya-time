# NAYA TIME – Smart Workforce Management

Zeiterfassung und Personalmanagement für das Restaurant NAYA, Hamburg.
Architektur: siehe Claude-Dokument „NAYA TIME – Architektur (Phase 1)“.

## Stand
- Phase 1 Architektur, Phase 2 iPad-Terminal (`/terminal`), Phase 3 Backoffice (Mitarbeiter, Terminals, Dienstplan, Krankheit, Urlaub, Protokoll), Phase 4 Stundenkonten und Monatsabschluss, Phase 5 Aushilfenabrechnung, Phase 6 Excel-Berichte und E-Mail-Versand: fertig, mit automatischen Tests (`npm test`)
- Phase 7: Offline-Warteschlange am iPad, Zeitbuchungen korrigieren, vergessenes Ausstempeln, Fotoarchiv mit Löschfrist, 2FA-Wiederherstellungscodes: fertig und getestet
- Offen: Produktivbetrieb (8) – Hosting, Domain, SMTP, Cron-Aufrufe

## Regelmäßige Aufrufe (Cron)
Beide mit Kopfzeile `Authorization: Bearer <CRON_SECRET>`:
- `GET /api/cron/reports` – fällige Berichte verschicken (stündlich)
- `GET /api/cron/photos` – Fotos nach Ablauf der Löschfrist löschen (täglich)

## Offline-Betrieb des Terminals
Fällt das Netz aus, verschlüsselt das iPad die Buchung (inkl. PIN) mit dem öffentlichen Serverschlüssel und speichert sie lokal (IndexedDB).
Das iPad kann den Inhalt danach nicht mehr lesen. Sobald das Netz zurück ist, prüft der Server PIN und Reihenfolge und bucht.
Die Uhrzeit wird aus der letzten Serverzeit-Abfrage plus monotoner Gerätezeit rekonstruiert; ist das nicht sicher belegbar
(Uhr verstellt, Seite neu geladen, Sync zu alt), wird die Buchung trotzdem gespeichert, aber als „Zeit prüfen“ markiert.
Abgelehnte Offline-Buchungen (z. B. falscher PIN) erscheinen als Hinweis für die Leitung. Offline wird kein Foto gespeichert.

## Installation auf dem Server (Hetzner)
Als root auf dem Server (Ubuntu) ein Befehl – erstes Mal Einrichtung, danach Update:

```bash
curl -fsSL https://raw.githubusercontent.com/NAYA-Time/naya-time/main/deploy/install.sh | bash
```

Das Skript installiert Docker, erzeugt alle Geheimschlüssel auf dem Server, fragt nur nach den SMTP-Daten des Postfachs
zeit@naya-restaurant.de, startet App, Datenbank (PostgreSQL), HTTPS (Caddy, Let's Encrypt), Berichtsversand und tägliche
Datenbanksicherung und gibt den Einrichtungslink für das Inhaber-Konto aus. DNS: A-Record `zeit` → IPv4 des Servers.
Eine vorhandene frühere Schnellversion wird angehalten und unter `/opt/naya-time-alt-*` aufbewahrt.

## Lokal starten
Voraussetzungen: Node 22, PostgreSQL 16.

```bash
npm install
cp .env.example .env          # APP_SECRET und PHOTO_KEY setzen (siehe Kommentar in der Datei)
npx prisma migrate deploy
npm run db:seed               # Grunddaten (Abteilungen, Rollen, Rechte, Einstellungen)
npm run db:seed:demo          # optional: Test-Mitarbeiter, Dienstplan, Foto-Testfreigabe
npm run build && npm start    # http://localhost:3000/terminal
npm run pair                  # Kopplungscode für ein Terminal (15 Min. gültig)
```

Demo-PINs: Daniel 246810, Rafa 135790, Hiro 975310, Max 864200. Lena: Ersteinrichtung mit Code 4711.

## Tests
```bash
npm test     # Rechenlogik + Integrationstests gegen TEST_DATABASE_URL (Standard: naya_time_test)
```

## Sicherheit (Terminal)
- Nur gekoppelte Geräte dürfen stempeln (HttpOnly-Cookie, Hash in `terminal_devices`).
- Optional nur aus dem Restaurant-Netz: `TERMINAL_ALLOWED_IPS` (öffentliche IP des Anschlusses).
- PIN: scrypt-Hash, 6–8 Ziffern, keine trivialen PINs, letzte 5 gesperrt, Sperre nach 5/10/15 Fehlversuchen, Geräte-Limit.
- Zeit kommt immer vom Server. Doppelbuchungen per Idempotenz-Schlüssel und Sperre je Mitarbeiter verhindert.
- Fotos AES-256-GCM-verschlüsselt, nur aktiv mit Datenschutz-Freigabe (`data_protection_approvals`).
- Rohbuchungen, Korrekturen, Kontobuchungen und Audit-Log per DB-Trigger unveränderlich; Audit-Log mit Hash-Kette.
