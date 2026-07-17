# 04 — Via Verde (módulo completo + Portal RPA)

Documento de referência **exaustivo** do módulo Via Verde no monorepo TVDE.  
Objectivo: um agente (ou humano) conseguir **ler isto e replicar / depurar** o sistema sem depender de memória de chat.

Relacionado: [`03-PORTAL_RPA.md`](./03-PORTAL_RPA.md) (infra partilhada RPA Via Verde / MyPRIO / Uber).  
Roadmap: [`01-ROADMAP_TVDE.md`](./01-ROADMAP_TVDE.md).  
Legacy / notas antigas (PHP): `docs/ficheiros de exemplo/VIAVERDE.md`, `AREA_VIA_VERDE.md`.

---

## 1. O que é

O módulo **Via Verde** gere **movimentos de portagens** (passagens) associados a matrículas de frota:

1. **Import manual** — ficheiro XLS/XLSX/CSV exportado do portal Via Verde.
2. **Sync automático (Portal RPA)** — Playwright faz login na conta Empresas (ou Particulares), abre Extratos e Movimentos → tab Movimentos, carrega os últimos ~30 dias com «Ver mais», raspa a tabela (preferido) ou tenta Exportar→Excel, e injeta no mesmo pipeline de import.
3. **Dashboard** — totais pendentes, total do mês, lista filtrável, marcar pago / apagar (superadmin).

Dados são **multi-tenant** (`tenant_id`). Motoristas (`staff`) só veem movimentos das suas matrículas / `userId` (fleet scope).

---

## 2. Inventário de ficheiros (fonte de verdade)

### 2.1 Core Via Verde (domínio)

| Path | Papel |
|------|--------|
| `packages/shared/src/via-verde.ts` | Tipos, `VIA_VERDE_PAGE_SIZE`, aliases de cabeçalhos, `parseViaVerdeRows` / `parseViaVerdeCsv`, normalização de matrícula para import |
| `packages/shared/src/index.ts` | Re-exporta Via Verde + tipos |
| `packages/shared/src/routes.ts` | `WEB_ROUTES.viaVerde`, `API_PATHS.viaVerde.*` |
| `packages/shared/src/permissions.ts` | Módulo `via_verde` → role mínima `staff` |
| `apps/api/src/routes/via-verde.routes.ts` | HTTP: dashboard, movements, import, paid, delete |
| `apps/api/src/services/via-verde.service.ts` | Queries, filtros, agregados (`filteredTotal`), mark paid, delete |
| `apps/api/src/services/via-verde-import.service.ts` | Persistência após parse: dedupe + match viatura + insert/backfill |
| `apps/web/src/app/dashboard/via-verde/page.tsx` | Página → `<ViaVerdePanel />` |
| `apps/web/src/app/dashboard/via-verde/layout.tsx` | `FleetModuleShell` `moduleKey="via_verde"` |
| `apps/web/src/components/via-verde/via-verde-panel.tsx` | UI completa: cards, filtros, lista, import, painel RPA |

### 2.2 Portal RPA (sync browser) — específico / partilhado

| Path | Papel |
|------|--------|
| `apps/api/src/services/portal-rpa/via-verde.adapter.ts` | **Adapter Playwright Via Verde** (login DNN, Movimentos, Ver mais, scrape/Excel) |
| `apps/api/src/services/portal-rpa/adapters.ts` | Registo `via_verde` → adapter |
| `apps/api/src/services/portal-rpa/portal-connection.service.ts` | Jobs connect/sync/refresh, encrypt sessão, ingest, mensagens, auto-heal |
| `apps/api/src/services/portal-rpa/ingest.service.ts` | `portal === 'via_verde'` → `importViaVerdeCsv(...)` |
| `apps/api/src/services/portal-rpa/types.ts` | Launch Chromium, `storageState`, interfaces adapter |
| `apps/api/src/routes/portal-connection.routes.ts` | REST `/portal-connections/:portal` |
| `apps/web/src/components/portal/portal-connection-panel.tsx` | UX Ligar / OTP / Sync / Desligar (usado em Via Verde + outros) |
| `packages/shared/src/portal-rpa.ts` | Tipos públicos `PortalConnectionPublic`, labels, kinds |
| `docs/03-PORTAL_RPA.md` | Doc geral RPA |

### 2.3 Matching viaturas / matrículas

| Path | Papel |
|------|--------|
| `apps/api/src/services/user-vehicle-matching.service.ts` | `matchViaVerdeToVehicle`, scope motorista; **não pode lançar** em matrícula atípica |
| `packages/shared/src/user-vehicle.ts` | `normalizeUserVehicleMatricula` |
| `packages/shared/src/carwash-license-plate.ts` | Formato PT `XX-XX-XX`, `stripLicenseInput`, erro histórico «Matrícula nacional inválida…» |
| `packages/shared/src/user-vehicle-overlap.ts` | `pickBestUserVehicleForPeriod` (período da viatura vs data do movimento) |

### 2.4 Spreadsheet / import genérico

| Path | Papel |
|------|--------|
| `apps/api/src/lib/spreadsheet-import.ts` | Buffer → rows (XLSX/CSV), validação extensão |
| `packages/shared/src/spreadsheet-rows.ts` | Headers, datas, pad rows |
| `packages/shared/src/csv-import.ts` | Money / boolean helpers |

### 2.5 Base de dados

| Path | Papel |
|------|--------|
| `packages/database/prisma/schema.prisma` | `model ViaVerdeMovement`, enums `PortalKind` (`via_verde`), `PortalConnection`, `PortalSyncJob` |
| `packages/database/prisma/migrations/20260715010000_via_verde_electricity/migration.sql` | Cria `via_verde_movements` |
| `packages/database/prisma/migrations/20260715120000_portal_rpa_sync/migration.sql` | Portal RPA tables |
| `packages/database/prisma/seed.ts` | Catálogo módulo `{ key: 'via_verde', name: 'Via Verde', ... }` |

### 2.6 Wire-up app / nav

| Path | Papel |
|------|--------|
| `apps/api/src/app.ts` | `register(viaVerdeRoutes)` (+ portal connections) |
| `apps/web/src/lib/module-access.ts` | Acesso ao módulo |
| `apps/web/src/components/dashboard-module-cards.tsx` | Card dashboard |
| `apps/web/src/app/dashboard/dashboard-shell.tsx` | Navegação |

### 2.7 Config / env

| Path | Papel |
|------|--------|
| `packages/shared/src/config.server.ts` | `PORTAL_RPA_ENABLED`, `PORTAL_RPA_MOCK`, `PORTAL_RPA_HEADLESS`, `PORTAL_RPA_REFRESH_INTERVAL_HOURS` |
| `.env` | Valores runtime (não commitar secrets) |
| Root `package.json` | `npm run playwright:install` |
| `apps/api/src/workers/portal-session-refresh.worker.ts` | Keep-alive cookies / re-login (ver `03-PORTAL_RPA.md`) |

### 2.8 Artefactos de debug (não código de produção)

| Path | Nota |
|------|------|
| `.tmp-viaverde-frames/` | Frames extraídos de vídeo do portal (exploração UI) — **não** necessários em runtime |

---

## 3. Modelo de dados

### 3.1 `ViaVerdeMovement` → tabela `via_verde_movements`

Campos principais (Prisma):

| Campo | Map SQL | Notas |
|-------|---------|--------|
| `id` | UUID | PK |
| `tenantId` | `tenant_id` | Multi-tenant |
| `userId` | `user_id` | Match opcional motorista |
| `userVehicleId` | `user_vehicle_id` | Match opcional viatura |
| `licensePlate` | `license_plate` | Matrícula normalizada (preferência PT `AA-00-BB`) |
| `obu` | `obu` | **Identificador único lógico por tenant** (`@@unique([tenantId, obu])`) |
| `entryDate` / `exitDate` | | Datas reais da passagem |
| `entryPoint` / `exitPoint` | | Ex.: «Estoril», «Mafra Oeste» |
| `value` | Decimal(12,2) | Valor da passagem |
| `isPaid` / `paymentDate` | | Marcar pago no TVDE (não no portal) |
| `systemEntryDate` | `system_entry_date` | UI: **Data cobrança** |
| `paymentMethod`, `mobilityAccount`, … | | Campos ricos do Excel oficial |
| `importedByUserId` | | Quem importou / actor do sync |

Índices: `tenant+licensePlate`, `tenant+isPaid`, `tenant+entryDate`.

### 3.2 Uniqueness e dedupe (crítico)

No portal Empresas, a coluna **Identificador / Conta Mobilidade** **repete-se** em muitos movimentos (é o ID do dispositivo OBU / conta, **não** um ID único por viagem).

Por isso no scrape RPA o `obu` guardado é **sintético**:

```text
{identifier}_{entryDateDigits}_{valorNormalizado}_{rowIndex}
```

Exemplo conceptual: `123456789_20260713104316_0.50_42`

Dedupe no import (`via-verde-import.service.ts`):

1. Existe `tenantId + obu` → skip (+ backfill `systemEntryDate` se estava null).
2. Senão, existe mesmo `licensePlate + entryDate + value` → skip (+ backfill igual).
3. Senão → insert + match viatura.

Sem o passo (2), re-syncs com OBU sintético diferente (índice de linha) criariam duplicados.

### 3.3 `PortalConnection` / `PortalSyncJob`

Uma ligação por `(tenantId, portal='via_verde')`:

- Credenciais AES (`ENCRYPTION_KEY`)
- `sessionStateEncrypted` = Playwright `storageState`
- `status`: `disconnected | connected | awaiting_otp | expired | error`
- `lastSyncAt`, `lastError`, `activeJobId`
- Jobs com `message` tipo: `Sync: 299 inseridos, 11 ignorados (duplicados), 0 falhados`

---

## 4. Permissões e rotas

### 4.1 Módulo

- Key: `via_verde`
- Role mínima catálogo: `staff` (`permissions.ts`)
- UI gestora (ligar conta, import, pagar/apagar): tipicamente **`superadmin`** (`hasMinRole(role, 'superadmin')` no painel)

### 4.2 Web

- Página: `/dashboard/via-verde` (`WEB_ROUTES.viaVerde.root`)

### 4.3 API Via Verde (`/api/v1`)

| Método | Path | Auth | Função |
|--------|------|------|--------|
| GET | `/via-verde/dashboard?month=YYYY-MM` | módulo | Cards: pendente, count, monthTotal |
| GET | `/via-verde/movements?...` | módulo | Lista paginada + **`filteredTotal` / `filteredCount`** |
| POST | `/via-verde/import` | superadmin + multipart | Import ficheiro |
| PATCH | `/via-verde/movements/:id/paid` | superadmin | Marcar pago |
| DELETE | `/via-verde/movements/:id` | superadmin | Apagar |

Query lista: `licensePlate`, `startDate`, `endDate` (`YYYY-MM-DD`), `isPaid`, `page`, `pageSize` (default `VIA_VERDE_PAGE_SIZE = 50`).

### 4.4 API Portal (sync)

| Método | Path |
|--------|------|
| GET | `/portal-connections/via_verde` |
| POST | `/portal-connections/via_verde/connect` `{ username, password }` |
| POST | `/portal-connections/via_verde/otp` (Via Verde **não usa OTP** na prática) |
| POST | `/portal-connections/via_verde/sync` |
| DELETE | `/portal-connections/via_verde` |

---

## 5. Fluxos end-to-end

### 5.1 Import manual

```
UI (ficheiro) → POST /via-verde/import
  → spreadsheet-import (buffer → rows)
  → parseViaVerdeRows (shared)
  → importViaVerdeCsv (dedupe + match + create)
  → audit log via_verde.import
```

Aceita `.csv`, `.txt`, `.xls`, `.xlsx`.

O parse aceita:

- Cabeçalhos com aliases (`VIA_VERDE_HEADER_ALIASES`) — Excel oficial Via Verde e CSV sintético do scrape.
- Fallback posicional para layouts tabulares clássicos.

### 5.2 Sync RPA (caminho real validado em conta Empresas)

```
UI Sincronizar → POST .../sync → PortalSyncJob(type=sync)
  → Playwright restore storageState
  → viaVerdeAdapter.sync(page)
       1. goto Extratos e Movimentos (Empresas preferido)
       2. openMovimentosTab
       3. applyLast30DaysFilter (datepickers DD/MM/AAAA)
       4. loadAllMovimentosPages (clicar «Ver mais» até N/N ou limiar)
       5. scrapeMovimentosTable → CSV UTF-8 BOM
          (fallback downloadExcelExport Exportar→Excel)
  → ingestPortalDownloadedFiles → importViaVerdeCsv
  → job message "Sync: X inseridos, Y ignorados…"
  → portal.lastSyncAt = now; lastError = null
```

**Importante:** a lista do portal carrega ~10 linhas de cada vez. Sem o loop «Ver mais», o sync só via a primeira página (~10 movimentos). Com filtro 30 dias + Ver mais, um sync real obteve por exemplo **299 inseridos, 11 ignorados**.

Duração típica: **1–2 minutos** (centenas de cliques «Ver mais» + scrape + insert).

### 5.3 Login RPA Via Verde (particularidades DNN)

Portal real:

- URL Empresas: `https://www.viaverde.pt/empresas/minha-via-verde/extratos-movimentos`
- Login modal DNN: `#pnlLogin`, campos `#txtUsername`, `#txtPassword`, botão `#btnLogin`
- Em páginas de área o modal **já pode estar aberto**; clicar «Login» no header pode falhar com *intercepts pointer* — o adapter trata cookies + força visibilidade do modal.

Preferir Chromium completo:

```bash
PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL=0
# + npm run playwright:install
```

Env tipico:

```bash
PORTAL_RPA_ENABLED=true
PORTAL_RPA_MOCK=false
PORTAL_RPA_HEADLESS=true
PORTAL_RPA_REFRESH_INTERVAL_HOURS=3
ENCRYPTION_KEY=...   # mesma chave AES do projecto
```

### Manter sessão Via Verde activa

Doc completa: [`03-PORTAL_RPA.md` → Manter sessões activas](./03-PORTAL_RPA.md#manter-sessões-activas-keep-alive).

Resumo específico Via Verde:

| Capacidade | Estado |
|------------|--------|
| Refresh cookies periódico | **Sim** (worker 3h) |
| Gravar `storageState` renovado | **Sim** |
| Re-login automático se cookies expirarem | **Sim** (email+password encriptados; sem OTP) |
| Erro DNS/rede no refresh nocturno | Job falha; **não** tratar como sessão permanentemente morta — próximo tick recupera |
| Expectativa | Dias/semanas **Ligado** se API 24/7 + password estável |

Se o painel mostrar **Erro** com `ERR_NAME_NOT_RESOLVED` após a noite: esperar o próximo refresh ou reiniciar a API. Só **Ligar conta** se o estado for `expired` e o re-login automático falhar (password alterada, etc.).

### 5.4 Scrape → CSV sintético

Tabela HTML tipica (Empresas / Movimentos):

| Coluna portal | Uso no scrape |
|---------------|---------------|
| Identificador / Conta Mobilidade | base do OBU sintético |
| Matrícula | `licensePlate` |
| Descrição | parse rota `A >> B` + datetimes `YYYY-MM-DD HH:mm:ss` |
| Serviço | (informativo) |
| Meio de pagamento | `paymentMethod` |
| Valor | `value` |
| Estado | (não mapeado obrigatoriamente) |

CSV gerado inclui cabeçalhos reconhecidos por `parseViaVerdeRows`, incluindo:

- `Entry Date` / `Exit Date` / `Entry Point` / `Exit Point`
- **`Data da cobrança`** ← dia da `entryDate` (o portal nesta lista **não** mostra cobrança; UI TVDE precisa do campo)

### 5.5 Match motorista / viatura

Após parse, `matchViaVerdeToVehicle(vehicles, plate, referenceDate)`:

- Usa normalização **tolerante** (PT → foreign → strip) — **nunca** deve rebentar o sync inteiro.
- `pickBestUserVehicleForPeriod` escolhe viatura activa na data.
- Se não houver match: `userId` / `userVehicleId` ficam `null` (movimento ainda é inserido).

**Bug histórico (corrigido):** `normalizeUserVehicleMatricula` lançava `Matrícula nacional inválida — use o formato XX-XX-XX (6 caracteres)` **fora** do `try/catch` do insert → `failJob` → `lastError` vermelho no painel mesmo com estado Ligado, e `lastSyncAt` não actualizava.

Mitigações:

1. `normalizeViaVerdePlate` no parse (`via-verde.ts`).
2. `normalizePlateForMatch` em `user-vehicle-matching.service.ts`.
3. Auto-heal de `PortalConnection` error→connected limpa `lastError` se ainda há sessão.
4. UI: não mostrar `lastError` quando `status === 'connected'`.

---

## 6. UI (`via-verde-panel.tsx` + `portal-connection-panel.tsx`)

### 6.1 Cards superiores

- Total pendente (soma `isPaid=false`) + count
- Nº movimentos total
- `MonthTotalCard` (mês seleccionável)
- Import XLS/XLSX (superadmin)

### 6.2 Conta Via Verde (RPA)

- Bolinha de estado: **verde** connected · **vermelha** disconnected · **laranja** error/expired/awaiting_otp
- `Estado: Ligado · ma***@me.com`
- `Último sync: …`
- Mensagem verde do último job (`lastJobMessage`)
- Botões **Sincronizar** / **Desligar** (ou Ligar conta)
- Loader + poll ~1s **só** enquanto connecting/syncing/jobInFlight

**Bug histórico (corrigido):** `onStatusChange` chamado em *cada* poll → `loadData()` em loop → Chrome `ERR_INSUFFICIENT_RESOURCES` / `Failed to fetch`.  
Fix: notificar só **uma vez** quando sai de `syncing` com `lastSyncAt` novo (`lastNotifiedSyncAt` ref).

Textos longos de ajuda («Sincronizar lê Extratos…», «Automação via browser…») foram **removidos** a pedido UX.

### 6.3 Filtros da lista

Estado separado:

- Inputs locais: `licensePlate`, `startDate`, `endDate`
- Aplicados: `applied { … }` — só mudam em **Filtrar** / **Limpar** / Enter na matrícula

Quando `hasFilters`:

- Faixa com matrícula e/ou intervalo formatado PT
- Número de movimentos filtrados
- **`Total: X,XX €`** ← `filteredTotal` da API (aggregate sobre o **mesmo** `where` da lista, não só a página actual)

API devolve:

```ts
{
  items, total, page, pageSize, totalPages,
  filteredTotal: string,  // Decimal → string
  filteredCount: number
}
```

### 6.4 Tabela

Colunas: Matrícula · Data entrada · Data cobrança (`systemEntryDate`) · Entrada · Saída · Valor · Pago · Ações

Ações superadmin: check (marcar pago) · lixo (delete).

Paginação: Anterior / Seguinte.

---

## 7. Funções-chave (mapa mental)

### Shared `via-verde.ts`

- `normalizeViaVerdePlate` — import tolerante
- `parseViaVerdeRows` — header-based ou posicional
- `VIA_VERDE_HEADER_ALIASES` — mapeamento colunas Excel/scrape → campos

### API `via-verde.service.ts`

- `buildWhere` — filtros + fleet scope motorista
- `getViaVerdeDashboard`
- `listViaVerdeMovements` — inclui aggregate filtered
- `markViaVerdeMovementPaid` / `deleteViaVerdeMovement`

### API `via-verde-import.service.ts`

- Loop rows: dedupe obu / trip · backfill cobrança · match · create

### Adapter `via-verde.adapter.ts`

| Função | Responsabilidade |
|--------|------------------|
| `ensureLoginModal` / `submitLogin` | DNN login |
| `openMovimentosTab` | Tab Movimentos |
| `applyLast30DaysFilter` | De/Até ~30 dias |
| `loadAllMovimentosPages` | Loop «Ver mais» (até ~80 cliques / `N/N`) |
| `scrapeMovimentosTable` | HTML → CSV |
| `downloadExcelExport` | Fallback Exportar→Excel (muitas vezes **não** dispara download no Playwright) |
| `login` / `sync` / `refresh` | Contrato `PortalAdapter` |

---

## 8. Problemas reais encontrados e resolução

| Sintoma | Causa | Resolução |
|---------|--------|-----------|
| Sync «ok» mas só ~10 linhas | Sem «Ver mais» | `loadAllMovimentosPages` |
| `Data cobrança` = `—` | Scrape sem campo | CSV com `Data da cobrança` = dia entry; backfill no skip |
| `Último sync` não actualiza + erro matrícula | Throw no match | Normalização tolerante + limpar `lastError` |
| `ERR_INSUFFICIENT_RESOURCES` | Poll → onStatusChange → loadData | Notify-once |
| `EADDRINUSE` 3002/3003 | Processos antigos | Matar PIDs / liberar portas |
| `Executable doesn't exist` | Chromium em falta | `npm run playwright:install` + restart API |
| Export Excel Playwright = null | UI portal não emite download | Preferir scrape |
| OBU portal não único | Identificador dispositivo | OBU sintético + dedupe trip |
| Erro vermelho com estado Ligado | `lastError` stale após auto-heal | Clear lastError no heal; UI esconde erro se connected |
| Conta Particulares vs Empresas | URLs diferentes | Adapter tenta Empresas primeiro, depois Particulares |

---

## 9. Checklist de replicação (ambiente novo)

1. Migration `20260715010000_via_verde_electricity` aplicada (`via_verde_movements`).
2. Migration `20260715120000_portal_rpa_sync` aplicada (portal tables).
3. Seed / workspace module `via_verde` activo no tenant.
4. `.env`:
   - `PORTAL_RPA_ENABLED=true`
   - `PORTAL_RPA_MOCK=false` (sync real)
   - `PORTAL_RPA_HEADLESS=true`
   - `PORTAL_RPA_REFRESH_INTERVAL_HOURS=3`
   - `ENCRYPTION_KEY` válida (32+ chars alinhada ao projecto)
5. `npm run playwright:install` e reiniciar API.
6. Superadmin → `/dashboard/via-verde` → **Ligar conta** (email/password Via Verde Empresas).
7. **Sincronizar** — esperar 1–2 min; validar mensagem `Sync: N inseridos…`.
8. Filtrar por matrícula + datas → confirmar **Total** coerente com soma.
9. Fallback: **Importar XLS/XLSX** manual se RPA falhar.

---

## 10. Como depurar (rápido)

### Sync falhou

1. GET `/portal-connections/via_verde` → `lastError`, `lastJobMessage`, `activeJobStatus`, `lastSyncAt`.
2. Logs API no job Playwright (`message` no `PortalSyncJob`).
3. Confirmar `PORTAL_RPA_MOCK=false` e Chromium.
4. Desligar → Ligar de novo (renova cookies).

### Parse / 0 inseridos

1. Ver se scrape devolveu CSV com header `OBU` + `Matrícula`.
2. Contar linhas no scrape vs «N movimentos filtrados» no portal.
3. Se job `failed` com «Sync sem movimentos» — UI não carregou lista / filtros falharam.

### Matrículas / matching

1. Não exigir PT estrito no import RPA.
2. `stripLicenseInput` para comparar com `user_vehicles.matricula`.

### Portas / API morta

```bash
lsof -iTCP:3002 -sTCP:LISTEN
lsof -iTCP:3003 -sTCP:LISTEN
# kill -9 <pids> se EADDRINUSE
npm run dev
```

---

## 11. Contratos TypeScript úteis (shared)

```ts
VIA_VERDE_PAGE_SIZE = 50

ViaVerdeMovementItem {
  id, licensePlate, entryDate, systemEntryDate,
  entryPoint, exitPoint, value, isPaid, paymentDate,
  serviceDescription, userId
}

ViaVerdeDashboardStats {
  totalMovements, unpaidCount, unpaidTotal,
  monthTotal, selectedMonth
}

ViaVerdeImportResult {
  total, inserted, skipped, failed, errors[]
}
```

`PortalConnectionPublic` (ver `portal-rpa.ts`): inclui `usernameMasked`, `lastSyncAt`, `lastError`, `lastJobMessage`, `activeJobStatus`, `browserReady`, `mockMode`, `rpaEnabled`.

---

## 12. Diagrama resumido

```text
                    ┌─────────────────────────────┐
                    │  /dashboard/via-verde       │
                    │  ViaVerdePanel              │
                    │  + PortalConnectionPanel    │
                    └───────────┬─────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
   Import XLSX          Lista/Filtros            Sync RPA
          │                     │                     │
          ▼                     ▼                     ▼
  via-verde.routes      via-verde.service     portal-connection
          │                     │                     │
          ▼                     │                     ▼
  via-verde-import ◄────────────┘            via-verde.adapter
          │                                   (Playwright)
          ▼                                         │
  via_verde_movements ◄── ingest ◄── CSV/XLSX ──────┘
          │
          ├── match → user_vehicles
          └── UI Data cobrança = systemEntryDate
```

---

## 13. Decisões de produto / engenharia (não reverter sem motivo)

1. **Scrape > Excel** no RPA Empresas (Excel frequentemente sem download Playwright).
2. **Últimos 30 dias** como janela default do sync (portal também filtra assim).
3. **Ver mais obrigatório** antes de scrape.
4. **Data cobrança** preenchida a partir da data do movimento quando o portal não a expõe.
5. **Dedupe dupla** (OBU + trip plate/date/value).
6. **Import manual permanece** como fallback e para históricos.
7. **Não mostrar lastError em connected** (evita confusão UX).
8. **Poll só com job em voo** — nunca reload da lista a cada poll.
9. Matrículas atípicas **não** podem abortar o sync completo.

---

## 14. Extensões futuras (fora do âmbito actual)

- Persistir «estado pago» do portal se a coluna Estado for fiável.
- Incremental sync (só desde `lastSyncAt`) em vez de sempre 30 dias + Ver mais.
- Worker em fila dedicada (Bull/etc.) se vários tenants syncarem em paralelo.
- Testes unitários de `parseViaVerdeRows` com fixtures CSV scrape + Excel oficial.
- Actualizar `03-PORTAL_RPA.md` secção Excel→scrape (doc ainda menciona Excel primeiro em alguns sítios).

---

## 15. Referência rápida de paths API no código

```ts
// packages/shared/src/routes.ts
API_PATHS.viaVerde = {
  dashboard: '/via-verde/dashboard',
  movements: '/via-verde/movements',
  import: '/via-verde/import',
  movementPaid: (id) => `/via-verde/movements/${id}/paid`,
  movementById: (id) => `/via-verde/movements/${id}`,
}

API_PATHS.portalConnections.byPortal('via_verde')
// GET/POST connect|otp|sync / DELETE
```

---

*Última actualização documental: 2026-07-15 — estado funcional confirmado (sync ~299 inseridos, filtros + totais, painel RPA limpo).*
