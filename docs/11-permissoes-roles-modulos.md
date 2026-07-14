# 11 — Permissões, roles e módulos

Documento de referência para **quem pode fazer o quê**, em que ordem, e onde está implementado (API + UI).

Relacionado: [01 — Arquitectura](01-visao-geral-arquitetura.md) · [06 — Segurança](06-seguranca-multitenancy.md) · [04 — API REST](04-api-rest.md)

---

## 1. Princípio geral

O CMS separa três decisões independentes:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. ROLE (quem és)          master → superadmin → admin → staff │
│ 2. MÓDULO AUTORIZADO       MASTER liga/desliga por tenant       │
│ 3. MÓDULO ACTIVO           superadmin liga/desliga por workspace│
└─────────────────────────────────────────────────────────────────┘
```

**Regra de ouro:** ter role suficiente **não basta**. Para módulos de negócio e integrações, é preciso:

1. O MASTER ter **autorizado** o módulo no tenant (`tenant_modules.allowed = true`)
2. O superadmin ter **activado** o módulo no workspace (`workspace_modules.enabled = true`)
3. Cumprir a **role mínima** da acção (ex.: configurar Moloni → superadmin)

O JWT em `GET /auth/me` expõe isto em:

```json
{
  "role": "superadmin",
  "capabilities": {
    "allowedModules": ["clients", "billing", "whatsapp", "..."],
    "activeModules": ["clients", "billing", "whatsapp"]
  }
}
```

- `allowedModules` — o que o MASTER deixou para este cliente
- `activeModules` — o que está **ligado no workspace** do utilizador (intersecção com allowed)

**MASTER** ignora módulos: vê e acede a tudo; não tem `tenantId`.

---

## 2. Cadeia de delegação (utilizadores)

| Role | Cria / gere utilizadores | Vê na listagem |
|------|--------------------------|----------------|
| **master** | superadmin, admin, staff (escolhe tenant ao criar) | Todos excepto master |
| **superadmin** | admin, staff | admin + staff do tenant |
| **admin** | staff | staff do tenant |
| **staff** | — | — |

Funções (`packages/shared/src/permissions.ts`):

| Função | Uso |
|--------|-----|
| `canAssignRole(actor, targetRole)` | POST `/users` — que roles pode atribuir |
| `canManageUser(actor, targetRole)` | GET `/users` — quem aparece na lista; DELETE |
| `hasMinRole(actor, required)` | API — role mínima (master passa sempre) |
| `canAccessDashboardArea(actor, area)` | Sidebar + pesquisa global por área |

---

## 3. Três camadas por módulo

### Camada A — Autorização (MASTER)

| O quê | Onde | Quem |
|-------|------|------|
| Autorizar módulo ao cliente | Tenants → toggles por tenant | **master** |
| API | `PATCH /tenants/:id/modules/:moduleKey` `{ allowed }` | master |
| Tabela | `tenant_modules` | |

Se `allowed = false`, o superadmin **não vê** o módulo nas opções do workspace e a API responde 403.

### Camada B — Activação (superadmin)

| O quê | Onde | Quem |
|-------|------|------|
| Activar módulo no workspace | Workspaces → toggles | **superadmin+** |
| API | `PATCH /workspaces/:id/modules/:moduleKey` `{ enabled }` | superadmin+ |
| Tabela | `workspace_modules` | |

Só módulos já **autorizados** no tenant podem ser activados.

### Camada C — Configuração (superadmin, módulo activo)

| O quê | Onde | Quem |
|-------|------|------|
| Credenciais, bridge, templates | Configurações → SMS, WhatsApp, Moloni, SMTP | **superadmin+** (+ módulo activo onde aplicável) |
| Toggle 2FA SMS/WhatsApp no tenant | Configurações → SMS / WhatsApp | **superadmin+** (+ módulo activo) |
| Estado / saúde | Configurações → Módulos | **superadmin+** |

---

## 4. Matriz por módulo e função

Legenda: **R** = role mínima · **M** = módulo activo no workspace · **A** = autorizado no tenant (implícito se activo)

### Core (sempre presentes, sem toggle)

| Módulo | Descrição | Quem opera |
|--------|-----------|------------|
| `auth` | Login, sessões, 2FA pessoal | Todos (2FA: cada user em Configurações) |
| `tenancy` | Tenants, planos | master |
| `workspaces` | CRUD workspaces, toggles módulos | superadmin+ (UI); GET lista: autenticado do tenant |
| `audit` | Audit log | admin+ (tenant scoped) |

### Negócio

| Módulo | UI | API guard | Role operação | Role config |
|--------|-----|-----------|---------------|-------------|
| `clients` | Clientes | `requireModule('clients')` | staff+ **M** | — |
| `products` | Produtos | `requireModule('products')` | staff+ **M** | — |
| `billing` | Facturação | `requireModule('billing')` | staff+ **M** | Moloni: superadmin **M** |
| `calendar` | Calendário (agenda) | `requireModule('calendar')` | staff+ **M** | Calendários: staff+ **M** (Config → Calendário) |
| `woocommerce` | WooCommerce | `requireModule('woocommerce')` | staff+ **M** | API loja: superadmin **M** (Config → WooCommerce) |
| `shopify` | Shopify | `requireModule('shopify')` | staff+ **M** | API loja: superadmin **M** (Config → Shopify) |
| `ecommerce` | eCommerce | `requireModule('ecommerce')` | staff+ **M** | Loja + embed: superadmin **M** (Config → eCommerce) |
| `bookings` | Marcações | `requireModule('bookings')` | staff+ **M** | Perfis + embed + WhatsApp: owner/superadmin **M** (Config → Marcações) |
| `carwash` | CarWash | `requireModule('carwash')` | staff+ **M** | — |
| `admin_mgmt` | Gestão Administrativa | `requireModule('admin_mgmt')` | staff+ **M** | Integrações + PIN: staff+ **M** (Config no módulo) |
| `services` | ⏳ não implementado | — | — | — |
| `reports` | ⏳ não implementado | — | — | — |
| `media` | ⏳ não implementado | — | — | — |
| `api-keys` | ⏳ não implementado | — | — | — |
| `webhooks` | ⏳ não implementado | — | — | — |

### Comunicações / integrações

| Módulo | UI config | API guard | Notas |
|--------|-----------|-----------|-------|
| `sms` | Configurações → SMS | `masterOrModule('sms')` | Toggle 2FA: `tenant_settings`. Credenciais SMS: **globais** (v1) |
| `whatsapp` | Configurações → WhatsApp | `whatsappTenantAccess` | Toggle 2FA: tenant. Bridge QR: **sessão por tenant** (MASTER bloqueado) |
| SMTP | Configurações → SMTP | `requireRole('superadmin')` | **Por tenant** (`smtp_config`). Sem flag de módulo |
| Moloni | Configurações → Moloni | `requireModule('billing')` + superadmin em OAuth/config | **Por workspace** (`billing_connection`) |
| WooCommerce | Configurações → WooCommerce | `requireModule('woocommerce')` + superadmin em config | **Por workspace** (`woocommerce_connections`) |
| Shopify | Configurações → Shopify | `requireModule('shopify')` + superadmin em config | **Por workspace** (`shopify_connections`) |
| eCommerce | Configurações → eCommerce | `requireModule('ecommerce')` + superadmin em config | **Por workspace** (`ecommerce_settings` + `ecommerce_products`) |
| Marcações | Configurações → Marcações | `requireModule('bookings')` + owner/superadmin em config | **Por perfil** (`booking_profiles` + catálogo + embed) |
| CarWash | — (sem config externa) | `requireModule('carwash')` | **Por workspace** (tabelas `carwash_*`; pickup usa `WEB_PUBLIC_URL`) |
| Gestão Administrativa | Config no módulo (`/admin-mgmt/configuracoes`) | `requireModule('admin_mgmt')` | **Por workspace** (tabelas `admin_mgmt_*`; PIN em `workspaceModule.configJson`) |
| `calendar` | Configurações → Calendário | `requireModule('calendar')` | CRUD calendários por workspace; MASTER bloqueado na API |

---

## 5. Matriz por área do dashboard

| Área | Sidebar (`DASHBOARD_ACCESS`) | Guard UI | API principal |
|------|-------------------------------|----------|---------------|
| Dashboard | staff | — | — |
| Tenants | master | — | master only |
| Workspaces | superadmin | — | GET: tenant; PATCH modules: superadmin |
| Clientes | staff + **M** clients | `ModuleAccessGuard` | `requireModule('clients')` |
| Produtos | staff + **M** products | `ModuleAccessGuard` | `requireModule('products')` |
| Facturação | staff + **M** billing | `ModuleAccessGuard` | `requireModule('billing')` |
| Calendário (agenda) | staff + **M** calendar | `ModuleAccessGuard` | `requireModule('calendar')` |
| WooCommerce | staff + **M** woocommerce | `ModuleAccessGuard` | `requireModule('woocommerce')` |
| Shopify | staff + **M** shopify | `ModuleAccessGuard` | `requireModule('shopify')` |
| eCommerce | staff + **M** ecommerce | `ModuleAccessGuard` | `requireModule('ecommerce')` |
| Marcações | staff + **M** bookings | `ModuleAccessGuard` | `requireModule('bookings')` |
| CarWash | staff + **M** carwash | `ModuleAccessGuard` | `requireModule('carwash')` |
| Gestão Administrativa | staff + **M** admin_mgmt | `ModuleAccessGuard` | `requireModule('admin_mgmt')` |
| Utilizadores | admin | — | admin + `canManageUser` |
| Audit Log | admin | — | admin, tenant scoped |
| Configurações | staff | sub-nav filtra role + **M** | ver secção 6 |
| Config → Módulos | superadmin | `SettingsAccessGuard` | `GET /modules/health` superadmin |
| Config → 2FA | staff | — | serviço 2FA |
| Config → SMS | superadmin + **M** sms | `SettingsAccessGuard` | `masterOrModule('sms')` |
| Config → WhatsApp | superadmin + **M** whatsapp (sem MASTER) | `SettingsAccessGuard` + `tenantOnly` | `whatsappTenantAccess` |
| Config → Moloni | superadmin + **M** billing | `SettingsAccessGuard` | billing + superadmin |
| Config → WooCommerce | superadmin + **M** woocommerce | `SettingsAccessGuard` | `requireModule('woocommerce')`; credenciais REST API |
| Config → Shopify | superadmin + **M** shopify | `SettingsAccessGuard` | `requireModule('shopify')`; Admin API token |
| Config → eCommerce | superadmin + **M** ecommerce | `SettingsAccessGuard` | `requireModule('ecommerce')`; loja + chave embed |
| Config → Marcações | superadmin + **M** bookings | `SettingsAccessGuard` | `requireModule('bookings')`; perfis, horário, embed, WhatsApp |
| Config → Calendário | staff + **M** calendar | `SettingsAccessGuard` | `requireModule('calendar')`; CRUD calendários (não eventos) |
| Config → SMTP | superadmin | `SettingsAccessGuard` | superadmin, tenant SMTP |

---

## 6. Endpoints de plataforma (comunicações)

### MASTER only (flags globais legacy)

| Método | Path | Uso |
|--------|------|-----|
| GET/PATCH | `/platform/features` | Flags globais `sms2faEnabled` / `whatsapp2faEnabled` em `platform_settings` |

Reservado ao **master**. Superadmins de tenant usam os endpoints abaixo.

### Superadmin + módulo activo

| Método | Path | Função |
|--------|------|--------|
| GET | `/platform/sms-config` | Info SMS + `sms2faEnabled` do **tenant** |
| PUT | `/platform/sms-config` | Credenciais SMS (global v1) |
| PATCH | `/platform/sms-config/features` | Toggle 2FA SMS do **tenant** |
| POST | `/platform/sms-config/test` | SMS teste |
| GET | `/platform/whatsapp/settings` | `whatsapp2faEnabled` tenant + estado bridge |
| PATCH | `/platform/whatsapp/settings` | Toggle 2FA WhatsApp do **tenant** |
| GET | `/platform/whatsapp/status` | Estado bridge |
| GET/PUT | `/platform/whatsapp/templates/:key` | Templates |
| POST | `/platform/whatsapp/test` | Envio teste |

Implementação: SMS usa `masterOrModule()`; WhatsApp usa `whatsappTenantAccess()` — **master não acede** ao bridge/templates por tenant.

### Resolução de flags 2FA

| Actor | Onde ficam as flags |
|-------|---------------------|
| master | `platform_settings` |
| superadmin / admin / staff | `tenant_settings` (`sms_2fa_enabled`, `whatsapp_2fa_enabled`) |

Serviço: `tenant-features.service.ts` → `resolveCommunicationFeatures()`.

O 2FA pessoal (`twofa.service.ts`) exige: módulo activo + flag tenant + infra configurada (SMS env, bridge ligado, etc.).

---

## 7. Fluxo completo (exemplo WhatsApp)

```
MASTER
  └─ Tenants: autoriza módulo whatsapp para site_id 515198609
  └─ Utilizadores: cria superadmin@cliente.pt (tenant + workspace)

SUPERADMIN (cliente)
  └─ Workspaces: activa whatsapp no "Workspace Principal"
  └─ Configurações → WhatsApp:
        ├─ PATCH .../whatsapp/settings → whatsapp2faEnabled = true  (tenant)
        ├─ npm run dev:whatsapp + QR
        └─ templates / teste

ADMIN / STAFF
  └─ Não acedem a Config → WhatsApp (role < superadmin)
  └─ Podem usar 2FA WhatsApp pessoal se superadmin activou tudo acima

UTILIZADOR FINAL
  └─ Configurações → 2FA → método WhatsApp (se disponível em get2faMethodOptions)
```

O mesmo padrão aplica-se a **SMS** (com credenciais em `/platform/sms-config`) e **Facturação** (Moloni por workspace).

### Exemplo Calendário

```
MASTER
  └─ Tenants: autoriza módulo calendar para site_id 515198609

SUPERADMIN (cliente)
  └─ Workspaces: activa calendar no "Workspace Principal"
  └─ Configurações → Calendário:
        ├─ Criar calendário «Macbusinesss» (privado / partilhado / workspace)
        ├─ Gerir membros se visibility = shared
        └─ Configurações → Módulos: saúde «Sem calendários» até criar o primeiro
  └─ Menu → Calendário: eventos, drag-and-drop (sidebar só mostra/oculta)

ADMIN / STAFF
  └─ Configurações → Calendário: criar os seus calendários (staff+)
  └─ Menu → Calendário: usar agenda conforme ACL
  └─ Se módulo desactivado: sidebar, sub-nav e guards ocultam tudo

MASTER
  └─ Não acede a calendários de tenants (API 403)
```

Documentação completa: [12 — Calendário](12-calendario.md).

---

## 8. Onde a API enforce vs UI

| Mecanismo | Ficheiro | Efeito |
|-----------|----------|--------|
| `fastify.authenticate` | `auth.plugin.ts` | JWT + sessão válida |
| `requireRole(min)` | `auth.plugin.ts` | Hierarquia roles |
| `requireModule(key)` | `module.plugin.ts` | Tenant allowed + workspace enabled |
| `masterOrModule` | `platform.routes.ts` | Master OU superadmin+ com módulo |
| `canManageUser` / `canAssignRole` | `business.routes.ts` users | Delegação utilizadores |
| `ModuleAccessGuard` | `module-access-guard.tsx` | Mensagem centrada se módulo inactivo (Facturação, Clientes, …) |
| `SettingsAccessGuard` | `settings-access-guard.tsx` | Role + módulo activo; `ModuleInactiveMessage` em Config |
| `ModuleInactiveMessage` | `module-inactive-message.tsx` | «Este módulo não está activo… contacte o administrador» |
| `hasActiveModule` | `module-access.ts` | Sidebar + sub-nav config |

**A API é a fonte de verdade.** Guards UI evitam páginas vazias/403 confusos.

---

## 9. Pesquisa global (`GET /search`)

Filtra resultados por:

- `canAccessDashboardArea` (role) para tenants, workspaces, users
- `capabilities.activeModules` para clients e products (alinhado com `requireModule`)

Contexto: `tenantId` + `workspaceId` do JWT.

---

## 10. Limitações conhecidas (v1)

| Tópico | Estado | Impacto |
|--------|--------|---------|
| Credenciais SMS | Uma config global (`sms_config`) | Superadmin com módulo SMS edita infra partilhada |
| WhatsApp bridge | Sessão por tenant (`/tenants/:tenantId/*`) | Cada superadmin emparelha o seu número; MASTER não acede |
| Templates WhatsApp | Por tenant (`whatsapp_templates.tenant_id`) | Cada cliente edita os seus templates |
| SMTP | Por tenant | Modelo correcto |
| Moloni | Por workspace (`billing_connections.workspace_id`) | Credenciais OAuth isoladas por tenant/workspace |
| Módulos `services`, `media`, `webhooks`, `api-keys`, `reports` | Só seed | Sem routes/UI — MASTER pode autorizar mas não há funcionalidade |
| `GET /workspaces` | Qualquer user autenticado do tenant | Necessário para selector de workspace em staff; página Workspaces só superadmin na UI |

Roadmap: multi-tenant SMS config, guards em todas as páginas admin.

---

## 11. Checklist para novo módulo

Ao implementar um módulo de negócio:

1. [ ] Registo em `module_registry` (seed)
2. [ ] `requireModule('key')` nas routes API
3. [ ] Entrada sidebar com `moduleKey` em `dashboard-shell.tsx`
4. [ ] `DASHBOARD_ACCESS` se área nova
5. [ ] `ModuleAccessGuard` no layout da página
6. [ ] Config em Settings se integração externa (+ `SettingsAccessGuard` + `masterOrModule` ou padrão SMTP/Moloni)
7. [ ] Pesquisa global se aplicável (`activeModules`)
8. [ ] Linha neste documento (secção 4)
9. [ ] Saúde em `GET /modules/health` se integração

**Exemplo implementado — `calendar`:** itens 1–9 ✅ (ver [12-calendario.md](12-calendario.md)).

**Exemplo implementado — `carwash`:** itens 1–8 ✅ (ver [15-carwash.md](15-carwash.md); sem config em Settings).

---

## 12. Referência rápida de ficheiros

| Ficheiro | Responsabilidade |
|----------|------------------|
| `packages/shared/src/permissions.ts` | Roles UI, delegação users |
| `packages/shared/src/roles.ts` | `ROLE_HIERARCHY`, `hasMinRole` |
| `apps/api/src/plugins/module.plugin.ts` | `requireModule` |
| `apps/api/src/services/tenant-modules.service.ts` | allowed/active capabilities |
| `apps/api/src/services/tenant-features.service.ts` | Flags 2FA por tenant |
| `apps/api/src/services/module-health.service.ts` | Saúde por módulo |
| `apps/web/src/lib/module-access.ts` | `hasActiveModule` (UI) |

---

## 13. Resumo em uma frase

> **MASTER** autoriza o catálogo; **superadmin** activa no workspace e configura integrações; **admin/staff** operam só o que está activo e dentro da sua role — API e UI devem concordar em todas as camadas.
