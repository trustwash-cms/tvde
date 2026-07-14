# 22 — Módulo Gestão Administrativa

Especificação do módulo **Gestão Administrativa** (`admin_mgmt`) — gestão interna de seguros, contratos, clientes, faturas emitidas/recebidas, vencimentos e conta corrente, independente da facturação Moloni.

**Estado:** Fase 1–2 implementada (Jul 2026).

Relacionado: [11 — Permissões](11-permissoes-roles-modulos.md) · [05 — Frontend](05-frontend.md) · [04 — API REST](04-api-rest.md) · [recibos-verdes.md](recibos-verdes.md) (importação CSV Portal Finanças) · [packages/billing/docs/FATURACAO.md](../packages/billing/docs/FATURACAO.md) (sync Moloni opcional)

---

## 1. Objectivos

| Área | Funcionalidade |
|------|----------------|
| **Dashboard** | Cards clicáveis (vencimentos, faturas pendentes/pagas, clientes) + pesquisa global no topo |
| **Seguros** | CRUD com matrícula, apólices PDF, listas configuráveis |
| **Contratos / SS / IRS / IVA / Recibos Verdes** | Entidades genéricas com anexos (fase 1) |
| **Clientes** | CRUD, importação de fontes externas, **conta corrente** com lançamentos |
| **Faturas** | CRUD manual, importação CSV Recibos Verdes, sync Moloni, PDF anexos, estados pagamento |
| **Vencimentos** | Gerados a partir de seguros/contratos/faturas; resolução manual |
| **Configurações** | Seguradoras, tipos produto, alertas, notificações, integrações Moloni, **PIN de Segurança** |

### Isolamento

- Módulo `admin_mgmt` — tabelas `admin_mgmt_*`
- API: `requireModule('admin_mgmt')` em `/admin-mgmt/*`
- **Não** substitui o módulo Facturação/Moloni; pode espelhar emissões Moloni (opcional)

---

## 2. Activação

| Camada | Quem | Onde |
|--------|------|------|
| Autorização | MASTER | Tenants → módulo Gestão Administrativa |
| Activação | superadmin | Configurações → Workspaces |
| Operação | staff+ | Menu → Gestão Administrativa |

Migration inicial: `20250705120000_admin_mgmt_module`.

### Sub-navegação (`/dashboard/admin-mgmt/*`)

| Item | Rota |
|------|------|
| Dashboard | `/dashboard/admin-mgmt` |
| Seguros | `/dashboard/admin-mgmt/seguros` |
| Contratos | `/dashboard/admin-mgmt/contratos` |
| Segurança Social | `/dashboard/admin-mgmt/seguranca-social` |
| Faturas | `/dashboard/admin-mgmt/faturas` |
| Clientes | `/dashboard/admin-mgmt/clientes` |
| Configurações | `/dashboard/admin-mgmt/configuracoes` |

Componente: `apps/web/src/components/admin-mgmt/admin-mgmt-sub-nav.tsx`

---

## 3. Clientes e conta corrente

### Clientes (`admin-mgmt-clientes-panel.tsx`)

- CRUD com NIF, contactos, notas
- Importação de cliente a partir de entidades Moloni / CarWash (quando módulos activos)
- Painel de detalhe com tabs: dados, lançamentos conta corrente

### Lançamentos manuais

| Funcionalidade | Detalhe |
|----------------|---------|
| Tipos | Crédito (entrada) / Débito (saída) |
| Alocação inteligente | Preview antes de confirmar: liquida fatura mais antiga pendente; remanescente fica na conta |
| Eliminar lançamento | Reverte alocação (marca fatura como pendente **sem PIN** — acção interna) |

API:

- `GET/POST /admin-mgmt/clientes/:id/lancamentos`
- `POST /admin-mgmt/clientes/:id/lancamentos/preview`
- `DELETE /admin-mgmt/clientes/:clienteId/lancamentos/:lancamentoId`

Migrations: `20250706140000_admin_mgmt_cliente_lancamentos`, `20250706200000_admin_mgmt_lancamento_alocacao`

---

## 4. Faturas

Caminho: **Gestão Administrativa → Faturas**

### Listagem

| Coluna / funcionalidade | Detalhe |
|-------------------------|---------|
| Cliente, N.º, Tipo, **Emissão**, Vencimento, Total, Estado | Listagem principal |
| Alerta | Toggle notificação ao cliente no vencimento (email/WhatsApp) |
| PDF | Até 3 anexos por fatura |
| Pesquisa | Barra abaixo dos filtros — pesquisa em todos os campos visíveis |
| Selecção | Checkbox por linha + seleccionar todas visíveis |
| Exportação | **Excel** (`.xlsx`) e **PDF** — exporta selecção ou todas as filtradas |
| Acções | Marcar pago; **marcar pendente** (faturas pagas); eliminar |

Filtros rápidos: Todas · Pendentes · Pagas (`?estado=pendente|pago`).

### Importação Recibos Verdes (CSV SIRE)

Botão na listagem de faturas. Fluxo preview → confirmar.

Documentação completa: [recibos-verdes.md](recibos-verdes.md)

| Endpoint | Uso |
|----------|-----|
| `POST /admin-mgmt/importacoes/recibos-verdes/preview` | Multipart CSV |
| `POST /admin-mgmt/importacoes/recibos-verdes/confirm` | Confirma importação |
| `GET /admin-mgmt/importacoes/recibos-verdes` | Histórico |

- Cria cliente se NIF não existir
- `origem = importacao_recibos_verdes`, `origemExternaId` = referência SIRE
- Faturas-recibo importadas como **pagas** por defeito

Migration: `20250707090000_admin_mgmt_fatura_origem_importacoes`

### Reverter pagamento (marcar pendente)

Acção manual **exige PIN de Segurança** definido em Configurações.

| Endpoint | Body |
|----------|------|
| `POST /admin-mgmt/faturas/:id/mark-pending` | `{ pin: "1234" }` |

Erros: PIN não configurado, PIN incorrecto, fatura não encontrada.

Reversão automática (eliminar lançamento na conta corrente) **não** exige PIN.

### Sync Moloni → admin_mgmt

Após `issueInvoiceToMoloni` no módulo Facturação, opcionalmente espelha cliente + fatura.

Configuração: **Configurações → Integrações**

| Opção | Efeito |
|-------|--------|
| Sincronizar emissões Moloni | Cria/atualiza em admin_mgmt |
| Marcar faturas-recibo como pagas | Estado `pago` na importação |

Serviço: `admin-mgmt-moloni-sync.service.ts` (hook em `billing.service.ts`)

---

## 5. Configurações

Tabs em `admin-mgmt-settings-panel.tsx`:

| Tab | Conteúdo |
|-----|----------|
| Seguradoras | Lista para formulário de seguros |
| Tipos de produto | Lista (ex.: «Automóvel» activa matrícula) |
| Alertas | Dias antecedência, responsável por defeito |
| Notificações | Email/WhatsApp destino + testes |
| Integrações | Sync Moloni (ver secção 4) |
| **PIN de Segurança** | PIN numérico 4–12 dígitos (bcrypt em `workspaceModule.configJson`) |

O PIN **nunca** é mostrado após guardar; só `securityPinConfigured: true/false` na API.

---

## 6. Seguros, vencimentos e dashboard

### Seguros

- Matrícula (quando tipo = Automóvel), apólices com upload PDF
- Gera vencimentos automáticos conforme dias de alerta

### Vencimentos

- Lista unificada com origem (seguro, contrato, fatura)
- Resolver / reabrir manualmente

### Dashboard principal (`admin-mgmt-dashboard-panel.tsx`)

- Cards de vencimentos e faturas com links filtrados
- Integrado no dashboard global do CMS (cards de módulos + eventos futuros)

---

## 7. Base de dados (migrations)

| Migration | Conteúdo |
|-----------|----------|
| `20250705120000_admin_mgmt_module` | Tabelas base + módulo registry |
| `20250705140000_admin_mgmt_seguro_matricula_apolices` | Matrícula seguros + apólices |
| `20250705200000_admin_mgmt_faturas_clientes` | Faturas e clientes admin_mgmt |
| `20250706120000_admin_mgmt_fatura_notificar_cliente` | Flag `notificar_cliente` em faturas |
| `20250706140000_admin_mgmt_cliente_lancamentos` | Conta corrente |
| `20250706200000_admin_mgmt_lancamento_alocacao` | Alocação lançamento → fatura |
| `20250707090000_admin_mgmt_fatura_origem_importacoes` | Origem importação + tabela importações |

Tabelas principais: `admin_mgmt_clientes`, `admin_mgmt_faturas`, `admin_mgmt_seguros`, `admin_mgmt_vencimentos`, `admin_mgmt_cliente_lancamentos`, `admin_mgmt_importacoes_financas`, …

Ver `packages/database/prisma/schema.prisma`.

---

## 8. API (resumo)

Prefixo: `/api/v1/admin-mgmt/*` — JWT + `requireModule('admin_mgmt')`.

| Área | Paths principais |
|------|------------------|
| Dashboard | `GET /admin-mgmt/dashboard` |
| Settings | `GET/PUT /admin-mgmt/settings` |
| Clientes | `GET/POST /admin-mgmt/clientes`, `/:id`, lançamentos |
| Faturas | `GET/POST /admin-mgmt/faturas`, `/:id`, mark-paid, mark-pending, anexos |
| Importação | `POST .../recibos-verdes/preview|confirm` |
| Seguros | `GET/POST /admin-mgmt/seguros`, apólices |
| Vencimentos | `GET /admin-mgmt/vencimentos`, resolve/reopen |

Rotas completas: `packages/shared/src/routes.ts` → `API_PATHS.adminMgmt`

---

## 9. Ficheiros principais

| Área | Path |
|------|------|
| Rotas API | `apps/api/src/routes/admin-mgmt.routes.ts` |
| Serviços | `apps/api/src/services/admin-mgmt-*.service.ts` |
| UI painéis | `apps/web/src/components/admin-mgmt/*` |
| Shared | `packages/shared/src/admin-mgmt.ts`, `recibos-verdes-import.ts` |
| Export Excel faturas | `apps/web/src/lib/admin-mgmt-fatura-export.ts` |

---

## 10. Testes manuais sugeridos

1. Activar módulo no workspace → menu Gestão Administrativa visível
2. Importar CSV Recibos Verdes → preview → confirmar → clientes/faturas criados
3. Lançamento conta corrente com alocação → fatura mais antiga liquidada
4. Marcar fatura paga → tentar marcar pendente sem PIN (erro) → definir PIN → reverter com PIN
5. Pesquisa + selecção + export Excel/PDF na listagem de faturas
6. Sync Moloni (se billing activo) → fatura espelhada em admin_mgmt

---

*Última actualização: Jul 2026 — fase 2 (faturas, clientes, importação CSV, PIN, exportação, conta corrente).*
