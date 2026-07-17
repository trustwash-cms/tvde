# Módulo Bolt — Documentação TVDE

**Versão:** 2.0 (implementação TVDE)  
**Última actualização:** 2026-07-14  
**Documentação oficial Bolt:** [Fleet Integration Gateway API](https://apidocs.bolt.eu/fleetIntegration/fleetIntegrationGatewayAuth/#/)

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Arquitectura](#2-arquitectura)
3. [Multitenancy e roles](#3-multitenancy-e-roles)
4. [Activação do módulo](#4-acção-do-módulo)
5. [Configuração (Fleet Portal)](#5-configuração-fleet-portal)
6. [API externa Bolt](#6-api-externa-bolt)
7. [Pacote `@tvde/bolt`](#7-pacote-tvdebolt)
8. [Base de dados](#8-base-de-dados)
9. [Sincronização](#9-sincronização)
10. [API interna TVDE](#10-api-interna-tvde)
11. [Interface web](#11-interface-web)
12. [Segurança](#12-segurança)
13. [Monitorização e health](#13-monitorização-e-health)
14. [Troubleshooting](#14-troubleshooting)
15. [Referência de ficheiros](#15-referência-de-ficheiros)

---

## 1. Visão geral

O módulo **Bolt** integra a plataforma TVDE com a **Bolt Fleet Integration API**, permitindo:

- Sincronizar **pedidos** (orders / viagens)
- Sincronizar **motoristas** (drivers)
- Sincronizar **veículos** (vehicles)
- Visualizar estatísticas e listagens no dashboard
- Configurar credenciais OAuth por **workspace**
- Sincronização **automática 1×/dia** + **manual** + **cron externo**

### Características

| Característica | Descrição |
|----------------|-----------|
| Isolamento | Módulo independente (`packages/bolt`, rotas/serviços/UI dedicados) |
| Multitenancy | Dados e credenciais por **workspace** (não por `site_id` PHP legado) |
| Credenciais | Client ID + Client Secret encriptados (AES-256-GCM) |
| Sync incremental | Timestamps separados por tipo (`orders`, `drivers`, `vehicles`) |
| Roles TVDE | Respeita hierarquia `master → superadmin → admin → staff` |

### O que **não** faz (v1)

- Página de detalhe de pedido na UI (API `GET /bolt/orders/:id` já existe)
- UI de logs de sync (API `GET /bolt/sync-logs` já existe)
- Webhooks Bolt em tempo real (apenas polling/sync)

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        Bolt Fleet Portal                         │
│              (credenciais OAuth: Client ID / Secret)             │
└────────────────────────────┬────────────────────────────────────┘
                             │ OAuth 2.0 Client Credentials
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API externa Bolt                             │
│   https://node.bolt.eu/fleet-integration-gateway               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  packages/bolt          Cliente TypeScript (BoltFleetClient)    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/api               Serviços + rotas + worker diário          │
│  - bolt-connection.service.ts                                   │
│  - bolt.service.ts                                              │
│  - bolt-sync.service.ts                                         │
│  - bolt.routes.ts / bolt-sync-cron.routes.ts                    │
│  - bolt-daily-sync.worker.ts                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL             bolt_* tables (por workspace)           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/web               Dashboard, listagens, Configurações       │
└─────────────────────────────────────────────────────────────────┘
```

### Estrutura de pastas

```
packages/bolt/
├── src/
│   ├── client.ts           # BoltFleetClient — OAuth + chamadas API
│   ├── types.ts            # Tipos partilhados
│   ├── api-envelope.ts     # Parse { code, message, data }
│   ├── parse-companies.ts  # Normalização company_ids / JWT
│   └── index.ts

apps/api/src/
├── services/
│   ├── bolt-connection.service.ts
│   ├── bolt.service.ts
│   └── bolt-sync.service.ts
├── routes/
│   ├── bolt.routes.ts
│   └── bolt-sync-cron.routes.ts
└── workers/
    └── bolt-daily-sync.worker.ts

apps/web/src/
├── app/dashboard/bolt/           # Módulo Bolt (subnav)
│   ├── layout.tsx
│   ├── page.tsx                  # Dashboard
│   ├── orders/page.tsx
│   ├── drivers/page.tsx
│   └── vehicles/page.tsx
├── app/dashboard/settings/bolt/  # Configurações → Bolt API
│   └── page.tsx
└── components/bolt/
    ├── bolt-sub-nav.tsx
    └── bolt-settings-panel.tsx

packages/database/prisma/
├── schema.prisma                 # Models Bolt*
└── migrations/20260714190000_bolt_module/
```

---

## 3. Multitenancy e roles

### Escopo de dados

| Nível | Campo | Função |
|-------|-------|--------|
| **Tenant** | `tenant_id` | Módulo activo no tenant (MASTER activa) |
| **Workspace** | `workspace_id` | Credenciais OAuth + dados sincronizados |

Cada **workspace** tem no máximo **uma** ligação Bolt (`bolt_connections.workspace_id` UNIQUE).

### Permissões

| Acção | Role mínima | Notas |
|-------|-------------|-------|
| Ver dashboard / pedidos / motoristas / veículos | `staff` | Requer módulo activo no workspace |
| Configurar API, testar ligação, sync manual | `superadmin` (Gestor de Frota) | Configurações → Bolt API |
| Activar módulo no tenant | `master` | Tenants → módulos |
| Activar módulo no workspace | `superadmin` | Workspaces → módulos |

Definição em `packages/shared/src/permissions.ts`:

```typescript
DASHBOARD_ACCESS.bolt = 'staff'
```

Rotas de config/sync usam `fastify.requireRole('superadmin')`.

---

## 4. Activação do módulo

### Passo 1 — Registo do módulo (BD)

O módulo está registado no seed (`packages/database/prisma/seed.ts`):

```typescript
{ key: 'bolt', name: 'Bolt', description: 'Integração API Bolt — pedidos, motoristas e veículos' }
```

Migration: `20260714190000_bolt_module`

```bash
npm run db:migrate:deploy   # ou db:migrate em dev
npm run db:seed             # regista módulo no registry
```

### Passo 2 — MASTER: activar no tenant

1. Dashboard → **Tenants**
2. Editar tenant → activar módulo **Bolt**

### Passo 3 — Gestor de Frota: activar no workspace

1. Dashboard → **Workspaces** (ou Configurações → Módulos)
2. Activar **Bolt** no workspace desejado

### Passo 4 — Configurar credenciais

1. **Configurações → Bolt API**
2. Seleccionar workspace
3. Inserir **Client ID** e **Client Secret**
4. (Opcional) **ID Empresa Bolt** se a API não devolver automaticamente
5. **Testar ligação** → **Guardar configuração**
6. **Sincronizar tudo** (manual)

---

## 5. Configuração (Fleet Portal)

### Obter credenciais

1. Login em [Bolt Fleet Portal](https://fleets.bolt.eu/login)
2. **Definições** (ícone utilizador) → separador **API**
3. **Generate credentials** (ou **Renew** se já existirem)
4. Copiar **Client ID** e **Secret**

> Renovar credenciais invalida as anteriores. Actualizar sempre na TVDE após renew.

### Campos na TVDE

| Campo UI | Campo BD | Obrigatório |
|----------|----------|-------------|
| Client ID | `bolt_connections.client_id` | Sim |
| Client Secret | `bolt_connections.encrypted_client_secret` | Sim (1.ª vez) |
| ID Empresa Bolt | `bolt_connections.bolt_company_id` | Auto ou manual |

O **ID Empresa** corresponde ao `company_id` da API Bolt (ex.: coluna **Empresa** nas listagens — `789`).

### Teste de ligação

Fluxo (`BoltFleetClient.testConnection`):

1. OAuth → `access_token`
2. `GET /fleetIntegration/v1/getCompanies` → `data.company_ids[]`
3. Fallback: claims JWT
4. Fallback: validar ID manual via `getDrivers`
5. Guardar `bolt_company_id` na ligação

---

## 6. API externa Bolt

**Base URL:** `https://node.bolt.eu/fleet-integration-gateway`  
**Token URL:** `https://oidc.bolt.eu/token`  
**Scope:** `fleet-integration:api`  
**Auth:** Bearer JWT (OAuth 2.0 Client Credentials)

Documentação OpenAPI:  
https://apidocs.bolt.eu/fleetIntegration/fleetIntegrationGatewayAuth/open-api.json

### Formato de resposta

Todas as respostas seguem o envelope:

```json
{
  "code": 0,
  "message": "OK",
  "data": { ... }
}
```

`code !== 0` → erro de negócio (ex.: `498807 COMPANY_NOT_FOUND`).

### Endpoints utilizados

| Método | Path | Função |
|--------|------|--------|
| — | `POST https://oidc.bolt.eu/token` | OAuth token |
| **GET** | `/fleetIntegration/v1/getCompanies` | Lista `company_ids` autorizados |
| POST | `/fleetIntegration/v1/getFleetOrders` | Pedidos por intervalo temporal |
| POST | `/fleetIntegration/v1/getDrivers` | Motoristas |
| POST | `/fleetIntegration/v1/getVehicles` | Veículos |

> **Importante:** `getCompanies` é **GET**, não POST. POST devolve 404.

### getCompanies

**Request:** sem body  
**Response:**

```json
{
  "code": 0,
  "message": "OK",
  "data": {
    "company_ids": [789]
  }
}
```

### getFleetOrders

**Body:**

```json
{
  "company_id": 789,
  "company_ids": [789],
  "start_ts": 1700000000,
  "end_ts": 1700100000,
  "time_range_filter_type": "created",
  "offset": 0,
  "limit": 1000
}
```

| Parâmetro | Tipo | Notas |
|-----------|------|-------|
| `start_ts` / `end_ts` | Unix seconds | Intervalo de pesquisa |
| `time_range_filter_type` | `"created"` \| `"price_review"` | Default: `created` |
| `limit` | 1–1000 | Paginação |
| `offset` | ≥ 0 | Paginação |

**Response `data`:**

```json
{
  "company_id": 789,
  "company_name": "...",
  "total_orders": 100,
  "orders": [ ... ]
}
```

Campos principais por pedido: `order_reference`, `driver_name`, `driver_uuid`, `order_status`, `vehicle_model`, `order_created_timestamp`, `order_stops[]`, `order_price.ride_price`.

### getDrivers

**Body:**

```json
{
  "company_id": 789,
  "start_ts": 1700000000,
  "end_ts": 1700100000,
  "portal_status": "active",
  "offset": 0,
  "limit": 1000
}
```

Campos API: `driver_uuid`, `first_name`, `last_name`, `phone`, `email`, `state`.

### getVehicles

**Body:**

```json
{
  "company_id": 789,
  "start_ts": 1700000000,
  "end_ts": 1700100000,
  "portal_status": "active",
  "offset": 0,
  "limit": 100
}
```

| Parâmetro | Notas |
|-----------|-------|
| `limit` | Máximo **100** (API Bolt) |

Campos API: `id` (car_id), `model`, `year`, `reg_number`, `vin`, `uuid`, `state`.

### Códigos de erro Bolt (referência)

| Código | Significado |
|--------|-------------|
| 498805 | INVALID_START_DATE |
| 498806 | INVALID_DATE_RANGE |
| 498807 | COMPANY_NOT_FOUND |
| 498809 | COMPANY_NOT_ACTIVE / COMPANIES_NOT_ACTIVE |
| 498810 | COMPANY_NOT_ALLOWED |

---

## 7. Pacote `@tvde/bolt`

### BoltFleetClient

```typescript
import { BoltFleetClient, computeSyncWindow } from '@tvde/bolt';

const client = new BoltFleetClient({
  clientId: '...',
  clientSecret: '...',
  // opcionais:
  tokenUrl: 'https://oidc.bolt.eu/token',
  baseUrl: 'https://node.bolt.eu/fleet-integration-gateway',
  scope: 'fleet-integration:api',
});
```

| Método | Descrição |
|--------|-----------|
| `testConnection({ companyId? })` | OAuth + resolve `company_id` |
| `getCompanies()` | `GET getCompanies` → `BoltCompany[]` |
| `getFleetOrders({ companyId, startTs, endTs })` | Paginação automática |
| `getDrivers(...)` | Paginação automática |
| `getVehicles(...)` | Paginação automática (limit 100) |
| `validateCompanyAccess(companyId)` | Testa acesso via getDrivers |

### computeSyncWindow

Calcula intervalo Unix para sync incremental:

| Cenário | Comportamento |
|---------|---------------|
| Primeira sync (`lastSyncAt` null) | Últimos **30 dias** |
| Sync subsequente | Desde `lastSyncAt - 5 min` até agora |
| `lastSyncAt` no futuro | Trata como primeira sync (30 dias) |

```typescript
const { startTs, endTs } = computeSyncWindow(row.lastSyncAtOrders);
```

### Build

```bash
npm run build -w @tvde/bolt
```

---

## 8. Base de dados

Migration: `packages/database/prisma/migrations/20260714190000_bolt_module/`

### bolt_connections

Credenciais e estado da integração (1 por workspace).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | UUID | PK |
| `workspace_id` | UUID | UNIQUE — workspace |
| `tenant_id` | UUID | Tenant |
| `client_id` | TEXT | Client ID Bolt |
| `encrypted_client_secret` | TEXT | Secret encriptado |
| `bolt_company_id` | INT | ID empresa na Bolt |
| `is_active` | BOOL | Integração activa |
| `last_sync_at_orders` | TIMESTAMP | Última sync pedidos |
| `last_sync_at_drivers` | TIMESTAMP | Última sync motoristas |
| `last_sync_at_vehicles` | TIMESTAMP | Última sync veículos |
| `last_error` | TEXT | Último erro |
| `connected_at` | TIMESTAMP | 1.ª ligação OK |

### bolt_orders

| Coluna | Descrição |
|--------|-----------|
| `order_reference` | UNIQUE por workspace — chave Bolt |
| `driver_name`, `driver_uuid`, `driver_phone` | Motorista |
| `order_status` | ex.: `finished` |
| `vehicle_model`, `vehicle_license_plate` | Veículo |
| `order_created_timestamp` | Data criação (UTC) |
| `ride_price`, `booking_fee`, `toll_fee` | Preços |
| `raw_json` | Payload completo da API |
| `bolt_company_id` | ID empresa Bolt |

**Índices:** `(workspace_id, order_created_timestamp)`, UNIQUE `(workspace_id, order_reference)`

### bolt_order_stops

Paradas por pedido (pickup/dropoff/waypoint).

| Coluna | Descrição |
|--------|-----------|
| `order_id` | FK → bolt_orders |
| `stop_type` | pickup, dropoff, etc. |
| `lat`, `lng`, `real_lat`, `real_lng` | Coordenadas |
| `stop_order` | Ordem da parada |

> Paradas são **substituídas** em cada sync do pedido (`deleteMany` + `createMany`).

### bolt_drivers

| Coluna | Descrição |
|--------|-----------|
| `driver_uuid` | UNIQUE por workspace |
| `name` | `first_name + last_name` da API |
| `phone`, `email` | Contacto |
| `portal_status` | ex.: `active` |
| `partner_uuid` | UUID parceiro |

### bolt_vehicles

| Coluna | Descrição |
|--------|-----------|
| `vehicle_id` | UNIQUE por workspace — `id` API Bolt |
| `model`, `year`, `reg_number`, `vin`, `uuid` | Dados veículo |
| `state`, `portal_status` | Estado |

### bolt_sync_logs

Histórico de sincronizações.

| Coluna | Descrição |
|--------|-----------|
| `sync_type` | `orders`, `drivers`, `vehicles`, `all` |
| `status` | `success` \| `error` |
| `records_synced/created/updated` | Contadores |
| `error_message` | Se falhou |
| `started_at`, `completed_at`, `duration_seconds` | Timing |

---

## 9. Sincronização

### Tipos

| Tipo | Função |
|------|--------|
| `orders` | `syncBoltOrders` |
| `drivers` | `syncBoltDrivers` |
| `vehicles` | `syncBoltVehicles` |
| `all` | Sequencial: orders → drivers → vehicles |

### Lógica upsert

| Entidade | Chave única | Acção |
|----------|-------------|-------|
| Pedido | `workspace_id + order_reference` | INSERT ou UPDATE |
| Motorista | `workspace_id + driver_uuid` | INSERT ou UPDATE |
| Veículo | `workspace_id + vehicle_id` | INSERT ou UPDATE |

### Automática (worker interno)

Ficheiro: `apps/api/src/workers/bolt-daily-sync.worker.ts`

- Arranca com a API (`startBoltDailySyncWorker()` em `apps/api/src/index.ts`)
- Corre **imediatamente** ao iniciar + **a cada 24h**
- Sincroniza todos os workspaces com:
  - `bolt_connections.is_active = true`
  - `bolt_company_id` definido
  - módulo `bolt` activo no workspace

Log: `[bolt-worker] daily sync: ...`

### Manual (UI)

**Configurações → Bolt API** → botões:

- Sincronizar orders / drivers / vehicles / tudo

Endpoint: `POST /api/v1/bolt/sync`

### Cron externo (opcional)

Rotas sem JWT — autenticação via header:

```
X-Billing-Sync-Secret: <BILLING_SYNC_SECRET>
```

| Método | Path | Sync |
|--------|------|------|
| POST | `/api/v1/bolt/cron/sync/orders` | orders |
| POST | `/api/v1/bolt/cron/sync/drivers` | drivers |
| POST | `/api/v1/bolt/cron/sync/vehicles` | vehicles |
| POST | `/api/v1/bolt/cron/sync/all` | all |

Query opcional: `?workspaceId=<uuid>` — sync de um workspace; omitir = todos.

Exemplo crontab:

```bash
0 3 * * * curl -s -X POST "https://api.seudominio.pt/api/v1/bolt/cron/sync/all" \
  -H "X-Billing-Sync-Secret: SEU_SECRET"
```

Variável `.env`: `BILLING_SYNC_SECRET` (partilhada com sync Moloni/billing).

---

## 10. API interna TVDE

Prefixo: `/api/v1`  
Autenticação: JWT (`Authorization: Bearer`)  
Módulo: `requireModule('bolt')` em todas as rotas abaixo.

### Configuração e sync

| Método | Path | Role | Descrição |
|--------|------|------|-----------|
| GET | `/bolt/status?workspaceId=` | staff+ | Estado da ligação |
| PUT | `/bolt/config` | superadmin | Guardar credenciais |
| POST | `/bolt/test-connection` | superadmin | Testar OAuth + company |
| POST | `/bolt/sync` | superadmin | Sync manual |
| GET | `/bolt/sync-logs?workspaceId=` | superadmin | Últimos 50 logs |

#### PUT /bolt/config

```json
{
  "workspaceId": "uuid-opcional",
  "clientId": "...",
  "clientSecret": "...",
  "boltCompanyId": 789
}
```

`clientSecret` opcional se já guardado (mantém o actual).

#### POST /bolt/test-connection

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "boltCompanyId": 789
}
```

Resposta:

```json
{
  "success": true,
  "data": {
    "companyId": 789,
    "companies": [{ "company_id": 789 }]
  }
}
```

#### POST /bolt/sync

```json
{
  "workspaceId": "uuid-opcional",
  "type": "all"
}
```

Resposta:

```json
{
  "success": true,
  "data": {
    "orders": { "synced": 100, "created": 5, "updated": 95, "skipped": 0 },
    "drivers": { ... },
    "vehicles": { ... }
  }
}
```

### Dados (leitura)

| Método | Path | Role | Query |
|--------|------|------|-------|
| GET | `/bolt/dashboard` | staff+ | `workspaceId` |
| GET | `/bolt/orders` | staff+ | `workspaceId`, `q`, `status` |
| GET | `/bolt/orders/:id` | staff+ | `workspaceId` |
| GET | `/bolt/drivers` | staff+ | `workspaceId`, `q`, `status` |
| GET | `/bolt/vehicles` | staff+ | `workspaceId`, `q`, `status` |

#### GET /bolt/dashboard

```json
{
  "ordersCount": 2206,
  "driversCount": 14,
  "vehiclesCount": 13,
  "totalRevenue": "3254.77",
  "recentOrders": [ ... ]
}
```

`totalRevenue` = soma de `ride_price` na BD local.

### GET /bolt/status

```json
{
  "configured": true,
  "connected": true,
  "healthy": true,
  "moduleAuthorized": true,
  "moduleActive": true,
  "clientId": "...",
  "boltCompanyId": 789,
  "statusMessage": "Operacional",
  "lastSyncAtOrders": "2026-01-16T19:49:00.000Z",
  "lastSyncAtDrivers": "...",
  "lastSyncAtVehicles": "..."
}
```

---

## 11. Interface web

### Navegação principal

Item **Bolt** no sidebar (`dashboard-shell.tsx`) — ícone Zap, `moduleKey: 'bolt'`.

### Subnav do módulo (estilo Gestão Administrativa)

Layout: `apps/web/src/app/dashboard/bolt/layout.tsx`

| Rota | Label |
|------|-------|
| `/dashboard/bolt` | Dashboard |
| `/dashboard/bolt/orders` | Pedidos |
| `/dashboard/bolt/drivers` | Motoristas |
| `/dashboard/bolt/vehicles` | Veículos |

- Cabeçalho com título + selector de **workspace** (partilhado)
- Subnav vertical à esquerda
- **Bolt API** não está no subnav — fica em **Configurações**

### Dashboard (`/dashboard/bolt`)

- 4 cards: pedidos, motoristas, veículos, receita total
- Tabela: pedidos recentes (últimos 10)

### Listagens

| Página | Filtros |
|--------|---------|
| Pedidos | busca (ref/motorista/veículo), status |
| Motoristas | busca (nome/telefone/email) |
| Veículos | busca (modelo/placa/VIN) |

### Configurações → Bolt API

Rota: `/dashboard/settings/bolt`  
Componente: `bolt-settings-panel.tsx`

- Credenciais OAuth por workspace
- Testar ligação / Guardar
- Sync manual (orders, drivers, vehicles, all)
- Estado da ligação e últimas syncs

Subnav Configurações: item **Bolt API** (`settings-sub-nav.tsx`, role `superadmin+`).

### Rotas partilhadas (`@tvde/shared`)

```typescript
WEB_ROUTES.dashboard.bolt.root          // /dashboard/bolt
WEB_ROUTES.dashboard.bolt.orders
WEB_ROUTES.dashboard.bolt.drivers
WEB_ROUTES.dashboard.bolt.vehicles
WEB_ROUTES.dashboard.settings.bolt      // /dashboard/settings/bolt

API_PATHS.bolt.status
API_PATHS.bolt.config
API_PATHS.bolt.testConnection
API_PATHS.bolt.sync
API_PATHS.bolt.dashboard
// ...
```

---

## 12. Segurança

### Encriptação de credenciais

- Algoritmo: **AES-256-GCM**
- Chave: `ENCRYPTION_KEY` no `.env` (32+ chars)
- Campo encriptado: `encrypted_client_secret`
- Implementação: `apps/api/src/lib/crypto.ts`

### Isolamento

- Todas as queries filtram por `workspace_id`
- JWT + `resolveWorkspaceTenantScope` valida acesso ao workspace
- `requireModule('bolt')` garante módulo activo

### Audit log

| Acção | Evento |
|-------|--------|
| Guardar config | `bolt.config_updated` |
| Sync manual | `bolt.sync_manual` |

### Cron externo

- Sem JWT — apenas `X-Billing-Sync-Secret`
- Reutiliza `BILLING_SYNC_SECRET` (mesmo padrão billing/Moloni)

---

## 13. Monitorização e health

`apps/api/src/services/module-health.service.ts`:

| Estado | Condição |
|--------|----------|
| `ok` | Configurado + ligado + sem `last_error` |
| `error` | Sem ligação / erro |
| — | Módulo não activo / não autorizado |

---

## 14. Troubleshooting

### `Route POST:/fleetIntegration/v1/getCompanies not found`

**Causa:** endpoint é **GET**, não POST.  
**Solução:** usar `@tvde/bolt` actualizado (`client.getCompanies()`).

### `Nenhuma empresa autorizada encontrada na API Bolt`

**Causas possíveis:**

1. Resposta `{ data: { company_ids: [] } }` — credenciais sem frota associada
2. Parsing incorrecto (versões antigas)

**Soluções:**

1. Indicar **ID Empresa Bolt** manualmente (número do Fleet Portal)
2. Verificar credenciais no portal Bolt (Renew + actualizar na TVDE)
3. Confirmar scope `fleet-integration:api`

### `Bolt OAuth falhou (401)`

- Client ID / Secret incorrectos ou revogados
- Regenerar no Fleet Portal → Settings → API

### `Bolt sem company_id`

- Testar ligação antes de sync
- Guardar configuração com secret preenchido

### Sync lenta na 1.ª vez

Normal — busca **30 dias** de histórico. Syncs seguintes são incrementais.

### `BILLING_SYNC_SECRET não configurado`

Cron externo requer variável no `.env`.

### Pedidos sem paradas

Verificar `order_stops` na resposta API; paradas são recriadas a cada sync.

### Timestamps / timezone

API Bolt usa **Unix UTC**. UI formata com `toLocaleString('pt-PT')`.

---

## 15. Referência de ficheiros

| Ficheiro | Responsabilidade |
|----------|------------------|
| `packages/bolt/src/client.ts` | Cliente API Bolt |
| `packages/bolt/src/api-envelope.ts` | Parse `{ code, message, data }` |
| `packages/bolt/src/parse-companies.ts` | Normalização company_ids |
| `apps/api/src/services/bolt-connection.service.ts` | CRUD ligação + encrypt |
| `apps/api/src/services/bolt.service.ts` | Status, save, test |
| `apps/api/src/services/bolt-sync.service.ts` | Sync + dashboard stats |
| `apps/api/src/routes/bolt.routes.ts` | Rotas autenticadas |
| `apps/api/src/routes/bolt-sync-cron.routes.ts` | Cron secret |
| `apps/api/src/workers/bolt-daily-sync.worker.ts` | Worker 24h |
| `apps/web/src/app/dashboard/bolt/layout.tsx` | Layout + subnav |
| `apps/web/src/components/bolt/bolt-settings-panel.tsx` | UI configuração |
| `packages/database/prisma/schema.prisma` | Models Bolt* |
| `packages/shared/src/routes.ts` | Rotas web + API |
| `packages/shared/src/permissions.ts` | Role mínima staff |

### Comandos úteis

```bash
# Build módulo
npm run build -w @tvde/bolt

# Migration
npm run db:migrate:deploy

# Seed (registo módulo)
npm run db:seed

# Dev
npm run dev
```

---

## Histórico

| Versão | Data | Alterações |
|--------|------|------------|
| 1.x | 2026-01 | Documentação projecto PHP legado (referência) |
| 2.0 | 2026-07-14 | Implementação TVDE: workspace multitenancy, `@tvde/bolt`, OpenAPI oficial, subnav lateral, settings separado |
