# 06 — Uber (pagamentos + Portal RPA)

Documento de referência do módulo **Uber** no TVDE.  
Complementa [`03-PORTAL_RPA.md`](./03-PORTAL_RPA.md) (infra RPA partilhada).

**RPA detalhado (login filmado, passkeys, OTP 4 dígitos, gaps do adapter):** [`07-UBER.md`](./07-UBER.md).

| Relacionado | |
|-------------|--|
| Roadmap | [`01-ROADMAP_TVDE.md`](./01-ROADMAP_TVDE.md) |
| Portal RPA | [`03-PORTAL_RPA.md`](./03-PORTAL_RPA.md) |
| RPA Uber (deep dive) | [`07-UBER.md`](./07-UBER.md) |
| Legacy / notas | `docs/ficheiros de exemplo/UBER_MODULE.md`, `AREA_UBER.md` |

---

## 1. Estado (2026-07-19)

| Capacidade | Estado | Notas |
|------------|--------|--------|
| Import manual CSV pagamentos | **OK** | Fallback sempre disponível |
| Ligar conta (Portal RPA) | **OK** | Headless: SMS → OTP modal → palavra-passe |
| Sync / listagem | **OK** (modal) | Modal: lista existentes **ou** gerar intervalo + organização |
| Sync RPA → CSV | **OK** | Gerar «Transação de pagamentos» → Em curso → download → ingest |
| Coluna **Pago** | **OK** | `UberPayment.isPaid` — marcado pelos Pagamentos |
| Paginação listagem | **OK** | 50/página |
| Limpar erro sync | **OK** | Botão Limpar no painel Conta Uber |
| Keep-alive sessão | **Sim** (infra) | Refresh 3h; OTP/passkey de novo = Ligar manual |

Timeouts: poll até **~12 min** · job Playwright Uber **15 min**. Detalhe: [`07-UBER.md` §7](./07-UBER.md#7-sync--relatórios-validado-2026-07-17).

No sync de **Pagamentos**, se já existir relatório no intervalo: oferece o **último** e deixa escolher «Usar este» vs «Gerar novo».

---

## 2. O que sincroniza

| Destino TVDE | Fonte | Notas |
|--------------|-------|--------|
| **Pagamentos Uber** (`UberPayment`) | CSV exportado do portal / RPA | Parse partilhado com import manual |

UI: `/dashboard/uber` · painel `uber-panel.tsx` + `PortalConnectionPanel portal="uber"` · modal `uber-sync-modal.tsx`.

### Sync modal (lista + gerar)

Ao clicar **Sincronizar**:

1. `POST /portal-connections/uber/reports` — Playwright lista a tabela Relatórios (~45–60s).
2. Escolher um relatório existente → sync com `uberSync: { mode: 'existing', reportName }`.
3. Ou **Gerar novo**: organização + intervalo personalizado (pré-preenchido = semana completa **anterior**, Europe/Lisbon: **segunda 01:00 → domingo 23:30**) → `uberSync: { mode: 'generate', rangeStart, rangeEnd, organizationName }`.

Helper partilhado: `defaultUberReportRange()` em `@tvde/shared`.

**Fluxo RPA generate (resumo):** abrir painel → tipo `REPORT_TYPE_PAYMENTS_ORDER` → período (resumo readonly) → datas → input org + checkbox Filiais → `[data-testid=generate-report-button]` → poll **«Em curso»** até **«Faça o download»** na linha nova `payments_*`. Ver [`07-UBER.md` §7](./07-UBER.md#7-sync--relatórios-validado-2026-07-17).

Portal real: **`https://supplier.uber.com/orgs/{uuid}`** (auth em `auth.uber.com/v2/`).

---

## 3. Auth e sessão

| Passo | Comportamento |
|-------|----------------|
| Ligar conta | email/telefone (+ password se Breeze pedir) |
| Passkey / WebAuthn | Cancelar no RPA; preferir password/SMS |
| OTP | **4 dígitos** SMS → modal TVDE (após passkey, se a Uber pedir) |
| Passkey | QR/ecrã no modal TVDE (human-in-the-loop; browser vivo ~5 min) |
| Google / Apple Sign-In | **Não automatizar** — usar import manual |
| Sessão | `storageState` encriptado em `portal_connections` (`portal=uber`) |

Detalhe e selectores: [`07-UBER.md`](./07-UBER.md).

### Manter sessão activa

Doc completa: [`03-PORTAL_RPA.md` → Manter sessões activas](./03-PORTAL_RPA.md#manter-sessões-activas-keep-alive).

| Capacidade | Uber |
|------------|------|
| Refresh cookies periódico | **Sim** (worker `PORTAL_RPA_REFRESH_INTERVAL_HOURS`, default 3h) |
| Gravar cookies renovados | **Sim** |
| Re-login automático se expirar | **Só** se não exigir OTP/passkey |
| Se o portal pedir OTP de novo | Estado `expired` → **Ligar conta** manual |
| API parada | Sem refresh → sessão envelhece |

---

## 4. Variáveis `.env`

```bash
PORTAL_RPA_ENABLED=true
PORTAL_RPA_MOCK=false
PORTAL_RPA_HEADLESS=true
PORTAL_RPA_UBER_INTERACTIVE=false
PORTAL_RPA_UBER_HEADED_CONNECT=true
# DISPLAY=:1
PORTAL_RPA_REFRESH_INTERVAL_HOURS=3
ENCRYPTION_KEY=...
```

- `PORTAL_RPA_UBER_HEADED_CONNECT`: Ligar conta headed+Xvfb para o Arkose pintar no modal **Desafio Uber** (produção). **Não** é o mesmo que INTERACTIVE.
- `PORTAL_RPA_UBER_INTERACTIVE=true`: Chromium **visível** no login **e** sync (só debug/admin). Em produção: **`false`**.

Fluxo login / Arkose: [`07-UBER.md` §13](./07-UBER.md#13-ligar-conta--fluxo-completo-arkose--otp--password).
---

## 5. Ficheiros

| Ficheiro | Papel |
|----------|--------|
| `apps/api/src/services/portal-rpa/uber.adapter.ts` | Login / refresh / sync Playwright (lista, download por nome, gerar intervalo) |
| `apps/api/src/services/uber.service.ts` | CRUD / import / stats |
| `apps/api/src/routes/uber.routes.ts` | API módulo |
| `apps/api/src/routes/portal-connection.routes.ts` | `…/reports` + sync `uberSync` |
| `apps/web/src/components/uber/uber-panel.tsx` | UI pagamentos |
| `apps/web/src/components/uber/uber-sync-modal.tsx` | Modal sync (lista + gerar) |
| `apps/api/src/workers/portal-session-refresh.worker.ts` | Keep-alive partilhado |
| `packages/shared/src/uber-import.ts` | Tipos / parse CSV |
| `packages/shared/src/portal-rpa.ts` | `UberSyncOptions`, `defaultUberReportRange` |

---

## 6. Segurança / limites

- Não forçar login Google/Apple via RPA
- Passkey + OTP + Arkose (Desafio Uber live) = human-in-the-loop no dashboard
- Credenciais AES por tenant; OTP nunca em logs
- ToS Uber — uso interno consciente

---

## 7. Checklist

1. [ ] Módulo Uber activo no tenant
2. [ ] `PORTAL_RPA_MOCK=false` + Chromium + API reiniciada
3. [ ] Seguir checklist de [`07-UBER.md`](./07-UBER.md) (login + export)
4. [ ] Sync / import → linhas em `uber_payments`
5. [ ] Em produção: API 24/7 para keep-alive

---

*Actualizado 2026-07-17 23:00 — sync generate validado (Em curso → download); deep dive em 07.*
