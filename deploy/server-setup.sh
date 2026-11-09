#!/bin/sh
# NAYA TIME – Ersteinrichtung auf dem Server. Wird über den Befehl naya-setup gestartet.
# Erzeugt alle Geheimschlüssel direkt auf dem Server (sie verlassen ihn nie), fragt die E-Mail-Daten ab,
# startet die App und gibt den Einrichtungslink für das Inhaber-Konto aus.
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "== NAYA TIME Ersteinrichtung =="
  printf "Adresse der App [zeit.naya-restaurant.de]: "; read DOMAIN; DOMAIN=${DOMAIN:-zeit.naya-restaurant.de}
  echo "E-Mail-Versand (Daten von Honds; leer lassen = später eintragen):"
  printf "  SMTP-Server: "; read SMTP_HOST
  printf "  SMTP-Port [587]: "; read SMTP_PORT; SMTP_PORT=${SMTP_PORT:-587}
  printf "  Benutzername [zeit@naya-restaurant.de]: "; read SMTP_USER; SMTP_USER=${SMTP_USER:-zeit@naya-restaurant.de}
  printf "  Kennwort (wird nicht angezeigt): "; stty -echo; read SMTP_PASS; stty echo; echo
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 24)
APP_SECRET=$(openssl rand -base64 48 | tr -d '\n')
PHOTO_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 32)
TERMINAL_ALLOWED_IPS=
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
MAIL_FROM="NAYA TIME <zeit@naya-restaurant.de>"
EOF
  echo "Schlüssel erzeugt und in /opt/naya-time/deploy/.env gespeichert (nur für root lesbar)."
  echo "WICHTIG: PHOTO_KEY sichern – ohne ihn sind gespeicherte Fotos nicht mehr lesbar:"
  grep '^PHOTO_KEY=' .env
fi

echo "== App wird gebaut und gestartet (dauert beim ersten Mal ca. 5 Minuten) =="
docker compose up -d --build
echo "Warte, bis die App bereit ist …"
until docker compose exec -T app node -e "fetch('http://localhost:3000/api/terminal/time').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; do sleep 5; done
docker compose exec -T app npx tsx scripts/seed.ts
echo
echo "== Inhaber-Konto =="
docker compose exec -T app npx tsx scripts/admin-setup.ts
echo
echo "Fertig. Den Link oben öffnen (gilt 24 Std.), Kennwort und Zwei-Faktor-Schutz einrichten."
