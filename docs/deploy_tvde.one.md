# Deploy TVDE — VM `tvde` (192.168.10.75) → tvde.one

Guia step-by-step do deploy feito na VM clone (`hostname: tvde`, IP LAN **192.168.10.75**).  
HTTPS público: [`cloudflare_tvde.one.md`](./cloudflare_tvde.one.md) (`fleet` + `api`).

**Última actualização:** 26 Julho 2026

---

## 0. Contexto

| Item | Valor |
|------|--------|
| VM | `192.168.10.75` · hostname `tvde` |
| SSH (Mac) | `ssh tvde-vm` (user `macbusinesss`, chave `~/.ssh/id_ed25519_vps_cms`) |
| App no servidor | `/home/macbusinesss/tvde` |
| CMS antigo | Arquivado em `~/cms.archived-YYYYMMDD-HHMM/` (não apagar já) |
| Stack | Node 20 · Docker (Postgres 16 + Redis 7) · PM2 · Playwright Chromium |
| Portas | Web **3003** · API **3002** · Postgres **5433** · Redis **6380** |
| Domínio | `tvde.one` — **ainda sem Cloudflare** (DNS antigo no projetox) |

> Sem `sudo` sem password nesta VM: `/opt/tvde` não foi possível; usámos `~/tvde`.  
> Parar o `cloudflared` do CRM clone exige `sudo` (ver passo 9).

---

## 1. Pré-requisitos (Mac)

```bash
# Rede LAN até à VM
ping -c 2 192.168.10.75

# SSH (já deve estar em ~/.ssh/config como Host tvde-vm)
ssh tvde-vm 'hostname; whoami'
```

Se ainda não existir no `~/.ssh/config`:

```
Host tvde-vm
  HostName 192.168.10.75
  User macbusinesss
  IdentityFile ~/.ssh/id_ed25519_vps_cms
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
```

---

## 2. Limpar o CMS do clone (só nesta VM)

O clone trazia Trustwash CRM (`/opt/cms`) + túnel `crm.trustwash.pt`. O CRM **real** fica noutra máquina — aqui remove-se.

```bash
ssh tvde-vm
```

```bash
# Parar app CMS
pm2 stop all || true
pm2 delete all || true
pm2 save --force || true

# Parar Postgres/Redis do CMS
cd /opt/cms
docker compose -f docker-compose.infra.yml down || true
docker compose down || true

# Arquivar conteúdo (owned pelo user; /opt/cms em si é root)
TS=$(date +%Y%m%d-%H%M)
mkdir -p "$HOME/cms.archived-$TS"
rsync -a /opt/cms/ "$HOME/cms.archived-$TS/cms/"
find /opt/cms -mindepth 1 -user macbusinesss -exec rm -rf {} + 2>/dev/null || true
rm -rf /opt/cms/* /opt/cms/.[!.]* 2>/dev/null || true

mkdir -p ~/tvde
```

**Sudo (obrigatório para o túnel CRM nesta VM):**

```bash
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared
# confirmar
pgrep -a cloudflared || echo "cloudflared parado"
```

---

## 3. Copiar o código (rsync a partir do Mac)

Do Mac, na raiz do monorepo local:

```bash
cd /Applications/XAMPP/xamppfiles/htdocs/tvde

rsync -az --delete \
  --exclude node_modules \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.tmp*' \
  --exclude '.git' \
  --exclude 'docs/ficheiros de exemplo' \
  --exclude '.env' \
  --exclude 'uploads' \
  --exclude '*.tsbuildinfo' \
  -e 'ssh -i ~/.ssh/id_ed25519_vps_cms -o BatchMode=yes' \
  ./ macbusinesss@192.168.10.75:~/tvde/
```

> Alternativa futura: `git clone git@github.com:trustwash-cms/tvde.git` na VM (precisa de deploy key GitHub).

---

## 4. `.env` de produção (LAN)

Na VM:

```bash
ssh tvde-vm
cd ~/tvde
nano .env   # ou gerar com openssl
chmod 600 .env
```

Valores essenciais (LAN até haver Cloudflare):

```env
DATABASE_URL="postgresql://tvde:tvde_secret@localhost:5433/tvde?schema=public"
REDIS_URL="redis://localhost:6380"

JWT_SECRET="<openssl rand -hex 32>"
ENCRYPTION_KEY="<openssl rand -hex 32>"
JWT_ACCESS_EXPIRES="8h"
JWT_REFRESH_EXPIRES="7d"

NODE_ENV=production
API_PORT=3002
API_HOST=0.0.0.0
API_PREFIX="/api/v1"
HEALTH_PATH="/health"
CORS_ORIGIN="http://192.168.10.75:3003"

WEB_PORT=3003
WEB_PUBLIC_URL="http://192.168.10.75:3003"
NEXT_PUBLIC_API_URL="http://192.168.10.75:3002/api/v1"
NEXT_PUBLIC_APP_NAME="Fleet CRM"
NEXT_PUBLIC_SHOW_DEMO_HINT="false"

PASSWORD_RESET_EXPIRES="1h"
RESET_EXPOSE_TOKEN="false"

SEED_MASTER_EMAIL="macbusinesss@me.com"
SEED_MASTER_PASSWORD="<password forte temporária>"

BILLING_SYNC_SECRET="<openssl rand -hex 24>"

# Após Cloudflare (ver docs/cloudflare_tvde.one.md), trocar para:
# CORS_ORIGIN / WEB_PUBLIC_URL = https://fleet.tvde.one
# NEXT_PUBLIC_API_URL / NEXT_PUBLIC_API_PUBLIC_URL / API_PUBLIC_URL = https://api.tvde.one/api/v1
# NEXT_PUBLIC_MOLONI_REDIRECT_URI = https://api.tvde.one/api/v1/billing/moloni/callback
# (e registar o mesmo URI no Moloni Developer → URI de Resposta)

PORTAL_RPA_ENABLED=true
PORTAL_RPA_REFRESH_INTERVAL_HOURS=3
PORTAL_RPA_MOCK=false
PORTAL_RPA_HEADLESS=true
PORTAL_RPA_UBER_INTERACTIVE=false
# Arkose / Desafio Uber: Chromium headed no Xvfb (não é INTERACTIVE — ver docs/07-UBER.md §13)
PORTAL_RPA_UBER_HEADED_CONNECT=true
DISPLAY=:1
# XAUTHORITY — cookie do contentor tvde-rpa-vnc ou Xvfb (ecosystem.config.js tenta candidatos)
```

`DATABASE_URL` deve bater certo com `docker-compose.yml` (`POSTGRES_USER` / `PASSWORD` / porta host `5433`).

**Uber Ligar conta + Arkose:** o gestor resolve o desafio no dashboard (stream JPEG), não via VNC. O `DISPLAY=:1` / `tvde-rpa-vnc` / `.playwright-libs` existem para o Chromium pintar no servidor. Detalhe: [`07-UBER.md` §13](./07-UBER.md#13-ligar-conta--fluxo-completo-arkose--otp--password) · plumbing: [`03-PORTAL_RPA.md`](./03-PORTAL_RPA.md#sessões-vivas-otp--arkose--passkey).

---

## 5. `ecosystem.config.js` (PM2)

Ficheiro em `~/tvde/ecosystem.config.js` (lê o `.env` do repo):

- `tvde-api` → `apps/api/dist/index.js`
- `tvde-web` → `apps/web/scripts/start.mjs`
- API env injectado: `DISPLAY` (default `:1`), `XAUTHORITY`, `PORTAL_RPA_UBER_HEADED_CONNECT`, `LD_LIBRARY_PATH` / Fontconfig de `.playwright-libs`, `TVDE_X11_ROOT` se existir

Logs em `~/tvde/logs/`.

---

## 6. Infra Docker + build + BD

```bash
cd ~/tvde

docker compose up -d
docker compose ps
# esperar healthy
docker exec tvde_postgres pg_isready -U tvde -d tvde

npm ci
npm run build
npm run db:migrate:deploy
npm run db:seed
npm run playwright:install
# Sem sudo: extrai libs/fontes para .playwright-libs (obrigatório no Ubuntu mínimo)
npm run playwright:libs
# Com sudo (preferível se disponível):
# sudo npx playwright install-deps chromium

mkdir -p uploads/branding uploads/calendar uploads/admin-mgmt logs
```

**Nota produção `@tvde/shared`:** o `package.json` do shared deve ter `require` → `./dist/*.js` (não `.ts`), senão o `node dist/index.js` da API falha com `ERR_MODULE_NOT_FOUND`.

**Playwright no Ubuntu:** `npm run playwright:install` só descarrega o browser. Sem libs de sistema (`libatk`, fonts, etc.) o Chromium aborta — Via Verde/Uber falham (Bolt API continua OK). Use `npm run playwright:libs` (sem root) ou `sudo npx playwright install-deps chromium`.

**Resiliência:** a API no arranque faz probe de **launch** do Chromium e tenta auto-heal (`playwright install` / `playwright:libs`) se falhar. `/health` devolve `playwright.ready`. Em redeploys, **exclua** `.playwright-libs` do `rsync --delete` (já no `scripts/deploy-uber-login-fix.sh`) e volte a correr `playwright:install` (+ `playwright:libs` se a pasta desapareceu). Erros de browser/libs **não** ficam a marcar a Conta Uber como partida para sempre — `lastError` de infra é limpo quando o probe passa; o painel usa `browserReady` à parte do estado da conta.

---

## 7. Arrancar com PM2

```bash
cd ~/tvde
pm2 start ecosystem.config.js
pm2 save --force
pm2 list
```

Health checks:

```bash
curl -sS http://127.0.0.1:3002/health
# → {"status":"ok",...}

curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3003/login
# → 200
```

**Arranque no reboot (sudo):**

```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u macbusinesss --hp /home/macbusinesss
# depois: pm2 save --force
```

---

## 8. Acesso (fase actual — LAN)

| Serviço | URL |
|---------|-----|
| Login / App | http://192.168.10.75:3003 |
| API health | http://192.168.10.75:3002/health |
| MASTER (seed) | email do `SEED_MASTER_EMAIL` + password do seed — **alterar já** |

SSH: `ssh tvde-vm`

---

## 9. Checklist pós-deploy

- [ ] `pm2 list` → `tvde-api` + `tvde-web` **online**
- [ ] `docker ps` → `tvde_postgres` + `tvde_redis` healthy
- [ ] Login MASTER funciona
- [ ] Meu Perfil + Alterar password funcionam (MASTER)
- [ ] `cloudflared` do CRM **parado** nesta VM (`sudo systemctl disable cloudflared`)
- [ ] PM2 startup systemd activo
- [ ] Backup de `JWT_SECRET` / `ENCRYPTION_KEY` (sem eles, sessões e credenciais encriptadas ficam ilegíveis)

---

## 10. Actualizar código (redeploy rápido)

No Mac:

```bash
# Preferível (inclui playwright:install + heal libs + health check):
bash scripts/deploy-uber-login-fix.sh

# Ou manual:
# 1) rsync com --exclude '.playwright-libs' (mesmo comando do passo 3)
# 2) na VM:
ssh tvde-vm 'cd ~/tvde && npm ci && npm run playwright:install && \
  (test -f .playwright-libs/usr/lib/x86_64-linux-gnu/libatk-1.0.so.0 || npm run playwright:libs) && \
  npm run build && npm run db:migrate:deploy && pm2 restart ecosystem.config.js --update-env'
```

Confirmar: `curl -sS http://127.0.0.1:3002/health` → `playwright.ready: true` e log `[portal-rpa] playwright ready=true`.

---

## 11. Cloudflare + tvde.one

Guia completo (estado actual + do zero):

→ **[`cloudflare_tvde.one.md`](./cloudflare_tvde.one.md)**

**Produção pública (2026-07-26):**

| Host | Destino |
|------|---------|
| `https://fleet.tvde.one` | Web (`:3003`) |
| `https://api.tvde.one` | API (`:3002`) |
| `https://tvde.one` | Site institucional (sem redirect) |

Túnel: `tvde` / `db71ae8d-0ad4-4eba-995c-3bb9548e9eab` · modo local `config.yml` · `.env` já com URLs HTTPS.

---

## 12. Comandos úteis

```bash
pm2 logs tvde-api
pm2 logs tvde-web
pm2 restart tvde-api tvde-web
docker compose -f ~/tvde/docker-compose.yml logs -f
```

---

## 13. Mapa de paths

| Path | Conteúdo |
|------|----------|
| `~/tvde` | Monorepo em produção |
| `~/tvde/.env` | Segredos (chmod 600) |
| `~/tvde/ecosystem.config.js` | PM2 |
| `~/tvde/logs/` | Logs API/Web |
| `~/tvde/uploads/` | Uploads |
| `~/cms.archived-*` | Backup do CMS do clone |
| `/opt/cms` | Pasta vazia residual (root) — pode remover com sudo mais tarde |

---

*Documento gerado após o primeiro deploy na VM 75 (2026-07-26).*
