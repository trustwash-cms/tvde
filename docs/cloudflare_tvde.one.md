# Cloudflare + tvde.one — do zero ao HTTPS funcional

Guia step-by-step para expor a app TVDE (VM `192.168.10.75`) via **Cloudflare Tunnel**.


| Host público               | Serviço                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `https://fleet.tvde.one`   | Next.js (PM2 `tvde-web`) → `127.0.0.1:3003`                               |
| `https://api.tvde.one`     | Fastify (PM2 `tvde-api`) → `127.0.0.1:3002`                               |
| `https://tvde.one` / `www` | **Site institucional** (A → hosting antigo — **sem** redirect para fleet) |


Deploy da VM: `[deploy_tvde.one.md](./deploy_tvde.one.md)`.

---

## 0. Estado actual (2026-07-26) — já funcional


| Item                | Valor / estado                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Zona Cloudflare     | `tvde.one` (Active)                                                                                      |
| Túnel               | `tvde`                                                                                                   |
| Tunnel ID           | `db71ae8d-0ad4-4eba-995c-3bb9548e9eab`                                                                   |
| Credenciais         | `~/.cloudflared/db71ae8d-0ad4-4eba-995c-3bb9548e9eab.json`                                               |
| `config.yml`        | modo A (local ingress) — ver secção 5                                                                    |
| DNS `fleet` + `api` | CNAME → `db71ae8d-….cfargotunnel.com` (Proxied)                                                          |
| `.env` produção     | `CORS_ORIGIN` / `WEB_PUBLIC_URL` = `https://fleet.tvde.one`                                              |
|                     | `NEXT_PUBLIC_API_URL` = `https://api.tvde.one/api/v1`                                                    |
|                     | `NEXT_PUBLIC_MOLONI_REDIRECT_URI` = `https://api.tvde.one/api/v1/billing/moloni/callback`                |
| Web                 | rebuild feito (URL pública embutida no bundle)                                                           |
| Testes              | `https://api.tvde.one/health` → ok · `https://fleet.tvde.one/login` → 200                                |
| Site apex           | `tvde.one` intocado                                                                                      |
| **Pendência**       | `cloudflared` pode estar só em processo manual — **activar systemd** (secção 8) para sobreviver a reboot |


Verificação rápida:

```bash
curl -sS https://api.tvde.one/health
curl -sS -o /dev/null -w "%{http_code}\n" https://fleet.tvde.one/login
cloudflared tunnel info tvde
pgrep -a cloudflared
```

Se o Mac/browser der `ERR_NAME_NOT_RESOLVED` em `api.tvde.one` mas `fleet` abrir:

Causa típica: o DNS da LAN (`192.168.20.1`) ficou com **NXDOMAIN em cache** de quando o CNAME `api` ainda não existia. Autoridade Cloudflare / `1.1.1.1` / `8.8.8.8` já resolvem; o túnel e o `config.yml` estão correctos.

```bash
# Confirmar: público OK, router/LAN falha
dig +short api.tvde.one @1.1.1.1
dig api.tvde.one @192.168.20.1   # NXDOMAIN enquanto o cache negativo não expira

# No Mac (password sudo):
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder

# Workarounds imediatos: DNS Wi‑Fi → 1.1.1.1 / 8.8.8.8, ou reiniciar o router/DHCP DNS
# No browser: hard refresh / limpar cache DNS do browser
```

O CNAME já está provisionado (`cloudflared tunnel route dns --overwrite-dns tvde api.tvde.one` → already configured).

---

## 1. Arquitectura

```
Internet → Cloudflare (HTTPS) → Tunnel tvde → VM 192.168.10.75
                                      ├── 127.0.0.1:3003  fleet
                                      └── 127.0.0.1:3002  api

tvde.one / www  →  A 213.13.1.95 (site)  [não mexer]
```

**Modo usado:** A — config local (`config.yml` + DNS CNAME).  
**Não misturar** com modo B (token `cloudflared service install`) no mesmo túnel.


| Modo                      | Como corre                                             | Rotas                         |
| ------------------------- | ------------------------------------------------------ | ----------------------------- |
| **A — Local** (este guia) | `cloudflared … --config ~/.cloudflared/config.yml run` | `config.yml` + CNAME DNS      |
| **B — Token**             | `cloudflared service install <TOKEN>`                  | Public Hostnames no dashboard |


---

## 2. Lições aprendidas (erros a evitar)

1. `**cert.pem` de outra conta Cloudflare** → `tunnel create` / `route dns` criam recursos na conta errada; o dashboard da zona `tvde.one` mostra túnel **Down** / Routes **0** enquanto a VM fala com outro túnel.
  Solução: `cloudflared tunnel login` autorizando **a zona `tvde.one`** (mesma conta do DNS).
2. **Placeholder `<UUID>` no `config.yml`** → o serviço falha (`credentials file doesn't exist`).
3. **CNAME em falta** para `fleet`/`api` → erro **1033** / **530** mesmo com conector ligado.
4. **Apex redirect** → **não** redireccionar `tvde.one` para `fleet` (o site institucional fica no apex).
5. `**NEXT_PUBLIC_API_URL**` → exige **rebuild** do web depois de mudar o `.env`.

---

## 3. Pré-requisitos na VM

```bash
ssh -i ~/.ssh/id_ed25519_vps_cms macbusinesss@192.168.10.75

pm2 list
curl -sS http://127.0.0.1:3002/health
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3003/login
cloudflared --version
```

---

## 4. Login Cloudflare (conta da zona `tvde.one`)

```bash
# Se o cert for de outra conta:
mv ~/.cloudflared/cert.pem ~/.cloudflared/cert.pem.bak 2>/dev/null || true

cloudflared tunnel login
```

No browser: autorizar o domínio `**tvde.one**`. Fica `~/.cloudflared/cert.pem`.

---

## 5. Criar túnel + `config.yml`

```bash
cloudflared tunnel create tvde
cloudflared tunnel list
# anotar UUID — nesta instalação: db71ae8d-0ad4-4eba-995c-3bb9548e9eab
```

```bash
nano ~/.cloudflared/config.yml
```

```yaml
tunnel: db71ae8d-0ad4-4eba-995c-3bb9548e9eab
credentials-file: /home/macbusinesss/.cloudflared/db71ae8d-0ad4-4eba-995c-3bb9548e9eab.json

ingress:
  - hostname: fleet.tvde.one
    service: http://127.0.0.1:3003
  - hostname: api.tvde.one
    service: http://127.0.0.1:3002
  - service: http_status:404
```

```bash
chmod 600 ~/.cloudflared/config.yml
cloudflared tunnel ingress validate
```

---

## 6. DNS (`fleet` + `api`)

**Opção recomendada (CLI, com cert da zona certa):**

```bash
cloudflared tunnel route dns --overwrite-dns tvde fleet.tvde.one
cloudflared tunnel route dns --overwrite-dns tvde api.tvde.one
```

**Ou no dashboard:** DNS → Records → Add (Proxied):


| Type  | Name    | Content                                                 |
| ----- | ------- | ------------------------------------------------------- |
| CNAME | `fleet` | `db71ae8d-0ad4-4eba-995c-3bb9548e9eab.cfargotunnel.com` |
| CNAME | `api`   | `db71ae8d-0ad4-4eba-995c-3bb9548e9eab.cfargotunnel.com` |


Não alterar o `A` de `tvde.one` / `www`. O antigo `app.tvde.one` pode ficar (legado); a app nova é `**fleet**`.

---

## 7. Arrancar o conector

Teste manual:

```bash
cloudflared --no-autoupdate tunnel --config ~/.cloudflared/config.yml run
# noutro terminal:
curl -sS https://api.tvde.one/health
curl -sS -o /dev/null -w "%{http_code}\n" https://fleet.tvde.one/login
```

---

## 8. Serviço systemd (obrigatório para produção)

Sem isto, o túnel morre no logout/reboot se estiver só em `nohup`.

```bash
sudo tee /etc/systemd/system/cloudflared-tvde.service >/dev/null << 'EOF'
[Unit]
Description=Cloudflare Tunnel tvde
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=macbusinesss
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel --config /home/macbusinesss/.cloudflared/config.yml run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# se houver processo manual:
pkill -f 'cloudflared.*config.yml' || true

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-tvde.service
sudo systemctl status cloudflared-tvde.service
sudo journalctl -u cloudflared-tvde -f
```

Confirmar:

```bash
cloudflared tunnel info tvde
# CONNECTIONS / EDGE preenchidos
```

---

## 9. `.env` + rebuild web

Em `~/tvde/.env`:

```env
CORS_ORIGIN="https://fleet.tvde.one"
WEB_PUBLIC_URL="https://fleet.tvde.one"
NEXT_PUBLIC_API_URL="https://api.tvde.one/api/v1"
NEXT_PUBLIC_API_PUBLIC_URL="https://api.tvde.one/api/v1"
NEXT_PUBLIC_MOLONI_REDIRECT_URI="https://api.tvde.one/api/v1/billing/moloni/callback"
API_PUBLIC_URL="https://api.tvde.one/api/v1"
```

```bash
cd ~/tvde
npm run build -w @tvde/web   # obrigatório: NEXT_PUBLIC_* é embutido no build
pm2 restart tvde-api tvde-web
```

Estado nesta VM: **já aplicado** (2026-07-26).

### Moloni OAuth (callback na API)

O redirect URI OAuth **tem de ser a API** (`api.tvde.one`), não o dashboard (`fleet.tvde.one`).


| Onde                                       | Valor exacto                                          |
| ------------------------------------------ | ----------------------------------------------------- |
| Moloni Developer → URI de Resposta         | `https://api.tvde.one/api/v1/billing/moloni/callback` |
| Dashboard → Config → Moloni → Redirect URI | o mesmo                                               |
| `billing_connections.redirect_uri`         | o mesmo (gravado ao Guardar)                          |


Verificação: `curl -sS -o /dev/null -w "%{http_code}\n" "https://api.tvde.one/api/v1/billing/moloni/callback"` → `302`/`400` OK; `404` = rota em falta.

**Não** use URLs ngrok antigas (ex. `*.ngrok-free.dev`) — o túnel local morre e o OAuth falha com `ERR_NGROK_3200`.

---

## 10. SSL/TLS (dashboard)

- **SSL/TLS → Overview:** Full  
- **Always Use HTTPS:** On

(Origem local HTTP em `127.0.0.1` é normal com Tunnel.)

---

## 11. Checklist de aceitação

- [x] Túnel `db71ae8d-…` na conta da zona `tvde.one`
- [x] CNAME `fleet` + `api` (Proxied)
- [x] `https://api.tvde.one/health` → `{"status":"ok",…}`
- [x] `https://fleet.tvde.one/login` → 200
- [x] `.env` + rebuild web com URLs públicas
- [ ] systemd `cloudflared-tvde` enabled (secção 8)
- [x] `https://tvde.one` sem redirect para fleet

---

## 12. Troubleshooting


| Sintoma                                        | Acção                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Dashboard túnel **Down** / UUID ≠ `db71ae8d-…` | Estás a ver túnel antigo ou outra conta — refresca / confirma ID |
| **1033** / **530**                             | Conector parado, ou CNAME aponta para UUID errado                |
| `Couldn't resolve host api…` no Mac            | Flush DNS local; `dig @1.1.1.1 api.tvde.one`                     |
| Login ainda chama `192.168.10.75`              | Falta rebuild após mudar `NEXT_PUBLIC_API_URL`                   |
| CORS blocked                                   | `CORS_ORIGIN=https://fleet.tvde.one` + restart API               |
| Placeholder `<UUID>.json`                      | Corrigir `config.yml` com UUID real                              |


```bash
cloudflared tunnel list
cloudflared tunnel info tvde
cloudflared tunnel ingress rule https://fleet.tvde.one
dig +short fleet.tvde.one @1.1.1.1
dig +short api.tvde.one @1.1.1.1
```

---

## 13. Alternativa: modo B (token)

Só se quiseres abandonar o `config.yml`:

1. No túnel → Public Hostname: `fleet`→`:3003`, `api`→`:3002`
2. `sudo systemctl disable --now cloudflared-tvde`
3. `sudo cloudflared service install '<TOKEN>'`
4. Não uses `config.yml` em paralelo

---

## 14. Ordem rápida (recriar do zero)

1. `cloudflared tunnel login` (zona `tvde.one`)
2. `cloudflared tunnel create tvde`
3. Escrever `config.yml` (fleet→3003, api→3002)
4. `cloudflared tunnel route dns --overwrite-dns tvde fleet.tvde.one` (+ `api`)
5. systemd `cloudflared-tvde`
6. `.env` HTTPS + `npm run build -w @tvde/web` + `pm2 restart`
7. Testar health + login; confirmar apex intacto

---

*Actualizado 2026-07-26 — produção em `https://fleet.tvde.one` / `https://api.tvde.one`, túnel `db71ae8d-0ad4-4eba-995c-3bb9548e9eab`.*