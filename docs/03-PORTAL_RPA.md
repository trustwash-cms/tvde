# Portal RPA Sync — Via Verde / MyPRIO / Uber

Automatização de login + recolha de dados em portais **sem API pública**, com a mesma UX de “ligar conta” do Bolt.

O SMS/email OTP chega ao telemóvel do gestor; o código é colado no modal do dashboard (**human-in-the-loop**). Não lemos SMS automaticamente.

---

## Visão rápida

| Portal | Auth | Dados | Destino no TVDE |
|--------|------|-------|-----------------|
| **Via Verde** | email + password (sem OTP) | Export movimentos XLSX | Módulo Via Verde |
| **MyPRIO** | user numérico + password + **OTP SMS 6 dígitos** (~2 min) | Transações frota / carregamentos | Eletricidade **e** Combustível (1 conta) |
| **Uber** | telefone/email (+ password se pedida) + OTP | CSV pagamentos | Módulo Uber |

Import manual (XLSX/CSV) **mantém-se** como fallback.

---

## Pré-requisitos (obrigatório para sync real)

### 1. Variáveis no `.env`

```bash
PORTAL_RPA_ENABLED=true
PORTAL_RPA_MOCK=false
PORTAL_RPA_HEADLESS=true
# Renovar cookies / manter sessão (horas). Requer API sempre a correr.
PORTAL_RPA_REFRESH_INTERVAL_HOURS=3
```

Credenciais guardadas com a mesma chave AES já usada no projecto: `ENCRYPTION_KEY`.

| Valor | Comportamento |
|-------|----------------|
| `PORTAL_RPA_MOCK=true` (default em **development**) | Ligar + OTP funcionam sem Chromium; **sync não descarrega** ficheiros reais |
| `PORTAL_RPA_MOCK=false` | Login/sync real; **exige** Chromium instalado |

### 2. Instalar Chromium (Playwright)

Na raiz do monorepo (ou em `apps/api`):

```bash
npm run playwright:install
```

Equivale a:

```bash
npx playwright install chromium
```

Os binários ficam em `~/Library/Caches/ms-playwright/` (macOS).

Se aparecer o erro:

> Executable doesn't exist … chromium_headless_shell …

corrija exactamente com `npm run playwright:install` e **reinicie a API**.

### 3. Reiniciar API

Depois de instalar browsers ou alterar `PORTAL_RPA_*`, reinicie `npm run dev` / `dev:api`.

---

## Como usar no dashboard

Disponível para **superadmin** (Gestor de Frota) em:

- Via Verde → painel “Conta Via Verde”
- Eletricidade / Combustível → “Conta MyPRIO” (mesma ligação)
- Uber → “Conta Uber”

Fluxo:

1. **Ligar conta** — username/email + password (encriptados por tenant)
2. Se o portal pedir OTP → modal com input (timeout ~10 min no servidor)
3. Estado passa a **Ligado** → **Sincronizar** descarrega export e corre os parsers existentes
4. **Desligar** apaga credenciais + sessão do tenant
5. **Limpar** (ao lado de erros/avisos de sync) — remove `lastError` e a referência ao job falhado **sem** desligar a conta. Se o próximo sync falhar, o aviso volta até limpar de novo.

Estados: `Desligado` · `Ligado` · `OTP pendente` · `Sessão expirada` · `Erro`

Durante ligar / OTP / sync o UI mostra **loader** e faz poll do job até terminar.

---

## API

Prefixo: `/api/v1` (superadmin + tenant na sessão)

| Método | Path | Acção |
|--------|------|--------|
| GET | `/portal-connections` | Lista estado dos 3 portais |
| GET | `/portal-connections/:portal` | Detalhe (`via_verde` \| `myprio` \| `uber`) |
| POST | `/portal-connections/:portal/connect` | `{ username, password }` |
| POST | `/portal-connections/:portal/otp` | `{ code }` |
| POST | `/portal-connections/:portal/sync` | Dispara sync (`uberSync` / `syncScope` opcionais) |
| POST | `/portal-connections/:portal/reports` | Uber: listar relatórios Supplier (~45–60s) |
| POST | `/portal-connections/:portal/clear-messages` | Limpa `lastError` + job falhado persistente |
| DELETE | `/portal-connections/:portal` | Desliga |

Jobs: `pending` → `running` → (`awaiting_otp`) → `completed` \| `failed`

---

## Arquitectura

```
Dashboard (modal + poll)
    → Fastify (credenciais AES, PortalConnection / PortalSyncJob)
        → Worker Playwright (Chromium)
            → Portal externo (login / OTP / download)
                → ingest → parseViaVerdeRows / parseElectricityRows /
                           parseCombustivelRows / parseUberCsv
```

- Sessão: `storageState` Playwright encriptado em `portal_connections` — ver secção **Manter sessões activas** abaixo
- OTP: browser **mantém-se aberto** em memória enquanto `awaiting_otp` (não reabre a meio do fluxo)

Ficheiros principais:

- `apps/api/src/services/portal-rpa/*`
- `apps/api/src/workers/portal-session-refresh.worker.ts`
- `apps/api/src/routes/portal-connection.routes.ts`
- `apps/web/src/components/portal/portal-connection-panel.tsx`
- `packages/shared/src/portal-rpa.ts`
- `packages/shared/src/config.server.ts` (`portalRpaRefreshIntervalHours`)
- Migration: `20260715120000_portal_rpa_sync`

Docs por portal: [`04-VIAVERDE.md`](./04-VIAVERDE.md) · [`05-PRIO.md`](./05-PRIO.md) · [`06-UBER.md`](./06-UBER.md) · [`07-UBER.md`](./07-UBER.md) (RPA Uber detalhado — sync generate / Em curso / selectors DevTools)

**Timeouts sync:** Via Verde / MyPRIO ~55–90s · **Uber 15 min** (poll «Em curso» até ~12 min antes do download CSV).

---

## Manter sessões activas (keep-alive)

Objectivo: evitar que o gestor tenha de **Ligar conta** todos os dias.  
Limite realista: **semanas** com a API sempre ligada — **não** “15 dias garantidos sem qualquer intervenção” em portais com OTP SMS.

### Como funciona

```
API arranca
  → startPortalSessionRefreshWorker()
  → tick imediato + setInterval (PORTAL_RPA_REFRESH_INTERVAL_HOURS, default 3h)
      → clearStalePortalJobs
      → refreshAllPortalSessions
          → por cada PortalConnection elegível:
              cria PortalSyncJob type=refresh
              runPortalJob → adapter.refresh(cookies)
                  OK      → grava storageState renovado (cookies novos)
                  expired  → Via Verde: attemptSilentPortalRelogin
                            MyPRIO/Uber: status=expired (precisa OTP humano)
                  rede/DNS → job failed, status da conta NÃO muda (transitório)
```

| Peça | Ficheiro / campo |
|------|------------------|
| Worker | `apps/api/src/workers/portal-session-refresh.worker.ts` |
| Orquestração | `refreshAllPortalSessions` + job `type: 'refresh'` em `portal-connection.service.ts` |
| Persistência | `portal_connections.sessionStateEncrypted` (AES via `ENCRYPTION_KEY`) |
| Credenciais | `usernameEncrypted` + `passwordEncrypted` (re-login silencioso) |
| Intervalo | `PORTAL_RPA_REFRESH_INTERVAL_HOURS` → `env.portalRpaRefreshIntervalHours` |

### Quem é renovado em cada tick

| Critério | Incluído? |
|----------|-----------|
| `status=connected` + tem `sessionStateEncrypted` | Sim |
| `status=error` + tem sessão | Sim (recuperar após falha de sync/rede) |
| `status=expired` **Via Verde** + tem user/password | Sim (tenta re-login automático) |
| `status=expired` **MyPRIO / Uber** | Não — exige Ligar + OTP |
| `activeJobId` preenchido (connect/sync a meio) | Não (evita conflito) |
| `PORTAL_RPA_MOCK=true` ou RPA desactivado | Worker não corre refresh real |

### Comportamento por portal

| Portal | Refresh cookies | Re-login automático se expirar | Intervenção humana |
|--------|-----------------|--------------------------------|--------------------|
| **Via Verde** | Sim | **Sim** (email+password guardados) | Só se password mudar / CAPTCHA |
| **Uber** | Sim | **Não** (OTP SMS / passkey) | **Ligar conta** + OTP quando `expired` |
| **MyPRIO** | Sim (enquanto cookies vivos) | **Não** (OTP SMS obrigatório) | **Ligar conta** + código SMS quando `expired` |

Expectativa prática:

- **Via Verde**: pode ficar **Ligado** dias/semanas se a API estiver sempre up e a rede OK.
- **MyPRIO**: o refresh **atrasa** a expiração; quando o portal invalida a sessão, o estado passa a **Sessão expirada** e o gestor mete OTP outra vez. Não há forma fiável de “15 dias sem SMS” sem violar o 2FA deles.
- **API parada** (Mac desligado, `npm run dev` parado) = **sem refresh**. Cookies envelhecem no portal e na manhã seguinte pode aparecer `expired` / `error`.

### O que o refresh grava

Antes (bug): o job `refresh` só verificava `ok`/`expired` e **não** persistia cookies novos.  
Agora: em sucesso chama `captureStorageState(context)` e actualiza `sessionStateEncrypted` — o portal renova cookies na visita e o TVDE guarda-os.

Mensagens típicas em `PortalSyncJob` (`type=refresh`):

| `message` | Significado |
|-----------|-------------|
| `Sessão renovada` | Cookies OK + storageState actualizado |
| `Sessão renovada (re-login automático)` | Cookies mortos; login silencioso Via Verde OK |
| `Sessão expirada` | Cookies mortos; MyPRIO/Uber (ou re-login Via Verde falhou) |
| `page.goto: net::ERR_NAME_NOT_RESOLVED …` | Rede/DNS — **não** deve marcar a conta como partida de forma permanente (erro transitório no job; ligação mantém-se / recupera no próximo tick) |

### Erros transitórios vs sessão morta

| Tipo | Exemplos | Efeito na `PortalConnection` |
|------|----------|------------------------------|
| Rede / DNS | `ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION`, `ECONNRESET` | Job `failed`; **não** forçar `expired`; próximo refresh tenta de novo |
| Sessão inválida | Login page visível, `isSessionExpiredUi` | `status=expired` (+ re-login se Via Verde) |
| Timeout Playwright em **sync** | `Timeout Playwright (…s)` | Mantém `connected` (sync abortado ≠ conta partida) |

### UI após sync

O painel `portal-connection-panel.tsx` faz poll do job; no fim do sync (`completed`/`failed`) chama `onStatusChange` → a lista do módulo (Electric / Combustível / Via Verde) **recarrega sozinha**. Não depende de `status=connected` a meio do sync (isso causava refresh prematuro e lista stale).

### Produção / 15 dias

Checklist realista para manter sessões o máximo possível:

1. [ ] API (ou processo Node) **sempre a correr** (systemd / Docker / PM2 — não só `npm run dev` no laptop)
2. [ ] `PORTAL_RPA_ENABLED=true` · `PORTAL_RPA_MOCK=false`
3. [ ] `PORTAL_RPA_REFRESH_INTERVAL_HOURS=3` (ou `2` se quiseres mais agressivo; mínimo efectivo 1h)
4. [ ] Rede estável / DNS a resolver `www.viaverde.pt` e `www.myprio.com`
5. [ ] Via Verde: password estável → re-login automático cobre a maioria das expirações
6. [ ] MyPRIO: aceitar OTP ocasional; monitorizar estado `expired` no dashboard
7. [ ] Logs: `[portal-rpa] refresh de sessões activo (a cada Nh)` no arranque; `[portal-rpa] session refresh: […]` a cada tick

---

## Troubleshooting

| Sintoma | Causa provável | Fix |
|---------|----------------|-----|
| `Executable doesn't exist` / mensagem “Browser Playwright em falta” | Chromium não instalado **ou** erro antigo na BD | `npm run playwright:install` + **reiniciar a API** + clicar **Ligar conta** outra vez (o painel guardava o erro da tentativa anterior) |
| Painel ainda diz “browser em falta” depois do install | API sem restart / `lastError` stale | Reiniciar API; ao carregar o estado o TVDE limpa esse erro se o Chromium já existir |
| Sync diz “modo mock” | `PORTAL_RPA_MOCK=true` | `PORTAL_RPA_MOCK=false` + Chromium |
| Login falha / “sessão expirada” | Credenciais ou cookies inválidos; MyPRIO exige OTP de novo | Desligar → Ligar de novo (OTP se MyPRIO) |
| MyPRIO “Sessão expirada” de manhã | Cookies mortos; API pode ter estado parada à noite; refresh não consegue OTP | Ligar conta + SMS; em prod manter API 24/7 |
| Via Verde “Erro” após refresh nocturno | Falha de rede/DNS transitória (`ERR_NAME_NOT_RESOLVED`) | Esperar próximo tick (3h) ou reiniciar API; se persistir, Ligar conta |
| Lista importada só aparece após F5 | Bug antigo do poll (tratava `connected` a meio do sync) | Já corrigido — refresh da lista no fim do job |
| Export não encontrado | UI do portal mudou | Import manual XLSX/CSV; reportar selectores |
| CAPTCHA / Cloudflare | Anti-bot | Import manual; não forçar |

---

## Segurança e limites

- Só contas do **próprio** cliente; feature flag `PORTAL_RPA_ENABLED`
- Passwords e OTP **nunca** vão para logs
- Credenciais e `storageState` em AES (`ENCRYPTION_KEY`) por tenant
- RPA pode contrariar ToS dos portais — uso interno consciente
- Não automatizar login Google/Apple na Uber
- Não correr muitos syncs Playwright em paralelo no mesmo host (RAM)
- Re-login automático **não** contorna 2FA SMS (MyPRIO)

---

## Sync Via Verde (caminho Playwright)

Confirmado no portal (conta Empresas — CAMINHOS / frota):

1. Login (modal `#pnlLogin`)
2. Abrir **Extratos e Movimentos**  
   URL típica: `https://www.viaverde.pt/empresas/minha-via-verde/extratos-movimentos`  
   (também tenta Particulares)
3. Tab **Movimentos** (não Extratos)
4. Preferir **scrape HTML** da tabela; fallback **Exportar → Excel**
5. Ficheiro passa pelos mesmos parsers do import manual (`parseViaVerdeRows` → `importViaVerdeCsv`)
6. **Duplicados**: chave `tenantId` + `obu` (Identificador) — inserções repetidas são `skipped`

Detalhe completo: [`04-VIAVERDE.md`](./04-VIAVERDE.md).

### Popup «Ligar conta»

O modal fica aberto com loader enquanto o job corre no servidor. Fecha automaticamente quando o estado passa a **Ligado** (ou erro/OTP). Não é preciso fazer refresh da página.

---

## Checklist de arranque

1. [ ] `ENCRYPTION_KEY` definida
2. [ ] Migration `portal_rpa_sync` aplicada (`npm run db:migrate:deploy`)
3. [ ] `npm run playwright:install`
4. [ ] `.env`: `PORTAL_RPA_MOCK=false` · `PORTAL_RPA_REFRESH_INTERVAL_HOURS=3`
5. [ ] Reiniciar API (ver log `refresh de sessões activo`)
6. [ ] Via Verde / MyPRIO / Uber → Ligar conta → Sincronizar (ou import manual se UI mudar)
7. [ ] Em produção: processo API 24/7 para keep-alive efectivo
