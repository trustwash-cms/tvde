# 12 — Módulo Calendário

Especificação completa do módulo de agenda multi-tenant: base de dados, API, permissões, UI (agenda + configurações) e roadmap.

**Estado:** Fase 1 — schema + migração + **API REST** + **UI FullCalendar** + **gestão de calendários em Configurações** + widget dashboard. Worker de lembretes (email/cron) por implementar.

Relacionado: [11 — Permissões, roles e módulos](11-permissoes-roles-modulos.md) · [05 — Frontend](05-frontend.md) · [04 — API REST](04-api-rest.md)

---

## 1. Objectivos

| Fase | Funcionalidade |
|------|----------------|
| **1** | Calendários por workspace, eventos, drag-and-drop, partilha multi-utilizador, anexos (metadata), lembretes no dashboard |
| **2** | Agendar emissão/envio de faturas Moloni por cliente (`calendar_scheduled_invoices`) |

---

## 2. Princípio de UX: Agenda vs Configurações

A gestão de **calendários** (criar, editar, eliminar, visibilidade, membros) está separada da **vista de agenda** (eventos, drag-and-drop).

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CONFIGURAÇÕES → Calendário          │  MENU → Calendário (agenda)       │
│  /dashboard/settings/calendar      │  /dashboard/calendar              │
├────────────────────────────────────┼──────────────────────────────────────┤
│  • Criar calendário (ex. Macbusinesss) │  • FullCalendar (mês/semana/dia) │
│  • Editar nome, cor, visibilidade      │  • Criar/editar eventos          │
│  • Marcar calendário por defeito       │  • Drag-and-drop de eventos      │
│  • Gerir membros (visibility=shared)   │  • Grelha FullCalendar a largura │
│  • Eliminar calendário                 │    total (sem lista de calendários)│
│  • Selector de workspace               │  • Sem gestão de calendários aqui  │
└────────────────────────────────────┴──────────────────────────────────────┘
```

**Porquê:** alinha com outros módulos (Moloni, SMS, WhatsApp) onde a **configuração** vive em Configurações e a **operação** no menu lateral. Cada utilizador gere os seus calendários por workspace; a agenda consome apenas os calendários visíveis.

---

## 3. Visibilidade do módulo (quando aparece na UI)

O módulo `calendar` segue as **três camadas** do CMS (ver doc 11). Se qualquer camada falhar, o utilizador **não vê** a funcionalidade.

| Camada | Quem | Onde | Efeito se inactivo |
|--------|------|------|-------------------|
| **A — Autorização** | MASTER | Tenants → toggle `calendar` | Módulo **não aparece** em Workspaces nem em `allowedModules` |
| **B — Activação** | superadmin+ | Workspaces → toggle `calendar` | Fora de `activeModules`; sidebar «Calendário» oculta |
| **C — Configuração** | staff+ (módulo activo) | Configurações → Calendário | Entrada sub-nav oculta; página bloqueada por guard |

### Onde o módulo é filtrado

| Local | Mecanismo | Comportamento se módulo inactivo |
|-------|-----------|----------------------------------|
| Sidebar principal | `moduleKey: 'calendar'` + `hasActiveModule` | Item «Calendário» **não aparece** |
| `/dashboard/calendar` | `ModuleAccessGuard` | Mensagem centrada «módulo não activo» |
| Config → sub-nav «Calendário» | `settings-sub-nav` + `moduleKey: 'calendar'` | Entrada **não aparece** |
| `/dashboard/settings/calendar` | `SettingsAccessGuard moduleKey="calendar"` | `ModuleInactiveMessage` |
| Config → Módulos (card) | `GET /modules` + health | Card visível se autorizado; estado «Inactivo» / link Workspaces |
| Workspaces → toggles | `allowedKeys` ∩ `businessKeys` | Só módulos **autorizados** pelo MASTER |
| Widget lembretes (dashboard) | `hasActiveModule('calendar')` | Widget não carrega dados |
| API | `requireModule('calendar')` | **403** |

**Nota:** em Configurações → Módulos, o card do calendário pode aparecer com estado «Inactivo» (aviso) para o superadmin saber que falta activar em Workspaces — mas o link «Calendário» no sub-nav **só aparece com módulo activo**.

---

## 4. Fluxos por role

### 4.1 MASTER

```
MASTER
  └─ Tenants: autoriza módulo calendar para o cliente
  └─ NÃO acede a dados de calendário (API bloqueada; padrão WhatsApp)
  └─ NÃO vê Config → Calendário nem menu Calendário como operação de tenant
```

### 4.2 Superadmin (cliente)

```
SUPERADMIN
  └─ Workspaces: activa calendar no workspace desejado
  └─ Configurações → Calendário:
        ├─ Selector de workspace
        ├─ Criar calendários (ex. «Macbusinesss», «Reuniões», …)
        ├─ Definir visibilidade e membros
        └─ Configurações → Módulos: ver saúde («Sem calendários» até criar o primeiro)
  └─ Menu → Calendário: agenda, eventos, drag-and-drop
```

### 4.3 Admin / Staff

```
ADMIN / STAFF (módulo activo no workspace)
  └─ Configurações → Calendário (staff+):
        ├─ Criar os **seus** calendários no workspace
        ├─ Editar/eliminar calendários de que é **owner**
        └─ Gerir membros se visibility = shared e tiver permissão de edição
  └─ Menu → Calendário:
        ├─ Grelha a largura total com eventos de todos os calendários visíveis (ACL)
        └─ Criar eventos nos calendários onde tem edição
```

### 4.4 Diagrama de activação completo

```
┌──────────┐    allowed=true     ┌─────────────┐    enabled=true    ┌──────────────┐
│  MASTER  │ ──────────────────▶ │ tenant_     │ ─────────────────▶ │ workspace_   │
│  Tenants │                     │ modules     │   superadmin       │ modules      │
└──────────┘                     └─────────────┘   Workspaces       └──────┬───────┘
                                                                             │
                     ┌───────────────────────────────────────────────────────┘
                     ▼
        ┌────────────────────────────┐       ┌─────────────────────────┐
        │ Configurações → Calendário │       │ Menu → Calendário       │
        │ CRUD calendários + membros │       │ Eventos + FullCalendar  │
        └────────────────────────────┘       └─────────────────────────┘
```

---

## 5. Modelo conceptual (dados)

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Calendar   │────▶│  CalendarMember  │────▶ User (ACL)     │
│ (workspace) │     │ owner/editor/    │                     │
└──────┬──────┘     │ viewer           │                     │
       │            └──────────────────┘                     │
       ▼                                                      │
┌─────────────┐     ┌──────────────────┐     ┌──────────────┴──┐
│ CalendarEvent│────▶│ EventAttendee    │────▶ User (convite) │
│ start/end   │     │ can_edit, RSVP   │                     │
└──────┬──────┘     └──────────────────┘                     │
       │                                                      │
       ├──▶ CalendarEventReminder ──▶ Dashboard / email      │
       ├──▶ CalendarEventAttachment ──▶ storage_key (S3)     │
       └──▶ CalendarScheduledInvoice ──▶ BillingEntity (f2)  │
```

**Isolamento:** `tenant_id` + `workspace_id` em todas as entidades principais; RLS PostgreSQL; módulo `calendar` em `tenant_modules` + `workspace_modules`.

**Scope:** cada calendário pertence a **um workspace**. O selector de workspace em Configurações filtra a lista; a agenda usa o workspace activo do contexto global (`useWorkspaceContext`).

---

## 6. Tabelas

### 6.1 `calendars`

Contentor partilhável (equivalente a um calendário no Google).

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `tenant_id` | UUID FK | Isolamento multi-tenant |
| `workspace_id` | UUID FK | Scope do módulo (como billing) |
| `owner_user_id` | UUID FK | Criador / proprietário |
| `name` | string | Nome visível (ex. «Macbusinesss») |
| `color` | string | Hex (`#3b82f6`) — UI / FullCalendar |
| `timezone` | string | IANA (`Europe/Lisbon`) |
| `visibility` | enum | `private` \| `workspace` \| `shared` |
| `is_default` | bool | Calendário por defeito do owner (único por owner+workspace) |

**`visibility`:**

| Valor | Quem vê na agenda |
|-------|-------------------|
| `private` | Owner + `calendar_members` |
| `shared` | Apenas `calendar_members` explícitos (+ owner) |
| `workspace` | Utilizadores do workspace com módulo activo (leitura); edição via ACL |

Ao criar: o criador fica como `owner_user_id` e é inserido automaticamente em `calendar_members` com `role = owner`.

### 6.2 `calendar_members`

ACL persistente ao nível do calendário.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `calendar_id` | UUID FK | |
| `user_id` | UUID FK | Utilizador do **mesmo tenant** |
| `role` | enum | `owner` \| `editor` \| `viewer` |
| `notify_changes` | bool | Notificar alterações |

Unique: `(calendar_id, user_id)`.

**UI Configurações:** quando `visibility = shared`, o painel mostra checkboxes de utilizadores do tenant (`GET /calendar/users`) para adicionar viewers. Guardar via `PUT /calendar/calendars/:id/members`.

### 6.3 `calendar_events`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `calendar_id` | UUID FK | Calendário pai |
| `title`, `description`, `location` | | Conteúdo |
| `start_at`, `end_at` | timestamptz | Intervalo (UTC na BD) |
| `all_day` | bool | Evento de dia inteiro |
| `status` | enum | `confirmed` \| `tentative` \| `cancelled` |
| `recurrence_rule` | string? | RFC 5545 RRULE |
| `recurrence_until` | timestamptz? | Fim da série |
| `series_master_id` | UUID? | Excepções de série |
| `original_start_at` | timestamptz? | Slot original (excepção) |
| `metadata_json` | JSON | Extensões (fase 2 billing) |

**Índices:** `(calendar_id, start_at, end_at)`, `(tenant_id, workspace_id, start_at)`.

### 6.4 `calendar_event_attendees`

Partilha por evento (convites).

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `event_id`, `user_id` | | |
| `role` | enum | `organizer` \| `required` \| `optional` |
| `response_status` | enum | `needs_action` \| `accepted` \| `declined` \| `tentative` |
| `can_edit` | bool | Editar evento além do ACL do calendário |
| `notify` | bool | Recebe lembretes deste evento |

### 6.5 `calendar_event_reminders`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `offset_minutes` | int | Minutos **antes** de `start_at` |
| `channel` | enum | `in_app` \| `email` \| `push` (futuro) |
| `fire_at` | timestamptz | `start_at - offset` — indexado para worker |
| `status` | enum | `pending` \| `sent` \| `dismissed` \| `skipped` |

**Dashboard:** `GET /calendar/reminders/upcoming`. Ao mover evento (drag-and-drop), `fire_at` dos lembretes `pending` é recalculado.

### 6.6 `calendar_event_attachments`

Metadados; upload físico pendente (módulo `media`).

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `storage_key` | string | `{tenant_id}/calendar/{event_id}/{uuid}-{filename}` |
| `mime_type`, `size_bytes`, `file_name` | | Metadados |

### 6.7 `calendar_scheduled_invoices` (Fase 2)

Agendar emissão Moloni. Ver secção roadmap.

---

## 7. Regras de acesso (API)

Implementação: `apps/api/src/services/calendar/calendar-access.service.ts`.

Ordem de verificação nas routes:

1. `authenticate` — JWT válido
2. **MASTER bloqueado** — `rejectMaster` hook
3. `requireModule('calendar')` — tenant allowed + workspace enabled
4. ACL por calendário/evento

### 7.1 Calendário

| Acção | Quem |
|-------|------|
| **Ver** | Owner, OU membro, OU `visibility = workspace` |
| **Editar** (nome, cor, visibility) | Owner, OU membro com role `owner` \| `editor` |
| **Eliminar** | Apenas `owner_user_id` com row `calendar_members.role = owner` |
| **Gerir membros** | Quem pode editar o calendário (`requireCalendarEdit`) |

### 7.2 Evento

| Acção | Quem |
|-------|------|
| **Ver** | Attendee do evento, OU quem vê o calendário pai |
| **Editar** | Criador, OU attendee com `can_edit`, OU editor/owner do calendário |
| **Criar** | Quem tem edição no calendário destino |

### 7.3 Listagem visível

`listVisibleCalendarIds` devolve IDs onde:

```sql
owner_user_id = me
OR EXISTS calendar_members(user_id = me)
OR visibility = 'workspace'
```

(scope: `workspace_id` + `tenant_id` do pedido)

---

## 8. API REST

Ficheiros: `apps/api/src/routes/calendar.routes.ts`, `apps/api/src/services/calendar/*`.

Constantes: `API_PATHS.calendar.*` em `packages/shared/src/routes.ts`.

| Método | Path | Função |
|--------|------|--------|
| GET | `/calendar/users` | Utilizadores partilháveis do tenant (`?workspaceId=`) |
| GET | `/calendar/calendars` | Listar calendários visíveis (`?workspaceId=`) |
| POST | `/calendar/calendars` | Criar calendário (+ membro owner automático) |
| GET | `/calendar/calendars/:id` | Detalhe + membros |
| PATCH | `/calendar/calendars/:id` | Actualizar nome/cor/visibility/isDefault |
| DELETE | `/calendar/calendars/:id` | Eliminar (só owner) |
| PUT | `/calendar/calendars/:id/members` | Gerir ACL `{ members: [{ userId, role, notifyChanges? }] }` |
| GET | `/calendar/events` | `?from=&to=&calendarIds=` (repetível) |
| POST | `/calendar/events` | Criar evento + attendees + reminders |
| GET | `/calendar/events/:id` | Detalhe evento |
| PATCH | `/calendar/events/:id` | Editar / drag-and-drop (`startAt`, `endAt`) |
| DELETE | `/calendar/events/:id` | Eliminar evento |
| GET | `/calendar/events/:id/attachments` | Listar anexos |
| POST | `/calendar/events/:id/attachments` | Registar anexo (metadata + `storageKey`) |
| DELETE | `/calendar/events/:id/attachments/:attachmentId` | Remover anexo |
| GET | `/calendar/reminders/upcoming` | Widget dashboard (`?limit=&horizonDays=`) |
| PATCH | `/calendar/reminders/:id/dismiss` | Dispensar alerta |

**Body POST `/calendar/calendars`:**

```json
{
  "workspaceId": "uuid",
  "name": "Macbusinesss",
  "color": "#3b82f6",
  "visibility": "private",
  "isDefault": false
}
```

**Lembretes:** se `reminders` omitido no POST evento, cria lembrete default 15 min (`in_app`) para o criador.

---

## 9. UI — Configurações → Calendário

| Item | Valor |
|------|-------|
| Rota | `WEB_ROUTES.dashboard.settings.calendar` → `/dashboard/settings/calendar` |
| Página | `apps/web/src/app/dashboard/settings/calendar/page.tsx` |
| Painel | `apps/web/src/components/settings/settings-calendar-panel.tsx` |
| Guard | `SettingsAccessGuard minRole="staff" moduleKey="calendar"` |
| Sub-nav | `settings-sub-nav.tsx` — label «Calendário», `minRole: 'staff'`, `moduleKey: 'calendar'` |

### 9.1 Layout do painel

1. **Cabeçalho** — título + link para a agenda (`/dashboard/calendar`)
2. **WorkspaceSelector** — filtra calendários do workspace seleccionado
3. **Coluna «Novo calendário»** — formulário: nome, cor (paleta), visibilidade, checkbox «por defeito»
4. **Coluna «Os seus calendários»** — lista clicável; seleccionar para editar
5. **Secção «Editar»** (quando seleccionado):
   - Nome, visibilidade, cor, por defeito
   - Botões Guardar / Eliminar (confirm dialog)
   - Se `visibility = shared`: lista de utilizadores + «Guardar membros»

### 9.2 Constantes partilhadas

`apps/web/src/components/calendar/calendar-constants.ts`:

- `CALENDAR_COLORS` — paleta de 6 cores
- `CALENDAR_VISIBILITY_LABELS` — labels PT para o select

### 9.3 Configurações → Módulos

| Item | Detalhe |
|------|---------|
| `CONFIG_LINKS.calendar` | Aponta para `/dashboard/settings/calendar` |
| Saúde (`module-health.service.ts`) | `warning` «Sem calendários» se count = 0; `ok` com N calendário(s) |
| Acção no card | «Configurar» (warning/error) ou «Ver config» (ok) |

---

## 10. UI — Agenda (`/dashboard/calendar`)

| Item | Valor |
|------|-------|
| Rota | `WEB_ROUTES.dashboard.calendar` → `/dashboard/calendar` |
| Layout guard | `apps/web/src/app/dashboard/calendar/layout.tsx` → `ModuleAccessGuard moduleKey="calendar"` |
| Painel | `apps/web/src/components/calendar/calendar-panel.tsx` (dynamic, `ssr: false`) |
| Modal eventos | `apps/web/src/components/calendar/calendar-event-modal.tsx` |
| Widget dashboard | `apps/web/src/components/calendar/dashboard-reminders-widget.tsx` |

### 10.1 Layout da agenda (largura total)

A página **não lista calendários** — isso fica só em Configurações → Calendário.

- A grelha FullCalendar ocupa **toda a largura** disponível (`contentHeight: calc(100vh - 14rem)`)
- Carrega eventos de **todos os calendários visíveis** do workspace (ACL da API)
- Se não existir nenhum calendário: mensagem com link para Configurações → Calendário

### 10.2 FullCalendar

- Vistas: mês, semana, dia, lista
- Locale: PT (`@fullcalendar/core/locales/pt`)
- Drag-and-drop e resize → `PATCH /calendar/events/:id` com novos `startAt`/`endAt`
- Cores dos eventos = cor do calendário pai

### 10.3 Navegação principal

`dashboard-shell.tsx`:

```typescript
{ href: WEB_ROUTES.dashboard.calendar, label: 'Calendário', area: 'calendar', moduleKey: 'calendar' }
```

`DASHBOARD_ACCESS.calendar = 'staff'` em `packages/shared/src/permissions.ts`.

---

## 11. Permissões resumidas

| Actor | Autorizar (tenant) | Activar (workspace) | Config calendários | Usar agenda |
|-------|-------------------|---------------------|-------------------|-------------|
| **master** | Sim (Tenants) | — | Não | Não |
| **superadmin** | — | Sim (Workspaces) | Sim | Sim |
| **admin** | — | — | Sim (staff+) | Sim |
| **staff** | — | — | Sim | Sim |

Registo: `module_registry.key = 'calendar'` — **desactivado por defeito** no seed.

---

## 12. Saúde do módulo

`GET /modules/health?workspaceId=` (superadmin) inclui `calendar` em `INTEGRATION_KEYS`.

| Estado | Condição | Label | Detail |
|--------|----------|-------|--------|
| `inactive` | Não autorizado no tenant | Não autorizado | Não incluído no plano |
| `warning` | Autorizado mas não activo no workspace | Inactivo | Active em Workspaces |
| `warning` | Activado, 0 calendários | Sem calendários | Crie em Configurações → Calendário |
| `ok` | ≥ 1 calendário | Operacional | `N calendário(s)` |

---

## 13. Diagrama ER (resumo)

```
tenants ── calendars ── calendar_members ── users
              │
              └── calendar_events ──┬── calendar_event_attendees
                                  ├── calendar_event_reminders
                                  ├── calendar_event_attachments
                                  └── calendar_scheduled_invoices ── billing_entities
                                                                    └── invoices (fase 2)
```

---

## 14. Ficheiros de referência

| Área | Ficheiro |
|------|----------|
| Schema | `packages/database/prisma/schema.prisma` |
| Migração | `packages/database/prisma/migrations/20250611120000_calendar_module/` |
| RLS | `packages/database/prisma/rls.sql` |
| Seed módulo | `packages/database/prisma/seed.ts` |
| API routes | `apps/api/src/routes/calendar.routes.ts` |
| Serviços | `apps/api/src/services/calendar/*.ts` |
| ACL | `apps/api/src/services/calendar/calendar-access.service.ts` |
| Saúde | `apps/api/src/services/module-health.service.ts` |
| Rotas partilhadas | `packages/shared/src/routes.ts` |
| Permissões UI | `packages/shared/src/permissions.ts` |
| Guards UI | `module-access-guard.tsx`, `settings-access-guard.tsx` |
| Sub-nav config | `settings-sub-nav.tsx` |
| Painel config | `settings-calendar-panel.tsx` |
| Agenda | `calendar-panel.tsx`, `calendar-event-modal.tsx` |

---

## 15. Como testar (checklist manual)

1. **MASTER** → Tenants → autorizar `calendar` para o site do cliente
2. **Superadmin** → Workspaces → expandir workspace → activar toggle `calendar`
3. Verificar sidebar: aparece «Calendário»
4. **Configurações** → sub-nav mostra «Calendário»
5. **Configurações → Calendário** → seleccionar workspace → criar «Macbusinesss»
6. **Configurações → Módulos** → card calendar com estado Operacional
7. **Menu → Calendário** → grelha a largura total; criar evento
8. Desactivar módulo em Workspaces → sidebar e Config→Calendário desaparecem; `/dashboard/calendar` mostra mensagem inactiva

---

## 16. Roadmap / próximos passos

| # | Item | Estado |
|---|------|--------|
| 1 | API + serviços CRUD + ACL | ✅ |
| 2 | Configurações → Calendário (CRUD + membros) | ✅ |
| 3 | Página agenda FullCalendar | ✅ |
| 4 | Widget dashboard lembretes | ✅ |
| 5 | Saúde em `/modules/health` | ✅ |
| 6 | Worker lembretes (cron) — email + `sent` | ⏳ |
| 7 | Upload anexos (storage físico / presigned) | ⏳ |
| 8 | Recorrência RRULE (expansão no range query) | ⏳ |
| 9 | Fase 2: `calendar_scheduled_invoices` + UI Moloni | ⏳ |

---

## 17. Resumo em uma frase

> O **MASTER** autoriza `calendar`; o **superadmin** activa no workspace; cada **utilizador** cria e gere os seus calendários em **Configurações → Calendário**; a **agenda** serve só para eventos e visibilidade na grelha — tudo invisível se o módulo não estiver activo.
