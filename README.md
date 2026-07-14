# TVDE — Plataforma de Gestão de Frota

Projecto independente do CMS, copiado e adaptado para gestão TVDE.

## Módulos activos

- **Core**: Auth, Tenancy, Workspaces, Audit
- **Facturação** (Moloni)
- **Calendário**
- **Gestão Administrativa**
- Clientes, Produtos, SMS (opcional)

## Roles TVDE

| Role interna | Etiqueta UI |
|--------------|-------------|
| `master` | MASTER |
| `superadmin` | Gestor de Frota |
| `admin` | Motorista |
| `staff` | Staff |

## Arranque local

```bash
cd /Applications/XAMPP/xamppfiles/htdocs/tvde
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

- API: http://localhost:3002
- Web: http://localhost:3003
- Postgres: porta **5433** (base `tvde`)
- Redis: porta **6380**

## Credenciais seed (`.env.example`)

| Utilizador | Email | Password |
|------------|-------|----------|
| MASTER | master@tvde.local | Master@123456 |
| Gestor de Frota | gestor@frota-demo.local | Gestor@123456 |
| Motorista | motorista@frota-demo.local | Motorista@123456 |

## Estrutura

```
tvde/
├── apps/api/          # Fastify API
├── apps/web/          # Next.js dashboard
├── packages/
│   ├── database/      # Prisma + migrations
│   ├── shared/        # Types, roles, routes
│   └── billing/       # Moloni
└── docs/              # Documentação copiada do CMS
```

## Sem dependência do CMS

- Packages `@tvde/*` (não `@cms/*`)
- Base de dados separada (`tvde` na porta 5433)
- Ports API/Web diferentes do CMS
