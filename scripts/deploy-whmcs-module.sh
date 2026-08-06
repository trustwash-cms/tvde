#!/usr/bin/env bash
# Deploy WHMCS→Moloni module to production VM.
# Usage: bash scripts/deploy-whmcs-module.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${TVDE_DEPLOY_HOST:-192.168.10.75}"
USER="${TVDE_DEPLOY_USER:-macbusinesss}"
KEY="${TVDE_DEPLOY_KEY:-$HOME/.ssh/id_ed25519_vps_cms}"
REMOTE="${USER}@${HOST}:~/tvde"

echo "==> SSH check $HOST"
ssh -i "$KEY" -o ConnectTimeout=15 -o BatchMode=yes "$USER@$HOST" 'hostname'

echo "==> rsync (exclude .env)"
rsync -az --delete \
  --exclude .env \
  --exclude node_modules \
  --exclude .git \
  --exclude '.tmp*' \
  --exclude 'ecosystem.config.js_tmp' \
  --exclude 'apps/api/dist' \
  --exclude 'apps/web/.next' \
  --exclude 'apps/web/tsconfig.tsbuildinfo' \
  -e "ssh -i $KEY" \
  "$ROOT/" "$REMOTE/"

echo "==> build + migrate + pm2 on VM"
ssh -i "$KEY" "$USER@$HOST" 'bash -s' << 'REMOTE'
set -euo pipefail
cd ~/tvde
npm ci
npx prisma generate --schema packages/database/prisma/schema.prisma
npm run db:migrate:deploy
# ensure module registry has whmcs (idempotent upsert via seed modules only is heavy — insert if missing)
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.moduleRegistry.upsert({
  where: { key: 'whmcs' },
  update: { name: 'WHMCS', description: 'Faturação certificada Moloni a partir de faturas pagas no WHMCS' },
  create: { key: 'whmcs', name: 'WHMCS', description: 'Faturação certificada Moloni a partir de faturas pagas no WHMCS', isCore: false },
}).then(() => p.\$disconnect());
"
npm run build -w @tvde/shared
npm run build -w @tvde/billing
npm run build -w @tvde/api
npm run build -w @tvde/web
pm2 describe tvde-api >/dev/null 2>&1 && pm2 restart tvde-api tvde-web --update-env \
  || pm2 start ecosystem.config.js
pm2 save
curl -sS http://127.0.0.1:3002/health || true
echo
echo 'Deploy WHMCS module done. Active module whmcs no workspace + configure Settings → WHMCS.'
REMOTE

echo "==> OK"
