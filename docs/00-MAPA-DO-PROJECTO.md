# TVDE — Mapa completo do projecto

Documento de referência para humanos e agentes de IA. Ao ler este ficheiro deve ser possível localizar **qualquer ficheiro, tabela, rota ou variável** e perceber **onde alterar** qualquer funcionalidade pedida.

> **Origem:** cópia independente do monorepo CMS (`/cms`), renomeado para `@tvde/*`. **Não há dependência runtime** da pasta CMS — apenas herança de código.

---

## 1. Resumo executivo

| Item | Valor |
|------|-------|
| Nome do projecto | `tvde` |
| Tipo | Monorepo npm workspaces |
| API | Fastify 5 + TypeScript (`apps/api`, porta **3002**) |
| Frontend | Next.js 14 App Router (`apps/web`, porta **3003**) |
| ORM | Prisma 6 + PostgreSQL 16 |
| Cache / rate-limit | Redis 7 |
| CSS | Tailwind CSS 3.4 + `globals.css` (igual ao CMS) |
| Facturação | Moloni via `packages/billing` |
| WHMCS | Consulta CRM (só leitura) + Faturas pagas → Moloni (`docs/whmcs_moloni.md`) |
| Pacotes internos | `@tvde/shared`, `@tvde/database`, `@tvde/billing`, `@tvde/api`, `@tvde/web` |

### Módulos **activos** no TVDE (UI + API registadas)

| `moduleKey` | Nome | Onde na UI |
|-------------|------|------------|
| `auth` | Core — utilizadores, login, 2FA | `/login`, `/dashboard/users` |
| `tenancy` | Core — clientes da plataforma | `/dashboard/tenants` (só MASTER) |
| `workspaces` | Core — sub-divisões por tenant | `/dashboard/workspaces`, Config → Workspaces |
| `audit` | Core — registo de acções | `/dashboard/audit` |
| `clients` | CRM clientes | `/dashboard/clients` |
| `products` | Catálogo interno | `/dashboard/products` |
| `services` | Serviços (BD; UI partilhada com produtos) | — |
| `billing` | Facturação Moloni | `/dashboard/billing/*` |
| `whmcs` | WHMCS CRM (leitura) + Moloni (pagas) | `/dashboard/whmcs/*` |
| `calendar` | Calendário partilhado | `/dashboard/calendar` |
| `admin_mgmt` | Gestão administrativa | `/dashboard/admin-mgmt/*` |
| `sms` | SMS / 2FA | Config → SMS |
| `whatsapp` | WhatsApp Oficial (Meta) + Genérica | Config → WhatsApp — [`10-WHATSAPP_BUSINESS_API.MD`](./10-WHATSAPP_BUSINESS_API.MD) |
| `media`, `webhooks`, `api-keys`, `reports` | Registados no seed; UI limitada | — |

### Módulos **removidos** do código (tabelas na BD podem existir vazias — legado CMS)

`ecommerce`, `woocommerce`, `shopify`, `stripe`, `carwash`, `bookings`, `correos-express`, loja pública.  
O módulo `whatsapp` **está activo**: API Oficial (Meta Cloud) + API Genérica (bridge). Doc: [`10-WHATSAPP_BUSINESS_API.MD`](./10-WHATSAPP_BUSINESS_API.MD).

---

## 2. Roles TVDE

Valores na BD (`users.role`, enum `UserRole`): `master` | `superadmin` | `admin` | `staff`.

| Valor BD | Etiqueta UI | Significado TVDE |
|----------|-------------|------------------|
| `master` | **MASTER** | Dono da plataforma; gere tenants |
| `superadmin` | **Superadmin (Gestor de Frota)** | Gere frota, motoristas, módulos do tenant |
| `admin` | **Admin (Motorista)** | Motorista com acesso delegado |
| `staff` | **Staff** | Equipa com acesso mínimo |

**Ficheiros de roles/permissões (alterar aqui primeiro):**

| Ficheiro | Função |
|----------|--------|
| `packages/shared/src/roles.ts` | Hierarquia, `ROLE_LABELS`, `getRoleLabel()` |
| `packages/shared/src/permissions.ts` | `canAssignRole`, `DASHBOARD_ACCESS`, quem vê o quê |
| `packages/database/prisma/schema.prisma` | Enum `UserRole` (valores permitidos na BD) |
| `apps/web/src/app/dashboard/users/page.tsx` | UI de criação/gestão de utilizadores |
| `apps/web/src/app/dashboard/dashboard-shell.tsx` | Sidebar filtrada por role + módulos |

**Cadeia de delegação:** MASTER → Gestor de Frota → Motorista → Staff.

---

## 3. Base de dados

### 3.1 Ligação (desenvolvimento local)

| Parâmetro | Valor default |
|-----------|---------------|
| Motor | PostgreSQL 16 (Docker) |
| Container | `tvde_postgres` |
| Host/porta | `localhost:5433` (mapeado de 5432 no container) |
| Utilizador | `tvde` |
| Password | `tvde_secret` |
| Base de dados | `tvde` |
| Schema | `public` |
| URL Prisma | `postgresql://tvde:tvde_secret@localhost:5433/tvde?schema=public` |

Definida em `.env` → `DATABASE_URL`. Carregada por `packages/shared/src/env-loader.ts` e `apps/api/src/load-env.ts`.

### 3.2 Redis

| Parâmetro | Valor default |
|-----------|---------------|
| Container | `tvde_redis` |
| URL | `redis://localhost:6380` |
| Uso | Fail2ban login, cache sessões, workers |

### 3.3 Ficheiros de base de dados

| Ficheiro | Função |
|----------|--------|
| `packages/database/prisma/schema.prisma` | **Fonte de verdade** — todos os models Prisma |
| `packages/database/prisma/migrations/*/migration.sql` | Histórico de alterações SQL (82 migrations) |
| `packages/database/prisma/seed.ts` | Dados iniciais: módulos, MASTER, demo frota |
| `packages/database/prisma/rls.sql` | Row-Level Security PostgreSQL (opcional, multi-tenant) |
| `packages/database/prisma/schema-invariants.sql` | Constraints/checks adicionais |
| `packages/database/src/index.ts` | Export `prisma` client |
| `packages/database/docs/MIGRATIONS.md` | Guia de migrations |

**Comandos (na raiz `tvde/`):**

```bash
npm run db:generate      # prisma generate
npm run db:migrate       # migrate dev (local)
npm run db:migrate:deploy # migrate deploy (produção)
npm run db:seed          # seed
npm run db:rls           # aplicar RLS no container
```

**Regra:** nunca `prisma migrate reset` nem apagar dados em produção.

### 3.4 Tabelas — Core (sempre usadas)

| Model Prisma | Tabela SQL | Descrição |
|--------------|------------|-----------|
| `Tenant` | `tenants` | Cliente da plataforma (`site_id` único, plano, limites JSON) |
| `Workspace` | `workspaces` | Sub-espaço dentro do tenant (`slug` por tenant) |
| `WorkspaceRequest` | `workspace_requests` | Pedidos de novo workspace |
| `User` | `users` | Utilizadores (`role`, `tenant_id`, `workspace_id`, 2FA) |
| `Session` | `sessions` | Sessões JWT activas |
| `LoginAttempt` | `login_attempts` | Tentativas de login (fail2ban) |
| `PasswordHistory` | `password_history` | Histórico passwords |
| `PasswordResetToken` | `password_reset_tokens` | Reset password |
| `TwoFaCode` | `two_fa_codes` | OTP 2FA |
| `ModuleRegistry` | `module_registry` | Catálogo de módulos |
| `TenantModule` | `tenant_modules` | Módulos autorizados por tenant |
| `WorkspaceModule` | `workspace_modules` | Módulos activos por workspace |
| `ApiKey` | `api_keys` | Chaves API |
| `Webhook` / `WebhookLog` | `webhooks` / `webhook_logs` | Webhooks |
| `AuditLog` | `audit_logs` | Registo imutável de acções |
| `TenantSetting` | `tenant_settings` | KV settings tenant |
| `WorkspaceSetting` | `workspace_settings` | KV settings workspace |
| `PlatformSetting` | `platform_settings` | KV settings plataforma (MASTER) |
| `SmtpConfig` | `smtp_configs` | SMTP por tenant ou plataforma |
| `EmailTemplate` | `email_templates` | Templates email editáveis |
| `SmsConfig` / `SmsLog` | `sms_configs` / `sms_logs` | SMS Twilio/Sinch |
| `WhatsappTemplate` | `whatsapp_templates` | Templates da API Genérica (bridge) |
| `WhatsappBusinessConfig` | `whatsapp_business_configs` | Credenciais Cloud API (por tenant) |
| `WhatsappBusinessNotificationEvent` | `whatsapp_business_notification_events` | Flags email/WhatsApp por evento |

### 3.5 Tabelas — CRM interno

| Model | Tabela | Uso TVDE |
|-------|--------|----------|
| `Client` | `clients` | CRM `/dashboard/clients` |
| `Product` | `products` | Catálogo `/dashboard/products` |
| `Service` | `services` | Serviços (API business routes) |

### 3.6 Tabelas — Facturação (`billing`)

| Model | Tabela | Uso |
|-------|--------|-----|
| `BillingConnection` | `billing_connections` | OAuth/credenciais Moloni por workspace |
| `BillingEntity` | `billing_entities` | Clientes/fornecedores fiscais |
| `BillingCatalogItem` | `billing_catalog_items` | Artigos/categorias Moloni |
| `BillingSyncConflict` | `billing_sync_conflicts` | Conflitos sync Moloni |
| `Invoice` | `invoices` | Documentos emitidos (local + metadata Moloni) |
| `InvoiceLine` | `invoice_lines` | Linhas de documento |
| `InvoiceDownloadToken` | `invoice_download_tokens` | Links públicos PDF |

### 3.7 Tabelas — Calendário (`calendar`)

| Model | Tabela |
|-------|--------|
| `Calendar` | `calendars` |
| `CalendarMember` | `calendar_members` |
| `CalendarEvent` | `calendar_events` |
| `CalendarEventAttendee` | `calendar_event_attendees` |
| `CalendarEventReminder` | `calendar_event_reminders` |
| `CalendarEventAttachment` | `calendar_event_attachments` |
| `CalendarScheduledInvoice` | `calendar_scheduled_invoices` |

### 3.8 Tabelas — Gestão administrativa (`admin_mgmt`)

| Model | Tabela | Área UI |
|-------|--------|---------|
| `AdminMgmtSeguro` | `admin_mgmt_seguros` | Seguros |
| `AdminMgmtContrato` | `admin_mgmt_contratos` | Contratos |
| `AdminMgmtDespesaPessoal` | `admin_mgmt_despesas_pessoal` | Despesas pessoal |
| `AdminMgmtSegurancaSocial` | `admin_mgmt_seguranca_social` | Seg. Social |
| `AdminMgmtIrsEmpresa` | `admin_mgmt_irs_empresa` | IRS empresa |
| `AdminMgmtIva` | `admin_mgmt_iva` | IVA |
| `AdminMgmtReciboVerde` | `admin_mgmt_recibos_verdes` | Recibos verdes |
| `AdminMgmtVencimento` | `admin_mgmt_vencimentos` | Alertas vencimentos |
| `AdminMgmtCliente` | `admin_mgmt_clientes` | Clientes admin |
| `AdminMgmtLancamento` | `admin_mgmt_lancamentos` | Lançamentos |
| `AdminMgmtFatura` | `admin_mgmt_faturas` | Faturas internas |
| `AdminMgmtImportacao` | `admin_mgmt_importacoes` | Histórico importações |

### 3.9 Tabelas legado (existem na BD, **não usadas** no TVDE)

`woocommerce_connections`, `shopify_connections`, `stripe_connections`, `correos_express_connections`, `stripe_payment_requests`, `ecommerce_*` (settings, products, orders, etc.), `carwash_*`, `booking_*`, `bookings`.

> Num futuro refactor pode criar-se migration aditiva para `DROP` destas tabelas — **só após backup e confirmação**.

---

## 4. Variáveis de ambiente (`.env`)

Copiar `.env.example` → `.env` na **raiz** do projecto. Todos os workspaces leem este ficheiro (o Next sobe directórios até encontrar `.env`).

### Obrigatórias em produção

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Ligação PostgreSQL |
| `REDIS_URL` | Ligação Redis |
| `JWT_SECRET` | Assinatura tokens (string longa aleatória) |
| `ENCRYPTION_KEY` | AES-256 para passwords SMTP na BD (32 chars) |
| `CORS_ORIGIN` | URL pública do frontend (ex. `https://app.tvde.pt`) |
| `WEB_PUBLIC_URL` | URL base do dashboard |
| `NEXT_PUBLIC_API_URL` | URL da API vista pelo browser |
| `API_PORT` / `WEB_PORT` | Portas dos processos |
| `NODE_ENV` | `production` |

### Moloni + Cloudflare Tunnel (produção)

Moloni **não aceita** `localhost` no callback OAuth. Com túnel Cloudflare (`tvde.one`):

```env
NEXT_PUBLIC_API_PUBLIC_URL="https://api.tvde.one/api/v1"
NEXT_PUBLIC_MOLONI_REDIRECT_URI="https://api.tvde.one/api/v1/billing/moloni/callback"
API_PUBLIC_URL="https://api.tvde.one/api/v1"
CORS_ORIGIN="https://fleet.tvde.one"
WEB_PUBLIC_URL="https://fleet.tvde.one"
NEXT_PUBLIC_API_URL="https://api.tvde.one/api/v1"
BILLING_SYNC_SECRET="secret-forte-para-cron-sync"
```

**URI a registar no Moloni Developer:** `https://api.tvde.one/api/v1/billing/moloni/callback`

### Seed (só desenvolvimento / primeira instalação)

| Variável | Default |
|----------|---------|
| `SEED_MASTER_EMAIL` | `master@tvde.local` |
| `SEED_MASTER_PASSWORD` | (obrigatório no seed) |
| `SEED_DEMO_SITE_ID` | `frota-demo` |
| `SEED_DEMO_FLEET_MANAGER_EMAIL` | `gestor@frota-demo.local` |
| `SEED_DEMO_DRIVER_EMAIL` | `motorista@frota-demo.local` |

### Uploads (produção — criar pastas com permissão de escrita)

| Variável | Pasta default |
|----------|---------------|
| `BRANDING_UPLOAD_DIR` | `uploads/branding` |
| `CALENDAR_UPLOAD_DIR` | `uploads/calendar` |
| `ADMIN_MGMT_UPLOAD_DIR` | `uploads/admin-mgmt` |

---

## 5. Estrutura de pastas (raiz)

```
tvde/
├── .env                    # Configuração (NÃO commitar)
├── .env.example            # Modelo de variáveis
├── .gitignore
├── package.json            # Workspaces + scripts npm raiz
├── docker-compose.yml      # Postgres + Redis
├── README.md               # Arranque rápido
├── docs/                   # Documentação (este ficheiro + tópicos)
├── scripts/
│   ├── bootstrap-from-cms.sh  # Re-copiar código do CMS
│   └── prune-modules.sh       # Remover módulos não-TVDE
├── apps/
│   ├── api/                # Backend Fastify
│   └── web/                # Frontend Next.js
└── packages/
    ├── database/           # Prisma + seed
    ├── shared/             # Types, roles, routes, utils partilhados
    └── billing/            # Integração Moloni
```

**Não commitar / não enviar para VPS como código-fonte:** `node_modules/`, `.next/`, `dist/`, `uploads/`, `.env`.

---

## 6. `apps/api` — Backend

### 6.1 Entrada e configuração

| Ficheiro | Função |
|----------|--------|
| `src/index.ts` | Arranque servidor, Redis, worker calendário |
| `src/app.ts` | Registo de plugins, CORS, rotas, error handler |
| `src/load-env.ts` | Carrega `.env` antes de tudo |
| `src/config/env.ts` | Re-export `getServerConfig()` |
| `package.json` | Deps: fastify, prisma, bcrypt, nodemailer, rrule, sharp |

### 6.2 Plugins Fastify

| Ficheiro | Função |
|----------|--------|
| `plugins/database.plugin.ts` | Injeta `prisma` em `fastify` |
| `plugins/auth.plugin.ts` | JWT, `authenticate`, `requireRole` |
| `plugins/module.plugin.ts` | `requireModule('billing')` etc. |

### 6.3 Rotas (`src/routes/`)

| Ficheiro | Prefixo API | Área |
|----------|-------------|------|
| `auth.routes.ts` | `/auth/*` | Login, logout, 2FA, password |
| `tenants.routes.ts` | `/tenants/*` | CRUD tenants (MASTER) |
| `workspaces.routes.ts` | `/workspaces/*` | Workspaces, módulos workspace |
| `workspace-requests.routes.ts` | `/workspace-requests/*` | Pedidos workspace |
| `business.routes.ts` | `/modules`, `/clients`, `/products`, `/users`, `/audit` | CRM + users |
| `billing.routes.ts` | `/billing/*` | Moloni, documentos, entidades |
| `billing-public.routes.ts` | Público | Download PDF fatura |
| `billing-sync-cron.routes.ts` | Cron | Sync Moloni (`X-Billing-Sync-Secret`) |
| `calendar.routes.ts` | `/calendar/*` | Eventos, calendários |
| `calendar-cron.routes.ts` | Cron | Lembretes, facturas agendadas |
| `admin-mgmt.routes.ts` | `/admin-mgmt/*` | Toda a gestão administrativa |
| `smtp.routes.ts` | `/smtp/*` | Config SMTP |
| `tenant-branding.routes.ts` | `/tenant-branding/*` | Logo, wallpaper login |
| `tenant-branding-public.routes.ts` | Público | Logo para login |
| `platform.routes.ts` | `/platform/*` | SMS, features, fail2ban (MASTER) |
| `search.routes.ts` | `/search` | Pesquisa global dashboard |

**Registo central:** `src/app.ts` — ao adicionar módulo novo, importar rota aqui.

### 6.4 Serviços principais (`src/services/`)

| Pasta/ficheiro | Responsabilidade |
|----------------|------------------|
| `auth.service.ts` | Sessões, login, tokens |
| `twofa.service.ts` | 2FA TOTP, SMS, email |
| `tenant-modules.service.ts` | `allowedModules` / `activeModules` por user |
| `billing.service.ts` | Orquestração facturação + Moloni |
| `billing-sync.service.ts` | Sync bidireccional Moloni |
| `moloni-connection.service.ts` | OAuth Moloni |
| `calendar/calendar.service.ts` | CRUD eventos |
| `calendar/calendar-scheduled-invoice.service.ts` | Facturas automáticas do calendário |
| `admin-mgmt*.service.ts` | Cada entidade admin_mgmt |
| `email.service.ts` | Envio SMTP + templates |
| `sms.service.ts` | Twilio / Sinch |
| `audit.service.ts` | Escrita audit log |
| `search.service.ts` | Pesquisa unificada |
| `module-health.service.ts` | Estado módulos no dashboard |

### 6.5 Workers

| Ficheiro | Função |
|----------|--------|
| `workers/calendar-scheduled-invoice.worker.ts` | Processa facturas agendadas (intervalo em background) |

### 6.6 Libs utilitárias (`src/lib/`)

| Ficheiro | Função |
|----------|--------|
| `password.ts` | Hash bcrypt, HIBP, política passwords |
| `crypto.ts` | AES encrypt/decrypt (SMTP passwords) |
| `redis.ts` | Cliente ioredis |
| `workspace-scope.ts` | Filtra queries por tenant/workspace |
| `validation-errors.ts` | Formata erros Zod/Fastify |

---

## 7. `apps/web` — Frontend

### 7.1 Configuração e estilos

| Ficheiro | Função |
|----------|--------|
| `tailwind.config.js` | Config Tailwind (content: `./src/**`) |
| `postcss.config.js` | tailwindcss + autoprefixer |
| `src/app/globals.css` | `@tailwind`, variáveis CSS (`--color-primary`), `.btn-primary`, `.card`, `.input` |
| `next.config.js` | `output: 'standalone'`, env públicas |
| `src/app/layout.tsx` | Layout raiz, import `globals.css` |

### 7.2 Scripts

| Script | Função |
|--------|--------|
| `scripts/dev.mjs` | `next dev` na porta `WEB_PORT` |
| `scripts/start.mjs` | `next start` produção |
| `scripts/prepare-standalone.mjs` | Copia assets para `.next/standalone` (deploy) |

### 7.3 Páginas públicas (`src/app/`)

| Rota | Ficheiro | Função |
|------|----------|--------|
| `/` | `page.tsx` | Redirect para login ou dashboard |
| `/login` | `login/page.tsx` | Login + 2FA + siteId tenant |
| `/forgot-password` | `forgot-password/page.tsx` | Pedido reset |
| `/reset-password` | `reset-password/page.tsx` | Nova password com token |

### 7.4 Dashboard (`src/app/dashboard/`)

| Rota | Ficheiro | Quem acede |
|------|----------|------------|
| `/dashboard` | `page.tsx` | Todos (cards módulos) |
| `/dashboard/tenants` | `tenants/page.tsx` | MASTER |
| `/dashboard/workspaces` | `workspaces/page.tsx` | superadmin+ |
| `/dashboard/users` | `users/page.tsx` | admin+ (gestão utilizadores) |
| `/dashboard/clients` | `clients/page.tsx` | Motorista/Staff (CRM) |
| `/dashboard/products` | `products/page.tsx` | Motorista/Staff |
| `/dashboard/calendar` | `calendar/page.tsx` | Módulo calendar activo |
| `/dashboard/billing/*` | `billing/**` | Facturação Moloni |
| `/dashboard/admin-mgmt/*` | `admin-mgmt/**` | Gestão administrativa |
| `/dashboard/settings/*` | `settings/**` | Configurações |
| `/dashboard/audit` | `audit/page.tsx` | admin+ |
| `/dashboard/change-password` | `change-password/page.tsx` | Obrigatório se `mustChangePassword` |

**Shell comum:** `dashboard-shell.tsx` (sidebar, user, branding) + `dashboard/layout.tsx`.

### 7.5 Componentes por módulo (`src/components/`)

| Pasta | Módulo |
|-------|--------|
| `billing/` | Painéis facturação, documentos, entidades, categorias |
| `calendar/` | FullCalendar, modais evento, lembretes, mapa |
| `admin-mgmt/` | Painéis seguros, contratos, faturas, vencimentos, etc. |
| `settings/` | SMTP, SMS, Moloni, calendário, workspaces, módulos, segurança |
| `moloni/` | Avisos document set Moloni |
| `catalog-csv-import.tsx` | Import CSV produtos (billing) |

### 7.6 Libs frontend (`src/lib/`)

| Ficheiro | Função |
|----------|--------|
| `api.ts` | `apiFetch`, tokens JWT localStorage, `API_PATHS` |
| `module-access.ts` | `hasActiveModule`, labels módulos |
| `workspace-query.ts` | Query param `workspaceId` |

### 7.7 Hooks (`src/hooks/`)

| Hook | Função |
|------|--------|
| `use-workspace-context.ts` | Workspace seleccionado |
| `use-active-module.ts` | Módulo activo |
| `use-session-keep-alive.ts` | Refresh token periódico |

---

## 8. `packages/shared` — Código partilhado API + Web

**Regra:** qualquer constante usada nos dois lados (rotas, permissões, labels) deve estar aqui.

| Ficheiro | Conteúdo |
|----------|----------|
| `index.ts` | Re-export público |
| `server.ts` | `loadEnvFile`, `getServerConfig`, `requireEnv` (só API/build) |
| `roles.ts` | Roles + `ROLE_LABELS` TVDE |
| `permissions.ts` | Permissões dashboard |
| `routes.ts` | `WEB_ROUTES`, `API_PATHS` — **fonte única de URLs** |
| `admin-mgmt.ts` | Constantes gestão administrativa |
| `billing-catalog.ts` | Tipos documentos Moloni |
| `calendar-*.ts` | Timezone, recorrência, mapa, facturas agendadas |
| `csv-import.ts` | Import CSV catálogo billing |
| `recibos-verdes-import.ts` | Parser CSV recibos verdes |
| `vat-pricing.ts` | Cálculos IVA |
| `tenant-branding.ts` | Limites upload logo |
| `moloni-redirect.ts` | URI callback Moloni |
| `search.ts` | Tipos pesquisa global |
| `config.client.ts` | `getWebConfig()` — vars `NEXT_PUBLIC_*` |
| `config.server.ts` | Config servidor (portas, paths) |

**Build obrigatório antes de API:** `npm run build -w @tvde/shared`

---

## 9. `packages/billing` — Moloni

| Caminho | Função |
|---------|--------|
| `src/providers/moloni/oauth.ts` | Fluxo OAuth2 Moloni |
| `src/providers/moloni/client.ts` | Chamadas API Moloni |
| `src/providers/moloni/provider.ts` | Interface `BillingProvider` |
| `src/providers/moloni/map-invoice.ts` | Mapeamento documentos |
| `src/calculations.ts` | Totais, IVA |
| `docs/FATURACAO.md` | Guia funcional |
| `docs/MOLONI.md` | Detalhes API Moloni |

Consumido por `apps/api/src/services/billing*.ts`.

---

## 10. `packages/database`

| Caminho | Função |
|---------|--------|
| `prisma/schema.prisma` | Schema completo |
| `prisma/seed.ts` | Seed TVDE |
| `src/index.ts` | `export const prisma` |

Cliente gerado em `node_modules/@prisma/client` após `npm run db:generate`.

---

## 11. Documentação em `docs/`

| Ficheiro | Tópico |
|----------|--------|
| `00-MAPA-DO-PROJECTO.md` | **Este ficheiro** |
| `06-seguranca-multitenancy.md` | RLS, isolamento tenant |
| `11-permissoes-roles-modulos.md` | Roles (contexto CMS; adaptar mentalmente para TVDE) |
| `12-calendario.md` | Calendário |
| `22-gestao-administrativa.md` | Admin mgmt |

---

## 12. Scripts npm (raiz)

| Comando | Acção |
|---------|-------|
| `npm install` | Instala todas as workspaces |
| `npm run dev` | Shared build + API + Web em paralelo |
| `npm run dev:api` | Só API |
| `npm run dev:web` | Só Web |
| `npm run build` | Build completo produção |
| `npm run docker:up` | Sobe Postgres + Redis |
| `npm run db:migrate:deploy` | Migrations em produção |
| `npm run db:seed` | Seed inicial |

---

## 13. Deploy em VPS virgem + Cloudflare Tunnel

### 13.1 Dependências no servidor

| Software | Versão mínima | Notas |
|----------|---------------|-------|
| **Node.js** | 20 LTS ou 22 | `node -v` |
| **npm** | 10+ | Vem com Node |
| **Docker** + **Docker Compose** | recente | Postgres + Redis |
| **cloudflared** | recente | Túnel Cloudflare |
| **git** | qualquer | Clonar/copiar projecto |
| **pm2** ou **systemd** | opcional | Manter API + Web activos |

Não é obrigatório nginx se usar só Cloudflare Tunnel para expor portas.

### 13.2 Passos de instalação

```bash
# 1. Copiar projecto (scp, git clone, rsync)
cd /var/www/tvde   # ou caminho escolhido

# 2. Ambiente
cp .env.example .env
nano .env   # preencher produção (ver secção 4)

# 3. Docker (BD + Redis)
docker compose up -d

# 4. Dependências Node
npm ci   # ou npm install

# 5. Build
npm run build

# 6. Base de dados
npm run db:migrate:deploy
npm run db:seed   # só primeira vez; depois remover passwords do .env

# 7. Pastas upload
mkdir -p uploads/branding uploads/calendar uploads/admin-mgmt
chown -R www-data:www-data uploads   # user do processo Node

# 8. Arrancar processos
# Opção A — pm2 (exemplo)
pm2 start apps/api/dist/index.js --name tvde-api
pm2 start apps/web/scripts/start.mjs --name tvde-web

# Opção B — systemd (criar units para api e web)
```

### 13.3 Cloudflare Tunnel (exemplo)

Ficheiro `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: app.seudominio.pt
    service: http://localhost:3003
  - hostname: api.seudominio.pt
    service: http://localhost:3002
  - service: http_status:404
```

Comandos:

```bash
cloudflared tunnel login
cloudflared tunnel create tvde
cloudflared tunnel route dns tvde app.seudominio.pt
cloudflared tunnel route dns tvde api.seudominio.pt
cloudflared tunnel run tvde
```

No `.env` de produção, todas as URLs públicas devem usar `https://app.seudominio.pt` e `https://api.seudominio.pt`.

**Health check API:** `GET https://api.seudominio.pt/health` → `{ "status": "ok" }`

### 13.4 Moloni em produção

1. Configurar app Moloni com redirect URI = `https://api.tvde.one/api/v1/billing/moloni/callback`
2. No dashboard: Config → Moloni → confirmar Redirect URI → Guardar → ligar conta por workspace
3. Cron sync (opcional): chamar `POST /api/v1/billing/sync/cron` com header `X-Billing-Sync-Secret`

### 13.5 Checklist pós-deploy

- [ ] Login MASTER funciona
- [ ] CORS sem erros no browser (origem = `WEB_PUBLIC_URL`)
- [ ] Redis ligado (sem aviso fail2ban no log)
- [ ] Migrations aplicadas (`_prisma_migrations` na BD)
- [ ] Uploads gravam em disco
- [ ] Moloni callback com URL pública HTTPS

---

## 14. Guia rápido: «Onde altero X?»

| Pedido típico | Onde mexer |
|---------------|------------|
| Nova role ou label | `packages/shared/src/roles.ts`, `permissions.ts`, `users/page.tsx` |
| Novo item no menu | `apps/web/.../dashboard-shell.tsx`, `packages/shared/src/routes.ts` |
| Nova página dashboard | `apps/web/src/app/dashboard/.../page.tsx` + rota em `routes.ts` |
| Novo endpoint API | `apps/api/src/routes/*.ts` + `services/*.ts` + registar em `app.ts` |
| Nova tabela BD | `schema.prisma` → `npm run db:migrate` (migration aditiva) |
| Novo módulo activável | `seed.ts` (`BUSINESS_MODULES`), `module-access.ts`, `app.ts` routes |
| Permissão por área | `packages/shared/src/permissions.ts` → `DASHBOARD_ACCESS` |
| Textos / emails | `apps/api/src/services/*-email-template.ts`, `email.service.ts` |
| Estilos globais / botões | `apps/web/src/app/globals.css`, Tailwind nas páginas |
| Variáveis ambiente novas | `.env.example`, `packages/shared/src/config.server.ts` |
| Moloni / facturação | `packages/billing/`, `apps/api/src/services/billing*.ts`, `components/billing/` |
| Calendário | `apps/api/src/services/calendar/`, `components/calendar/` |
| Gestão administrativa | `admin-mgmt.routes.ts`, `admin-mgmt-*.service.ts`, `components/admin-mgmt/` |
| Credenciais demo | `.env` + `packages/database/prisma/seed.ts` |
| Re-sync código CMS | `scripts/bootstrap-from-cms.sh` + `scripts/prune-modules.sh` |

---

## 15. Fluxo de dados (autenticação)

```
Browser → POST /api/v1/auth/login
       → JWT access + refresh (localStorage via api.ts)
       → GET /api/v1/auth/me (role, tenant, capabilities)
       → dashboard-shell filtra menu por role + activeModules
       → Cada request API: Header Authorization: Bearer <token>
       → auth.plugin valida JWT + session na tabela sessions
       → module.plugin verifica tenant_modules + workspace_modules
```

---

## 16. Portas e processos (resumo)

| Serviço | Porta local | Container / processo |
|---------|-------------|----------------------|
| Web Next.js | 3003 | `npm run dev:web` |
| API Fastify | 3002 | `npm run dev:api` |
| PostgreSQL | 5433 → 5432 | `tvde_postgres` |
| Redis | 6380 → 6379 | `tvde_redis` |

Em produção na VPS, Cloudflare Tunnel expõe 3002/3003 com hostnames públicos.

---

## 17. Manutenção e evolução

- **Alterações de schema:** sempre migrations aditivas; nunca apagar dados.
- **Código partilhado API/Web:** preferir `packages/shared` a duplicar.
- **URLs:** uma única fonte em `packages/shared/src/routes.ts`.
- **Independência CMS:** pacotes `@tvde/*`; não importar `@cms/*`.
- **Tabelas legado:** podem ser ignoradas até refactor de schema dedicado TVDE.

---

*Última actualização: reflecte o estado do projecto após bootstrap a partir do CMS com módulos TVDE (Facturação, Calendário, Gestão Administrativa, Core).*
