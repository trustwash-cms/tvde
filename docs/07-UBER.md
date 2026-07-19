# 07 — Uber Supplier Portal RPA (login + sync)

Documento de **descoberta e implementação** do Portal RPA Uber, com base nos screen recordings e DevTools de **2026-07-17**:

- ~09:39 — login Breeze / passkey / OTP 4 dígitos / home (~81s)
- ~09:51 — Relatórios: Gerar → toast → poll **Criado em** (~100s)
- ~22:14 / 22:31 — fluxo manual correcto (tipo → intervalo → org → Gerar)
- ~22:27 — DevTools: selectors estáveis do painel (`report-management-v2`, `generate-report-button`, …)
- ~22:41 — org Filiais (checkbox)
- ~22:47–23:00 — **validado end-to-end**: generate → «Em curso» → download → ingest TVDE

Complementa:

| Doc | Papel |
|-----|--------|
| [`06-UBER.md`](./06-UBER.md) | Módulo TVDE (import CSV, UI, keep-alive resumo) |
| [`03-PORTAL_RPA.md`](./03-PORTAL_RPA.md) | Infra partilhada (jobs, OTP modal, refresh worker) |
| Legacy | `docs/ficheiros de exemplo/UBER_MODULE.md`, `AREA_UBER.md` |

**Objectivo:** fazer o mesmo padrão Via Verde / MyPRIO — **Ligar conta → OTP humano → sessão encriptada → Sincronizar** — mas o fluxo Uber é **mais hostil** (passkeys, pin OTP 4 dígitos, CSS ofuscado, domínio `supplier`).

---

## 1. Estado (2026-07-17 noite — **validado**)

| Capacidade | Estado | Notas |
|------------|--------|--------|
| Import manual CSV | **OK** | `uber-import.ts` · colunas uuid/nome/apelido/data/valor |
| Adapter Playwright | **OK** | Login + sync Relatórios (lista / gerar) |
| Login | **OK** | email → SMS → OTP 4 dígitos (modal TVDE) → palavra-passe → Supplier |
| Sync generate | **OK** | Tipo payments → período → org Filiais → Gerar → poll **Em curso** → download |
| Sync existing | **OK** | Modal: «Descarregar seleccionado» por nome |
| Keep-alive | Infra OK | Refresh 3h; re-login silencioso **não** (OTP) |

---

## 2. O que é diferente da Via Verde / MyPRIO

| | Via Verde | MyPRIO | **Uber Supplier** |
|--|-----------|--------|-------------------|
| Host app | `viaverde.pt` | `www.myprio.com` | **`supplier.uber.com`** (singular) |
| Host auth | mesmo site | mesmo site | **`auth.uber.com/v2/`** (Breeze) |
| Password | email+pass num form | user+pass → SMS | email/tel → **chooser** (SMS / passkey / salvaguarda) |
| OTP | — | **6** dígitos (`input[type=number]`) | **4** dígitos pin (`PHONE_SMS_OTP-0..3`) |
| Passkeys / WebAuthn | não | não | **Sim** — QR no modal TVDE (humano digitaliza); depois OTP SMS se pedido |
| CSS | razoável | OutSystems | **Atomic/ofuscado** (`ae`, `du`, …) — **não** usar classes |
| Selectores estáveis | ids DNN | textos / placeholders | `data-testid`, `data-baseweb`, `screen-test`, aria |
| Google / Apple | — | — | Botões presentes — **não automatizar** |
| Pós-login | área Extratos | Home MyPRIO | ecrã **«Tudo pronto!»** → redirect `supplier.uber.com/orgs/{uuid}` |

---

## 3. URLs confirmadas (vídeo)

### 3.1 Auth (Breeze)

```
https://auth.uber.com/v2/?breeze_init_req_id=…
  &breeze_local_zone=dca23
  &next_url=https%3A%2F%2Fsupplier.uber.com%2Forgs%2F{orgUuid}…
```

- Framework de login Uber = **Breeze** (`breeze_init_req_id`).
- `next_url` aponta sempre para o **Supplier** da org (frota).

### 3.2 App autenticada

```
https://supplier.uber.com/orgs/{orgUuid}/…
```

Host correcto: **`supplier.uber.com`** (singular). O adapter usa `SUPPLIER_HOME = 'https://supplier.uber.com/'`.

### 3.3 Entrada recomendada para RPA

1. Abrir `https://supplier.uber.com/` (ou URL org bookmarked) → redirect para `auth.uber.com/v2/?next_url=…`
2. **Não** começar em `auth.uber.com` sem `next_url` (pode cair no fluxo rider/genérico).

---

## 4. Fluxo filmado (passo a passo)

Gravação: Chrome **Incognito**, ~81s, conta org **«Caminhos Tolerantes»**, telemóvel mascara `******6983`.

```
Incognito
  → supplier / bookmark Uber
  → auth.uber.com/v2 (next_url=supplier.uber.com/orgs/…)
  → «Qual é o seu número de telefone ou e-mail?»
  → preencher email (ex.: admin@…)
  → Continuar
  → [PODE] modal Passkeys (QR / security key)  ← hostil ao RPA
  → falha passkey → «Não foi possível verificar a sua passkey» → Voltar
  → [PODE] «Verificar com uma chave de acesso» / «Continuar com uma chave de acesso»
  → [PODE] password «Bem-vindo(a) de novo, Caminhos Tolerantes.»
  → SMS OTP 4 dígitos (PHONE_SMS_OTP)
  → «Tudo pronto!» → Continuar (ou auto-redirect)
  → supplier.uber.com/orgs/{uuid}  Página inicial
```

### 4.1 Ecrã identidade

| | |
|--|--|
| Texto | «Qual é o seu número de telefone ou e-mail?» |
| Placeholder | «Introduzir número de telefone ou e-mail» |
| Input | email **ou** telefone |
| CTA | Continuar (preto) |
| Alternativas | «Continuar com Google» · «Continuar com Apple» → **proibido no RPA** |
| Footer | aviso SMS/WhatsApp rates |

Há spinner azul enquanto a UI Breeze carrega — **esperar** input visível + botão Continuar antes de `fill`/`click`.

### 4.2 Passkeys (diferença crítica)

Após Continuar, o browser pode abrir modal nativo / overlay:

- Título: **«Passkeys and security keys»**
- QR: «Scan this QR code… passkey for uber.com»
- «Use your security key»
- Cancel

Se falhar:

- Modal PT: **«Não foi possível verificar a sua passkey»**
- Texto: tentar outra forma / Bluetooth se QR
- Botão **«Voltar»**

Página de fundo pode mostrar:

- «Verificar com uma chave de acesso»
- «Continuar com uma chave de acesso»
- «Utilizar o código de salvaguarda»

**Implicação RPA (Playwright headless):**

1. O RPA **não** completa WebAuthn sozinho (sem telemóvel).
2. Estratégia TVDE: **mostrar o QR/ecrã passkey no modal** (`authChallenge=passkey` + PNG base64). O gestor digitaliza com o telemóvel enquanto o browser Playwright fica vivo (`registerLiveOtpSession` + watcher ~5 min).
3. Depois do passkey, a Uber **pode** pedir SMS → o painel muda para modal OTP (4 dígitos).
4. Limitação: o diálogo **nativo** do Chrome (fora do DOM) pode não sair no screenshot — nesse caso o modal mostra o ecrã Breeze visível; o watcher continua a pollar a página.
5. Google / Apple login: **nunca** automatizar.
6. Se a conta **só** tiver passkey e o QR não for digitalizável a tempo → timeout → Ligar conta outra vez / import manual.

### 4.3 Password (quando aparece)

| | |
|--|--|
| Saudação | «Bem-vindo(a) de novo, **{Nome da org/conta}**.» |
| Campo | `input[type=password]` |
| Links | «Esqueci-me da palavra-passe» · «Mais opções» |

No TVDE: o modal «Ligar conta» já pede password — usar no 2.º passo se este ecrã aparecer.

```
após Continuar(email):
  if chooser «chave de acesso» → clicar **Enviar código por SMS** (nunca passkey/security key)
  if PHONE_SMS_OTP → awaiting_otp (modal TVDE, 4 dígitos)
  após OTP: ecrã «Bem-vindo…» → **Iniciar sessão com a palavra-passe** → fill password → Supplier
```

`PORTAL_RPA_UBER_INTERACTIVE=false` (default): headless. `true`: Chromium visível no login **e** sync (debug); se «Gerar» ficar disabled, espera até 3 min para o gestor marcar a org.
### 4.4 OTP SMS — 4 dígitos (pin-code)

| | |
|--|--|
| Prompt | «Introduza o código de **4** dígitos enviado por SMS para ******XXXX.» |
| Contentor | `role="main"` · `screen-test="PHONE_OTP"` · `flow-test="INITIAL"` |
| Pin wrapper | `data-baseweb="pin-code"` |
| Inputs | `id="PHONE_SMS_OTP-0"` … `PHONE_SMS_OTP-3` |
| data-testid | `PHONE_SMS_OTP` (grupo) |
| type | `text` · `inputmode="numeric"` · `pattern="\d*"` |
| Erro | `#PHONE_SMS_OTP-error` · `data-testid="otp-error"` |
| Resend | «Reenviar código por SMS (0:NN)» |
| Alt | «Utilizar o código de salvaguarda» |
| Nav | ← back · **Seguinte** (disabled até 4 dígitos) |

**≠ MyPRIO:** MyPRIO = 6× number inputs sem Confirmar obrigatório; Uber = **4** pin + botão **Seguinte**.

Implementação sugerida:

```ts
// human-in-the-loop: código colado no modal TVDE
const digits = code.replace(/\D/g, '').slice(0, 4);
for (let i = 0; i < 4; i++) {
  await page.locator(`#PHONE_SMS_OTP-${i}`).fill(digits[i] ?? '');
}
await page.getByRole('button', { name: /seguinte|continuar|next/i }).click();
```

Alternativa: focar `#PHONE_SMS_OTP-0` e `pressSequentially(digits)` (Base Web por vezes propaga).

Timeout OTP no servidor: mesmo do portal RPA (~10 min) enquanto browser live (`keepAlive`).

### 4.5 «Tudo pronto!»

| | |
|--|--|
| Check | círculo preto + check |
| Texto | «Tudo pronto!» / «Vai iniciar sessão… Se não acontecer nada, clique em continuar.» |
| CTA | Continuar |

RPA: esperar URL `supplier.uber.com` **ou** clicar Continuar se ainda em `auth.uber.com`.

### 4.6 Home Supplier (pós-login)

URL: `supplier.uber.com/orgs/{uuid}/…`

Nav (PT) observada:

| Tab | Uso potencial sync |
|-----|--------------------|
| Página inicial | health check sessão / frota |
| Documentos | — |
| Motoristas | matching futuro |
| Veículos | matching futuro |
| Desempenho | — |
| **Relatórios** | **candidato a export pagamentos** |
| **Rendimentos** | **candidato a export pagamentos** |

Sub-nav: Mapa em tempo real · Promoções · Empresas · Página bancária · Faturas · Gestão de viagens.

HTML inicial embute JSON em `<script type="application/json">`:

- `__SUPPLIER_CONTEXT__`
- `__APOLLO_STATE__`
- `__SITE_INFO__`
- …

Útil para: confirmar org id, sessão viva, talvez dados sem scrape — **avaliar depois**; sync v1 deve seguir o caminho visual (Relatórios/Rendimentos → CSV) alinhado ao import manual.

---

## 5. Selectores estáveis (checklist implementação)

Preferir nesta ordem:

1. `data-testid`, `screen-test`, `data-baseweb`
2. `getByRole` / `getByLabel` / texto PT+EN
3. `id` estáveis (`PHONE_SMS_OTP-*`)
4. **Nunca** classes curtas `ae`/`du`/…

| Passo | Selector sugerido |
|-------|-------------------|
| Email/tel | `input[type=email], input[type=tel], input[placeholder*="e-mail" i], …` |
| Continuar | `getByRole('button', { name: /continuar/i })` |
| Passkey QR | screenshot página / `img[alt*QR]` · CTA «Continuar com uma chave…» |
| Password | `input[type=password]` |
| OTP digit i | `#PHONE_SMS_OTP-${i}` |
| OTP erro | `[data-testid="otp-error"]` |
| OTP screen | `[screen-test="PHONE_OTP"]` |
| Seguinte | `getByRole('button', { name: /seguinte\|next/i })` |
| Sessão OK | URL includes `supplier.uber.com` && !`auth.uber.com` |
| Sessão expired | redirect para `auth.uber.com` |
| Painel Gerar | `[data-tracking-name="report-management-v2"]` |
| Tipo payments | `[value="REPORT_TYPE_PAYMENTS_ORDER"]` / texto «Transação de pagamentos» |
| Período (resumo) | `input[placeholder="Selecione o período do relatório"]` |
| Org | `input[placeholder="Selecione as organizações a incluir no relatório"]` |
| Filiais search | `getByPlaceholder(/^Filiais$/i)` |
| Gerar confirm | `[data-testid="generate-report-button"]` |
| Cancelar painel | `[data-tracking-name="generate-report-cancel"]` |

---

## 6. Gap histórico (resolvido 2026-07-17)

| Item | Antes (stub) | Agora (validado) |
|------|--------------|------------------|
| Host | `suppliers.uber.com` | **`supplier.uber.com`** |
| OTP | genérico | **4** pin `#PHONE_SMS_OTP-0..3` |
| Passkey | ignorado | QR modal + SMS preferido |
| Export | botão «csv» genérico | Relatórios → Gerar payments → Em curso → download |
| Poll | instantâneo / 1.ª linha | snapshot + **Em curso** + só linha `payments_*` |

---

## 7. Sync — Relatórios (**validado** 2026-07-17)

Screen recordings + DevTools (noite). Fluxo TVDE: modal **Sincronizar Uber** → **Gerar e sincronizar** (não confundir com «Descarregar seleccionado» num `driver_activity` do topo da lista).

### 7.0 Modal Sync TVDE

| Acção UI | API / opções |
|----------|----------------|
| Abrir **Sincronizar** | Modal `uber-sync-modal.tsx` (não sync directo) |
| Listar | `POST /portal-connections/uber/reports` (~45–60s Playwright) |
| Descarregar seleccionado | `uberSync: { mode: 'existing', reportName }` |
| Gerar e sincronizar | `uberSync: { mode: 'generate', rangeStart, rangeEnd, organizationName }` |
| Default intervalo | `defaultUberReportRange()` — semana completa **anterior**, Europe/Lisbon: **segunda 01:00 → domingo 23:30** |
| Organização | Campo no modal TVDE (ex. `CAMINHOS TOLERANTES, LDA`) — RPA marca o checkbox no Supplier |

### 7.1 URLs

| Página | URL |
|--------|-----|
| Relatórios | `https://supplier.uber.com/orgs/{orgUuid}/reports` |
| Rendimentos | `…/earnings` — **não** é o CSV de pagamentos do TVDE |

### 7.2 Tipo de relatório

| Opção | Usar? |
|-------|--------|
| Atividade do motorista | Não (default do dropdown) |
| … outras … | Não |
| **Transação de pagamentos** | **Sim** |

- Valor interno Base Web: **`REPORT_TYPE_PAYMENTS_ORDER`**
- Nome ficheiro típico: `{YYYYMMDD}-{YYYYMMDD}-payments_order-…`
- Lista do dropdown é **longa** — a opção está **no fundo** (após «Tempo e distância…»). Abrir o select do **painel**, não a coluna «Tipo de relatório» da tabela.

### 7.3 Anatomia do painel «Gerar relatório» (DevTools)

O painel **não** é fiavelmente um `[role=dialog]` / `data-baseweb=drawer`. Âncora estável:

| Elemento | Selector / atributo |
|----------|---------------------|
| Contentor do formulário | `[data-tracking-name="report-management-v2"]` |
| Título | `h5` «Gerar relatório» |
| Instrução | «Selecione as opções abaixo para gerar manualmente o relatório único» |
| Label tipo | `label[for="report-type"]` |
| Select tipo | `[data-baseweb="select"]` · valor seleccionado `value="REPORT_TYPE_PAYMENTS_ORDER"` |
| Resumo do período (colapsado) | `input[readonly][placeholder="Selecione o período do relatório"]` |
| Org (readonly) | `input[readonly][placeholder="Selecione as organizações a incluir no relatório"]` |
| Cancelar | `[data-tracking-name="generate-report-cancel"]` · `aria-label="Cancelar"` |
| **Gerar** | **`[data-testid="generate-report-button"]`** · `aria-label="Gerar"` · `[data-tracking-name="generate-report-request"]` |
| Fechar X | `aria-label="Close"` |

Depois de escolher tipo + período, o formulário **colapsa** para 3 campos (tipo · período · org) + rodapé Cancelar/Gerar. As datas detalhadas (`Data de início` / `Data de fim`) só aparecem depois de **clicar o resumo do período**.

### 7.4 Fluxo RPA «de cima para baixo» (obrigatório)

```
Relatórios (tab Relatórios, não Horários)
  → botão «Gerar relatório»
  → scroll TOPO do painel [data-tracking-name=report-management-v2]
  → Tipo: abrir select (label for=report-type / «Atividade do motorista»)
        → ArrowDown / scroll lista → «Transação de pagamentos» (REPORT_TYPE_PAYMENTS_ORDER)
  → Período: clicar input placeholder «Selecione o período do relatório»
        → tab «Intervalo personalizado»
        → Data início / Data fim: formato portal YYYY/MM/DD (set via JS nos inputs, sem calendário se possível)
        → Horas: dropdowns em slots de 15 min (ex. 1:00 AM, 11:30 PM)
        → fechar popover do período (clicar texto do formulário — NÃO Escape, NÃO coluna da tabela)
  → scroll fundo do painel
  → Org: clicar input «Selecione as organizações a incluir no relatório»
        → popover «Filiais» (placeholder search)
        → filtrar «CAMINHOS TOLERANTES» (ou organizationName do modal)
        → checkbox [role=checkbox] / [data-baseweb=checkbox] «CAMINHOS TOLERANTES, LDA»
        → verificar input.value preenchido (senão erro vermelho «Selecione, pelo menos, uma organização»)
  → clicar [data-testid=generate-report-button] (activo só com org)
  → fechar painel (Cancelar se ainda aberto)
  → POLL §7.5
```

Botão **Gerar** fica **disabled (cinza)** sem organização.

### 7.5 Assíncrono: «Em curso» → «Faça o download» (crítico)

| Facto | Detalhe |
|-------|---------|
| Toast «Relatório criado» | Só confirma o **pedido**; ficheiro ainda não existe |
| Estado na tabela | Coluna Ações = **«Em curso»** (ampulheta) enquanto processa |
| Tempo típico | **2–10 minutos** (já observado >5 min) |
| Pronto | Mesma linha passa a **«Faça o download»** |
| Nome | `{YYYYMMDD}-{YYYYMMDD}-payments_order-…` |
| Frequência | «Manualmente» |

**Algoritmo RPA (implementado em `pollForNewReportAndDownload`):**

1. Antes de Gerar: snapshot `before` (nomes + `Criado em`).
2. Após Gerar: fechar painel; refrescar lista (tab Relatórios / goto `/reports` — evitar `reload` cego).
3. Detectar linha **nova** `payments_*` / tipo Transação:
   - `inProgress` se texto tem «Em curso»
   - `hasDownload` **só** se texto tem «Faça o download» (nunca `querySelector('button')` genérico — «Em curso» também tem UI)
4. Mensagem job UI via `onProgress` (ex. «Relatório Uber Em curso (45s)…»).
5. Quando `hasDownload`: clicar download **nessa linha** + `waitForEvent('download')`.
6. **Nunca** fallback para o 1.º «Faça o download» da tabela (descarrega `driver_activity` / relatório antigo → 0 linhas parseáveis).
7. Timeout poll **~12 min**; timeout Playwright sync Uber **15 min** (`portal-connection.service`).

### 7.6 Armadilhas (já partidas em produção)

| Armadilha | Efeito | Mitigação |
|-----------|--------|-----------|
| Clicar coluna tabela «Tipo de relatório» | Fecha o painel Gerar | Acções só dentro de `report-management-v2` / textos exactos do form |
| `Escape` | Fecha o painel | Tab / clique no texto «Selecione as opções abaixo…» |
| Locators `[role=dialog]` / `drawer` | Timeout — painel não match | Usar `data-tracking-name` + `data-testid` |
| Org: click DOM genérico em `div` | Dropdown abre, checkbox não marca | `getByRole('checkbox')` / `data-baseweb=checkbox` / zona esquerda do texto **dentro do popover Filiais** |
| Poll curto (2–5 min) | Job «running» forever / fail enquanto Em curso | 12 min + mensagens Em curso |
| `hasDownload = Boolean(button)` | Trata Em curso como ready | Só regex «Faça o download» |
| Descarregar `driver_activity` | Sync «sem movimentos parseáveis» | Só `payments_*` / tipo Transação |
| Calendário aberto | Cobre Gerar / org | Datas via JS; fechar popover antes da org |

### 7.7 Colunas da tabela Relatórios

| Coluna PT | Uso RPA |
|-----------|---------|
| Nome do relatório | Match `payments_order` + datas |
| Tipo de relatório | Transação de pagamentos |
| Intervalo de tempo | Confirmar range |
| Frequência | Manualmente |
| Criado em | Ordenação / identidade da linha |
| Ações | **Em curso** → depois **Faça o download** |

### 7.8 Timeouts API

| Fase | Valor |
|------|--------|
| Listagem reports | ~45–60 s |
| Generate (UI fill) | ~1–2 min |
| Poll Em curso | até **12 min** |
| `withPlaywrightPage` sync Uber | **900_000 ms (15 min)** |
| Interactive org wait | até 3 min se `PORTAL_RPA_UBER_INTERACTIVE=true` |

### 7.9 Funções-chave no adapter

| Função | Papel |
|--------|--------|
| `openGenerateDrawer` | Botão «Gerar relatório» |
| `selectPaymentTransactionType` | `REPORT_TYPE_PAYMENTS_ORDER` |
| `fillCustomReportRange` | Resumo período → personalizado → datas/horas |
| `ensureOrganizationSelected` | Input org → Filiais → checkbox |
| `findGenerateConfirmButton` | `getByTestId('generate-report-button')` |
| `pollForNewReportAndDownload` | Em curso → download da linha certa |
| `listUberReportsFromSession` | Lista para o modal TVDE |
| `downloadExistingPaymentReport` | mode `existing` |

Código: `apps/api/src/services/portal-rpa/uber.adapter.ts`.

---

## 8. Sessão / keep-alive (Uber)

Ver [`03-PORTAL_RPA.md` → Manter sessões activas](./03-PORTAL_RPA.md#manter-sessões-activas-keep-alive).

| Capacidade | Uber |
|------------|------|
| Guardar `storageState` após login | Sim (AES) |
| Refresh a cada 3h | Abrir `supplier.uber.com/orgs/…` — se cair em `auth.uber.com` → expired |
| Re-login automático | **Não** (OTP/passkey) — estado `expired` → Ligar conta |
| Na prática | Após OTP humano, keep-alive pode **atrasar** expiração; OTP/passkey de novo = **Ligar conta** |

Incognito no vídeo = cookies frescos; em produção RPA usa profile Playwright com `storageState` persistido (não Incognito).

---

## 9. Segurança / limites

- Não automatizar **Google / Apple** login
- Passkey = **human-in-the-loop** (QR no dashboard); não completar WebAuthn no servidor
- OTP SMS = **human-in-the-loop** no dashboard TVDE (igual MyPRIO; Uber = 4 dígitos)
- Credenciais + sessão AES (`ENCRYPTION_KEY`)
- ToS Uber — uso interno consciente
- Conta filmada: org supplier frota (não rider app)
- Sync **não** é instantâneo: toast ≠ ficheiro pronto; esperar **Em curso** → **Faça o download**

---

## 10. Plano de implementação (estado)

1. [x] Host → `supplier.uber.com`
2. [x] Login SMS → OTP 4 dígitos → palavra-passe → Supplier
3. [x] Sync Relatórios: Gerar «Transação de pagamentos» + org + intervalo
4. [x] Selectors estáveis DevTools (`report-management-v2`, `generate-report-button`, placeholders)
5. [x] Org Filiais + checkbox (Base Web)
6. [x] Poll **Em curso** → **Faça o download** (só linha payments; até ~12 min)
7. [x] Timeout job Uber **15 min**; `onProgress` na UI
8. [x] Modal TVDE lista + gerar (`uber-sync-modal.tsx`)
9. [x] Em produção: `PORTAL_RPA_UBER_INTERACTIVE=false` (headless)
10. [ ] Confirmar CSV real bate com `uber-import.ts` em mais tenants/intervalos

---

## 11. Checklist de teste

1. [ ] Login Incognito / Ligar conta TVDE + OTP
2. [ ] Relatórios → Gerar manual: tipo Transação + org + intervalo → Em curso → download
3. [ ] Modal TVDE: **Gerar e sincronizar** (org preenchida) → job mostra «Em curso…» → linhas em `uber_payments`
4. [ ] Modal: **Descarregar seleccionado** num `payments_order` existente
5. [ ] Não seleccionar `driver_activity` no topo da lista ao gerar
6. [ ] Logs: `[uber-sync] tipo =`, `org after`, `Em curso`, `A descarregar`, ingest

---

## 12. Ficheiros TVDE

| Ficheiro | Papel |
|----------|--------|
| `apps/api/src/services/portal-rpa/uber.adapter.ts` | Login / OTP / sync / listReports / poll Em curso |
| `apps/api/src/services/portal-rpa/portal-connection.service.ts` | Jobs · timeout sync **900s** · `onProgress` · `listUberPortalReports` |
| `apps/api/src/routes/portal-connection.routes.ts` | `…/reports` + body `uberSync` |
| `apps/web/src/components/portal/portal-connection-panel.tsx` | Ligar + OTP + abre sync Uber · `humanizePortalError` |
| `apps/web/src/components/uber/uber-sync-modal.tsx` | Lista + gerar intervalo + organização |
| `apps/web/src/components/uber/uber-panel.tsx` | UI + import manual |
| `packages/shared/src/portal-rpa.ts` | `UberSyncOptions`, `defaultUberReportRange` |
| `packages/shared/src/uber-import.ts` | Parse CSV |
| `apps/api/src/services/uber.service.ts` | Persistência |
| `apps/api/src/services/portal-rpa/ingest.service.ts` | Ingest CSV → `UberPayment` |

---

*Actualizado 2026-07-17 23:00 — sync generate validado end-to-end (Em curso → download → ingest).*
