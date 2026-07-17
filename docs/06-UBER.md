# 06 — Uber (pagamentos + Portal RPA)

Documento de referência do módulo **Uber** no TVDE.  
Complementa [`03-PORTAL_RPA.md`](./03-PORTAL_RPA.md) (infra RPA partilhada).

| Relacionado | |
|-------------|--|
| Roadmap | [`01-ROADMAP_TVDE.md`](./01-ROADMAP_TVDE.md) |
| Portal RPA | [`03-PORTAL_RPA.md`](./03-PORTAL_RPA.md) |
| Legacy / notas | `docs/ficheiros de exemplo/UBER_MODULE.md`, `AREA_UBER.md` |

---

## 1. Estado (2026-07-17)

| Capacidade | Estado | Notas |
|------------|--------|--------|
| Import manual CSV pagamentos | **OK** / em uso | Fallback sempre disponível |
| Ligar conta (Portal RPA) | **Parcial** | Adapter Playwright; OTP / anti-bot podem bloquear |
| Sync RPA → CSV | **Parcial** | Depende do portal não pedir Google/Apple / CAPTCHA |
| Keep-alive sessão | **Sim** (infra) | Refresh 3h + re-login silencioso se sem OTP extra |

---

## 2. O que sincroniza

| Destino TVDE | Fonte | Notas |
|--------------|-------|--------|
| **Pagamentos Uber** (`UberPayment`) | CSV exportado do portal / RPA | Parse partilhado com import manual |

UI: `/dashboard/uber` · painel `uber-panel.tsx` + `PortalConnectionPanel portal="uber"`.

---

## 3. Auth e sessão

| Passo | Comportamento |
|-------|----------------|
| Ligar conta | telefone/email (+ password se pedida) |
| OTP | Se o portal pedir → modal human-in-the-loop (igual MyPRIO) |
| Google / Apple Sign-In | **Não automatizar** — usar import manual |
| Sessão | `storageState` encriptado em `portal_connections` (`portal=uber`) |

### Manter sessão activa

Doc completa: [`03-PORTAL_RPA.md` → Manter sessões activas](./03-PORTAL_RPA.md#manter-sessões-activas-keep-alive).

| Capacidade | Uber |
|------------|------|
| Refresh cookies periódico | **Sim** (worker `PORTAL_RPA_REFRESH_INTERVAL_HOURS`, default 3h) |
| Gravar cookies renovados | **Sim** |
| Re-login automático se expirar | **Sim**, *se* o login completo não exigir OTP / SSO |
| Se o portal pedir OTP de novo | Estado `expired` / falha → **Ligar conta** manual |
| API parada | Sem refresh → sessão envelhece |

---

## 4. Variáveis `.env`

```bash
PORTAL_RPA_ENABLED=true
PORTAL_RPA_MOCK=false
PORTAL_RPA_HEADLESS=true
PORTAL_RPA_REFRESH_INTERVAL_HOURS=3
ENCRYPTION_KEY=...
```

---

## 5. Ficheiros

| Ficheiro | Papel |
|----------|--------|
| `apps/api/src/services/portal-rpa/uber.adapter.ts` | Login / refresh / sync Playwright |
| `apps/api/src/services/uber.service.ts` | CRUD / import / stats |
| `apps/api/src/routes/uber.routes.ts` | API módulo |
| `apps/web/src/components/uber/uber-panel.tsx` | UI |
| `apps/api/src/workers/portal-session-refresh.worker.ts` | Keep-alive partilhado |
| `packages/shared/src/uber.ts` (ou equivalente) | Tipos / parse CSV |

---

## 6. Segurança / limites

- Não forçar login Google/Apple via RPA
- CAPTCHA / Cloudflare → import manual
- Credenciais AES por tenant; OTP nunca em logs
- ToS Uber — uso interno consciente

---

## 7. Checklist

1. [ ] Módulo Uber activo no tenant
2. [ ] `PORTAL_RPA_MOCK=false` + Chromium + API reiniciada
3. [ ] Ligar conta (ou import manual CSV)
4. [ ] Sync / import → linhas em `uber_payments`
5. [ ] Em produção: API 24/7 para keep-alive

---

*Actualizado 2026-07-17 — keep-alive documentado; sync RPA ainda parcial vs import manual.*
