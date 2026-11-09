#!/usr/bin/env bash
# NAYA TIME – Installation/Update auf dem Server.
# Aufruf (als root):  curl -fsSL https://raw.githubusercontent.com/NAYA-Time/naya-time/main/install.sh | bash
set -euo pipefail

ZIEL=/opt/naya-time
REPO=https://github.com/NAYA-Time/naya-time.git

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte als root ausführen." >&2
  exit 1
fi

echo "==> Warte, bis die Grundeinrichtung des Servers fertig ist …"
cloud-init status --wait >/dev/null 2>&1 || true

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installiere Docker …"
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null 2>&1 || apt-get install -y git

if [ -d "$ZIEL/.git" ]; then
  echo "==> Hole die neueste Version …"
  git -C "$ZIEL" pull --ff-only
else
  echo "==> Lade NAYA TIME herunter …"
  mkdir -p "$ZIEL"
  if [ -n "$(ls -A "$ZIEL" 2>/dev/null)" ]; then
    git clone "$REPO" /tmp/naya-time-neu && cp -a /tmp/naya-time-neu/. "$ZIEL"/ && rm -rf /tmp/naya-time-neu
  else
    git clone "$REPO" "$ZIEL"
  fi
fi
cd "$ZIEL"

if [ ! -f .env ]; then
  echo
  echo "==> Ersteinrichtung"
  PW1=""; PW2="x"
  while [ "$PW1" != "$PW2" ] || [ ${#PW1} -lt 8 ]; do
    read -r -s -p "Neues Admin-Passwort für NAYA TIME (mind. 8 Zeichen): " PW1 </dev/tty; echo
    read -r -s -p "Passwort wiederholen: " PW2 </dev/tty; echo
    if [ "$PW1" != "$PW2" ]; then echo "Die Passwörter stimmen nicht überein."; fi
    if [ ${#PW1} -lt 8 ]; then echo "Bitte mindestens 8 Zeichen."; fi
    case "$PW1" in *\'*) echo "Bitte kein Hochkomma (') im Passwort verwenden."; PW2="x";; esac
  done
  cp .env.example .env
  chmod 600 .env
  # Werte sicher einsetzen (Passwort kann Sonderzeichen enthalten)
  python3 - "$PW1" "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" <<'PY'
import sys, re
pw, secret, schluessel = sys.argv[1:4]
p = '.env'
s = open(p).read()
def setze(s, k, v):
    return re.sub(rf'^{k}=.*$', lambda m: f'{k}={v}', s, flags=re.M)
# In einfachen Hochkommas, damit Docker Compose Zeichen wie $ nicht umdeutet
s = setze(s, 'ADMIN_PASSWORT', "'" + pw + "'")
s = setze(s, 'SESSION_SECRET', secret)
s = setze(s, 'TERMINAL_SCHLUESSEL', schluessel)
open(p, 'w').write(s)
PY
  unset PW1 PW2
fi

mkdir -p data
chown 1000:1000 data

echo "==> Starte NAYA TIME (der erste Start dauert ein paar Minuten) …"
docker compose up -d --build

DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2)
echo
echo "Fertig! NAYA TIME läuft."
echo "Verwaltung:  https://${DOMAIN}/admin"
echo "Den Freischalt-Link fürs iPad findest du dort unter Einstellungen."
