#!/usr/bin/env bash
# NAYA TIME – Installation und Update auf dem Server (ein Befehl, als root):
#   curl -fsSL https://raw.githubusercontent.com/NAYA-Time/naya-time/main/deploy/install.sh | bash
# Erstes Mal: richtet alles ein (fragt nur nach den E-Mail-Daten). Danach: holt die neueste Version.
# Eine vorhandene Schnellversion (Express/SQLite) wird gestoppt und unter /opt/naya-time-alt-* aufbewahrt, nicht gelöscht.
set -euo pipefail
ZIEL=/opt/naya-time
REPO=https://github.com/NAYA-Time/naya-time.git
BRANCH=${NAYA_BRANCH:-main}
export GIT_TERMINAL_PROMPT=0  # nie nach GitHub-Zugangsdaten fragen

[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }
cloud-init status --wait >/dev/null 2>&1 || true

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installiere Docker …"
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null 2>&1 || { apt-get update -q && apt-get install -y -q git; }
command -v openssl >/dev/null 2>&1 || apt-get install -y -q openssl

# Firewall: nur SSH, HTTP, HTTPS
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null || true
fi

# Wenig Arbeitsspeicher: Auslagerungsdatei, damit der erste Bau nicht abbricht
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 3500 ] && ! swapon --show | grep -q .; then
  echo "==> Lege 2 GB Auslagerungsdatei an …"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Alte Schnellversion (ohne deploy/-Ordner) anhalten und aufbewahren
if [ -f "$ZIEL/docker-compose.yml" ] && [ ! -d "$ZIEL/deploy" ]; then
  ALT="$ZIEL-alt-$(date +%Y%m%d-%H%M)"
  echo "==> Halte die bisherige Schnellversion an und bewahre sie unter $ALT auf …"
  (cd "$ZIEL" && docker compose down) || true
  mv "$ZIEL" "$ALT"
fi

if [ -d "$ZIEL/.git" ]; then
  echo "==> Hole die neueste Version …"
  if ! { git -C "$ZIEL" fetch -q origin "$BRANCH" && git -C "$ZIEL" checkout -q "$BRANCH" && git -C "$ZIEL" pull -q --ff-only origin "$BRANCH"; }; then
    echo "!! GitHub nicht erreichbar oder Stand abweichend – nutze die bereits vorhandene Version in $ZIEL."
  fi
else
  echo "==> Lade NAYA TIME herunter …"
  git clone -q --branch "$BRANCH" "$REPO" "$ZIEL"
fi

cd "$ZIEL/deploy"
if [ ! -f .env ]; then
  sh ./server-setup.sh </dev/tty
else
  echo "==> Starte die neue Version (Daten bleiben erhalten) …"
  docker compose up -d --build
  docker image prune -f >/dev/null
  echo "Fertig. NAYA TIME ist aktuell: https://$(grep -E '^DOMAIN=' .env | cut -d= -f2)/admin"
fi
