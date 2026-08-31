#!/usr/bin/env bash
# Deploy Uber login fix to VM 192.168.10.75 (run from Mac on the 192.168.10 LAN).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${TVDE_SSH_HOST:-macbusinesss@192.168.10.75}"
KEY="${TVDE_SSH_KEY:-$HOME/.ssh/id_ed25519_vps_cms}"

echo "==> rsync → $HOST:~/tvde"
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude .tmp-\* \
  --exclude 'apps/api/dist' \
  --exclude 'apps/web/.next' \
  --exclude '.playwright-libs' \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  "$ROOT/" "$HOST:~/tvde/"

echo "==> build api+web, Playwright heal, XAUTHORITY, restart"
ssh -i "$KEY" -o StrictHostKeyChecking=no "$HOST" 'set -e
  cd ~/tvde
  # Produção: headless + modal Desafio Uber (não bloquear no Chromium interactivo)
  if grep -q "^PORTAL_RPA_UBER_INTERACTIVE=true" .env 2>/dev/null; then
    echo "==== PORTAL_RPA_UBER_INTERACTIVE=true (debug — mantido) ===="
  elif grep -q "^PORTAL_RPA_UBER_INTERACTIVE=" .env 2>/dev/null; then
    sed -i "s/^PORTAL_RPA_UBER_INTERACTIVE=.*/PORTAL_RPA_UBER_INTERACTIVE=false/" .env
  else
    echo "PORTAL_RPA_UBER_INTERACTIVE=false" >> .env
  fi
  if ! grep -q "^PORTAL_RPA_UBER_HEADED_CONNECT=" .env 2>/dev/null; then
    echo "PORTAL_RPA_UBER_HEADED_CONNECT=true" >> .env
  fi
  if ! grep -q "^DISPLAY=" .env 2>/dev/null; then
    echo "DISPLAY=:1" >> .env
  fi
  # Cookie X11 do VNC (Chromium headed no DISPLAY=:1 partilhado)
  docker cp tvde-rpa-vnc:/headless/.Xauthority ~/tvde/.xauthority-vnc 2>/dev/null || true
  chmod 600 ~/tvde/.xauthority-vnc 2>/dev/null || true

  # rsync --delete pode apagar .playwright-libs se não estiver excluído; garantir browser + libs
  echo "==== playwright:install ===="
  npm run playwright:install
  if [ ! -f .playwright-libs/usr/lib/x86_64-linux-gnu/libatk-1.0.so.0 ]; then
    echo "==== playwright:libs (em falta) ===="
    npm run playwright:libs
  else
    echo "==== playwright:libs OK (já presente) ===="
  fi

  npm install --no-audit --no-fund
  npm run db:migrate:deploy
  npm run db:generate
  npm run build --workspace=@tvde/shared
  npm run build --workspace=apps/api
  npm run build --workspace=apps/web
  pm2 delete tvde-api 2>/dev/null || true
  pm2 delete tvde-web 2>/dev/null || true
  pm2 start ecosystem.config.js --update-env
  pm2 save
  echo "==== env check ===="
  grep -E "^(CORS_ORIGIN|WEB_PUBLIC_URL|NEXT_PUBLIC_API_URL|DISPLAY|PORTAL_RPA_UBER)" .env | sed "s/=.*/=***/" || true
  pm2 env 0 2>/dev/null | grep -E "DISPLAY|XAUTHORITY|PORTAL_RPA_LIBS|LD_LIBRARY" | head -10 || true
  sleep 4
  echo "==== health / playwright ===="
  curl -sS "http://127.0.0.1:3002/health" | head -c 800 || true
  echo
  pm2 logs tvde-api --lines 60 --nostream | grep -iE "uber|playwright|running|error|XAUTHORITY|headed|auto-heal" | tail -40
'
echo "==> done"
