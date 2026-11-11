#!/bin/sh
# NAYA TIME aktualisieren – mit Sicherung der Datenbank unmittelbar davor.
# Aufruf auf dem Server:   sh /opt/naya-time/deploy/update.sh /root/naya-time-update.bundle
# (ohne Angabe einer Datei wird nur neu gebaut und gestartet)
set -e
cd /opt/naya-time
BUNDLE="$1"
STAMP=$(date +%Y-%m-%d_%H%M)
BACKUP_DIR=/opt/naya-time-backups
DUMP="$BACKUP_DIR/vor-update_$STAMP.dump"
mkdir -p "$BACKUP_DIR"

echo "1/4 Sicherung der Datenbank vor dem Update ..."
( cd deploy && docker compose exec -T db pg_dump -U naya -Fc naya_time ) > "$DUMP"
if [ ! -s "$DUMP" ]; then
  echo "FEHLER, die Sicherung ist leer. Update abgebrochen, nichts wurde geändert."
  exit 1
fi
echo "    gespeichert in $DUMP"
echo "    bisheriger Stand $(git rev-parse --short HEAD)" | tee "$BACKUP_DIR/vor-update_$STAMP.txt"

if [ -n "$BUNDLE" ]; then
  echo "2/4 Neuen Programmstand einlesen ..."
  git config --global --add safe.directory /opt/naya-time
  git fetch "$BUNDLE" main
  git reset --hard FETCH_HEAD
else
  echo "2/4 Kein Update-Paket angegeben, Programmstand bleibt $(git rev-parse --short HEAD)"
fi

echo "3/4 Neue Version bauen (die laufende Version bleibt solange in Betrieb, dauert einige Minuten) ..."
cd deploy
docker compose build app

echo "4/4 Neue Version starten ..."
docker compose up -d
sleep 20
docker compose ps
echo "Fertig. Jetzt läuft Stand $(git -C /opt/naya-time rev-parse --short HEAD)."
echo "Die Sicherung von vor dem Update liegt in $BACKUP_DIR und wird nicht automatisch gelöscht."
