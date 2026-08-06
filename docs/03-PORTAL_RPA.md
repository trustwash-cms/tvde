# Portal RPA Sync — Via Verde / MyPRIO / Uber

Automatização de login + recolha de dados em portais **sem API pública**, com a mesma UX de “ligar conta” do Bolt.

Encriptação de credenciais (AES-256-GCM, reutilizar / esquecer): [`09-ENCRIPTION.MD`](./09-ENCRIPTION.MD).

O SMS/email OTP chega ao telemóvel do gestor; o código é colado no modal do dashboard (**human-in-the-loop**). Não lemos SMS automaticamente.

---

## Visão rápida

| Portal | Auth | Dados | Destino no TVDE |
|--------|------|-------|-----------------|
| **Via Verde** | email + password (sem OTP) | Export movimentos XLSX | Módulo Via Verde |
| **MyPRIO** | user numérico + password + **OTP SMS 6 dígitos** (~2 min) | Transações frota / carregamentos | Eletricidade **e** Combustível (1 conta) |
| **Uber** | telefone/email + password + (Arkose live se pedido) + OTP 4 dígitos | CSV pagamentos | Módulo Uber |

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
# Uber: só debug/admin (Chromium visível no servidor). Produção = false.
PORTAL_RPA_UBER_INTERACTIVE=false
# Uber Ligar conta: headed+Xvfb para Arkose pintar no modal Desafio Uber (não é INTERACTIVE).
PORTAL_RPA_UBER_HEADED_CONNECT=true
# DISPLAY=:1
```

Credenciais guardadas com a mesma chave AES já usada no projecto: `ENCRYPTION_KEY`.

Se a chave mudar, a password guardada deixa de desencriptar (`passwordNeedsResave`). A UI mostra mensagem em PT (não o raw `Unsupported state or unable to authenticate data`) e pede **Esquecer password** + **Ligar conta** de novo — ver [`09-ENCRIPTION.MD`](./09-ENCRIPTION.MD).

| Valor | Comportamento |
|-------|----------------|
| `PORTAL_RPA_MOCK=true` (default em **development**) | Ligar + OTP funcionam sem Chromium; **sync não descarrega** ficheiros reais |
| `PORTAL_RPA_MOCK=false` | Login/sync real; **exige** Chromium instalado |
| `PORTAL_RPA_UBER_HEADED_CONNECT=true` | Connect Uber headed + `ensureVirtualDisplay` (Arkose); sync continua a respeitar `PORTAL_RPA_HEADLESS` |
| `PORTAL_RPA_UBER_INTERACTIVE=true` | Debug: headed no login **e** sync; timeouts longos; **não** usar em produção para end-users |

### 2. Instalar Chromium (Playwright)

Na raiz do monorepo (ou em `apps/api`):

```bash
npm run playwright:install
```

Equivale a:

```bash
npx playwright install chromium
```

Os binários ficam em `~/Library/Caches/ms-playwright/` (macOS) ou `~/.cache/ms-playwright/` (Linux).

**Produção (Ubuntu mínimo):** além do browser, precisa das libs/fontes:

```bash
npm run playwright:libs   # → .playwright-libs (sem sudo); PM2 injeta LD_LIBRARY_PATH
```

A API no arranque faz **probe de launch** do Chromium e, se falhar, tenta auto-heal em user-space (`playwright install` / `playwright:libs`). O endpoint `/health` expõe `playwright.ready` / `playwright.detail`. O painel Conta Uber/Via Verde/MyPRIO usa `browserReady` (infra) separado do estado da conta (`lastError` de browser/libs é limpo quando o probe passa).

Se aparecer o erro:

> Executable doesn't exist … chromium_headless_shell …

corrija com `npm run playwright:install` (e `playwright:libs` no Linux) — a API também tenta sozinha no próximo restart.

### 3. Reiniciar API

Depois de instalar browsers ou alterar `PORTAL_RPA_*`, reinicie `npm run dev` / `dev:api`.

---

## Como usar no dashboard

Disponível para **superadmin** (Gestor de Frota) em:

- Via Verde → painel “Conta Via Verde”
- Eletricidade / Combustível → “Conta MyPRIO” (mesma ligação)
- Uber → “Conta Uber”

Fluxo:

1. **Ligar conta** — username/email + password (**AES-256-GCM** por tenant, `ENCRYPTION_KEY`). A password fica guardada para reutilização.
2. Se já há password guardada (`hasPassword`) → **Continuar com conta guardada** (sem voltar a digitar); MyPRIO/Uber podem pedir OTP SMS na mesma.
3. Se o portal pedir OTP → modal com input (timeout ~10 min no servidor)
4. **Uber Arkose** («Proteger a sua conta» / Iniciar desafio): modal **Desafio Uber** com stream JPEG do Chromium Playwright + cliques/arrasto (`authChallenge=bot`). Ligar conta usa Chromium **headed** + `DISPLAY`/Xvfb (`PORTAL_RPA_UBER_HEADED_CONNECT`) para o desafio pintar — headless costuma ter iframe sem UI. Não exige `PORTAL_RPA_UBER_INTERACTIVE` nem VNC. Depois o fluxo continua para SMS/OTP ou password.
5. Estado passa a **Ligado** → **Sincronizar** descarrega export e corre os parsers existentes
6. **Esquecer password** — remove só `passwordEncrypted` (mantém username + sessão). Distinto de Desligar.
7. **Desligar** apaga password **e** sessão Playwright do tenant
8. **Limpar** (ao lado de erros/avisos de sync) — remove `lastError` e a referência ao job falhado **sem** desligar a conta. Se o próximo sync falhar, o aviso volta até limpar de novo.

No sync de **Pagamentos** (`portal-quick-login-modal.tsx`): se o estado já for `awaiting_otp`, o modal abre **directamente no formulário OTP**. Se há password guardada e a sessão expirou, **Login** oferece **Continuar** sem pedir password de novo (com opção «Esquecer password» / «Introduzir outra»).

Estados: `Desligado` · `Ligado` · `OTP pendente` · `Sessão expirada` · `Erro`

Durante ligar / OTP / sync o UI mostra **loader** e faz poll do job até terminar.

---

## API

Prefixo: `/api/v1` (superadmin + tenant na sessão)

| Método | Path | Acção |
|--------|------|--------|
| GET | `/portal-connections` | Lista estado dos 3 portais (`hasPassword`, `usernameMasked`, …) |
| GET | `/portal-connections/:portal` | Detalhe (`via_verde` \| `myprio` \| `uber`) |
| POST | `/portal-connections/:portal/connect` | `{ username?, password?, useStoredCredentials? }` |
| POST | `/portal-connections/:portal/otp` | `{ code }` |
| POST | `/portal-connections/:portal/password` | Uber pós-OTP: `{ password }` (browser vivo) |
| GET | `/portal-connections/:portal/jobs/:jobId/live-frame` | JPEG base64 do Chromium vivo (Arkose / passkey) |
| POST | `/portal-connections/:portal/jobs/:jobId/live-input` | Clique/arrasto → `page.mouse` (coords da imagem) |
| POST | `/portal-connections/:portal/jobs/:jobId/cancel` | Cancela job + fecha browser vivo |
| POST | `/portal-connections/:portal/sync` | Dispara sync (`uberSync` / `syncScope` opcionais) |
| POST | `/portal-connections/:portal/reports` | Uber: listar relatórios Supplier (~45–60s) |
| POST | `/portal-connections/:portal/clear-messages` | Limpa `lastError` + job falhado persistente |
| POST | `/portal-connections/:portal/forget-password` | Remove só a password encriptada |
| DELETE | `/portal-connections/:portal` | Desliga (password + sessão) |

Jobs: `pending` → `running` → (`awaiting_otp`) → `completed` \| `failed`

Campo `resultJson.authChallenge`: `bot` \| `passkey` \| `otp` \| `password` \| `null` (exposto na UI como `authChallenge`).

### Contrato live-frame / live-input

**AuthZ (ambos):** tenant na sessão + `connection.activeJobId === jobId` + job do mesmo tenant não `completed`/`failed` + sessão viva em memória (`assertTenantOwnsLiveJob`). Caso contrário → 400 («Job não activo…» / «Browser vivo indisponível…»).

**GET `live-frame`** → `{ imageBase64, mimeType: 'image/jpeg', viewportWidth, viewportHeight, authChallenge, challengeVisible, capturedAt }`:

- JPEG viewport (quality ~52); fallback CDP se `page.screenshot` falhar
- `touchLiveOtpSession` em cada poll (prolonga TTL enquanto o gestor vê o stream)
- `challengeVisible`: `false` = iframe/sinal bot mas paint ainda não pronto (identidade por baixo)
- Ops Playwright serializadas por job (`withLivePageLock`) — evita hang screenshot vs nudge

**POST `live-input`** body:

```json
{
  "type": "click" | "mousedown" | "mouseup" | "mousemove" | "drag",
  "x": 0, "y": 0,
  "endX": 0, "endY": 0,
  "button": "left",
  "displayWidth": 800,
  "displayHeight": 450
}
```

Coords do elemento `<img>` no browser do gestor → escaladas para o viewport Playwright:

`pageX = (x / displayWidth) * viewport.width` (clamp 0…width−1).

Modal Uber (`uber-bot-challenge-modal.tsx`) usa sobretudo `mousedown` / `mousemove` / `mouseup` (arrasto), poll ~450 ms.

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
- OTP / desafios: browser **mantém-se aberto** em memória (`registerLiveOtpSession`) enquanto `awaiting_otp` — ver **Sessões vivas** abaixo
- Uber bot challenge: detalhe UX/diagnóstico em [`07-UBER.md` §13](./07-UBER.md#13-ligar-conta--fluxo-completo-arkose--otp--password)

Ficheiros principais:

- `apps/api/src/services/portal-rpa/*` (`types.ts` = sessões vivas + launch headed/Xvfb)
- `apps/api/src/workers/portal-session-refresh.worker.ts`
- `apps/api/src/routes/portal-connection.routes.ts`
- `apps/web/src/components/portal/portal-connection-panel.tsx`
- `apps/web/src/components/portal/uber-bot-challenge-modal.tsx`
- `packages/shared/src/portal-rpa.ts`
- `packages/shared/src/config.server.ts` (`portalRpaUberHeadedConnect`, …)
- Migration: `20260715120000_portal_rpa_sync`

Docs por portal: [`04-VIAVERDE.md`](./04-VIAVERDE.md) · [`05-PRIO.md`](./05-PRIO.md) · [`06-UBER.md`](./06-UBER.md) · [`07-UBER.md`](./07-UBER.md) (RPA Uber — login Arkose live + sync Relatórios)

**Timeouts sync:** Via Verde / MyPRIO ~55–90s · **Uber 15 min** (poll «Em curso» até ~12 min antes do download CSV).

---

## Sessões vivas (OTP / Arkose / passkey)

Enquanto o gestor resolve OTP, passkey ou Desafio Uber, o Chromium **não pode fechar**. Modelo em `apps/api/src/services/portal-rpa/types.ts`:

| Peça | Valor |
|------|--------|
| Map | `liveOtpSessions: Map<jobId, { browser, context, page, createdAt }>` |
| Registo | `registerLiveOtpSession(jobId, …)` após `awaiting_otp` / `awaiting_passkey` |
| TTL base | **12 min** desde `createdAt`; `getLiveOtpSession` expira e faz `dispose` |
| Touch | `touchLiveOtpSession` em live-frame / live-input / watcher — reinicia o relógio (desafio ~10 min) |
| Cap | **6** browsers vivos; se cheio → evict a sessão mais antiga |
| Dispose | `disposeLiveOtpSession` / `disposeAllLiveOtpSessions` (reload API / SIGTERM) |
| Lock | `withLivePageLock(jobId)` — serializa screenshot, mouse e nudges no mesmo page |

`withPlaywrightPage({ keepAlive: true })` deixa o browser aberto; o caller (`registerLiveOtpSession` + watcher / OTP) é responsável por fechar.

### Headed vs headless (VM)

| Cenário | Headless? | Notas |
|---------|-----------|--------|
| Sync / refresh gerais | `PORTAL_RPA_HEADLESS` (prod: `true`) | Sem UI no servidor |
| Uber **Ligar conta** com Arkose | headed se `UBER_HEADED_CONNECT` ou `UBER_INTERACTIVE` | `ensureVirtualDisplay()` → Xvfb / socket `:1` |
| Uber sync | headed só se `UBER_INTERACTIVE` | Produção: headless |
| Sem DISPLAY + headed pedido | fallback headless | Log aviso — Arkose pode não pintar |

Libs no Ubuntu mínimo: `npm run playwright:libs` → `.playwright-libs` (`LD_LIBRARY_PATH` + Fontconfig). PM2 (`ecosystem.config.js`) injeta `DISPLAY`, `XAUTHORITY`, `PORTAL_RPA_UBER_HEADED_CONNECT`, paths X11.

Detalhe Uber (Desafio Uber, flags, falhas): [`07-UBER.md` §13](./07-UBER.md#13-ligar-conta--fluxo-completo-arkose--otp--password).

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
| `Executable doesn't exist` / “Browser Playwright em falta” | Chromium não instalado ou apagado no deploy | Auto-heal no arranque da API; senão `npm run playwright:install` + restart. UI: `browserReady=false` (não misturar com estado da conta) |
| `error while loading shared libraries` / browser fecha | Libs/fontes em falta (ex. após `rsync --delete`) | Auto-heal `playwright:libs`; senão `npm run playwright:libs` + restart. `.playwright-libs` deve estar **excluído** do rsync delete |
| Painel ainda diz “browser em falta” | API sem restart / probe ainda a correr | Esperar log `[portal-rpa] playwright ready=…`; `/health` → `playwright.ready`; reload do painel limpa `lastError` de infra se Chromium OK |
| Sync diz “modo mock” | `PORTAL_RPA_MOCK=true` | `PORTAL_RPA_MOCK=false` + Chromium |
| Login falha / “sessão expirada” | Credenciais ou cookies inválidos; MyPRIO exige OTP de novo | Desligar → Ligar de novo (OTP se MyPRIO) |
| MyPRIO “Sessão expirada” de manhã | Cookies mortos; API pode ter estado parada à noite; refresh não consegue OTP | Ligar conta + SMS; em prod manter API 24/7 |
| Via Verde “Erro” após refresh nocturno | Falha de rede/DNS transitória (`ERR_NAME_NOT_RESOLVED`) | Esperar próximo tick (3h) ou reiniciar API; se persistir, Ligar conta |
| Lista importada só aparece após F5 | Bug antigo do poll (tratava `connected` a meio do sync) | Já corrigido — refresh da lista no fim do job |
| Export não encontrado | UI do portal mudou | Import manual XLSX/CSV; reportar selectores |
| CAPTCHA / Cloudflare (Via Verde / genérico) | Anti-bot | Import manual; não forçar |
| Uber Desafio: JPEG = email, sem puzzle | Headless / sem `DISPLAY` / Arkose sem paint | `PORTAL_RPA_UBER_HEADED_CONNECT=true` + `DISPLAY=:1` + XAUTHORITY; ver [`07-UBER.md` §13.7](./07-UBER.md#137-falhas-comuns-e-diagnóstico) |
| Live-frame «Browser vivo indisponível» | TTL, restart API, Chromium crash | Reiniciar API; Ligar conta outra vez; `playwright:libs` |
| «Missing X server» (headed) | Sem Xvfb/VNC ou sem `XAUTHORITY` | Contentor `tvde-rpa-vnc` / Xvfb; sync `.xauthority-vnc` |
| CORS no poll live-frame | `.env` com `localhost` vs acesso por IP | `CORS_ORIGIN` + `NEXT_PUBLIC_API_URL` = origem real; rebuild web |

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
