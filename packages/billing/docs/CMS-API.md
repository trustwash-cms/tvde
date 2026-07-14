# CMS — API REST Facturação

Prefixo: `/api/v1`  
Módulo: `billing` (activo no tenant + workspace)  
Auth: `Authorization: Bearer {jwt}` (excepto callback OAuth e cron sync)

**Documentação relacionada:** [FATURACAO.md](./FATURACAO.md) · [ENTITIES.md](./ENTITIES.md) · [EMAIL.md](./EMAIL.md) · [MOLONI.md](./MOLONI.md)

---

## Respostas

Formato padrão:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "mensagem" }
```

---

## Faturas

### `GET /invoices`

Lista paginada de documentos.

| Query | Tipo | Descrição |
|-------|------|-----------|
| `workspaceId` | uuid | Opcional (scope do utilizador) |
| `documentType` | string | `invoice`, `simplified_invoice`, `invoice_receipt`, `debit_note` |
| `q` | string | Pesquisa número / entidade |
| `page` | int | Página (0-based, default 0) |
| `limit` | int | Itens por página (default 20, máx. 50) |

**Resposta:**

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "total": 71,
    "page": 0,
    "limit": 20
  }
}
```

Cada item inclui `billingEntity` (com `email`), `client` (com `email`), `lines`, `emailSentAt`, **`issuedAt`** (data fiscal), `createdAt` (sync/criação CMS).

Ordenação por defeito: `issuedAt` desc, `createdAt` desc.

### `GET /invoices/:id`

Detalhe de um documento (rascunho ou emitido) com linhas e metadata.

**Uso:** carregar rascunho na UI (`?draft=` nas páginas de criação).

**Resposta:** `200` — objecto invoice completo (`lines`, `metadataJson`, `billingEntity`, …).

**Erros:** `404` documento inexistente.

### `POST /invoices`

Cria rascunho local (`status=draft`, `provider=local`).

**Body:**

```json
{
  "billingEntityId": "uuid",
  "clientId": "uuid",
  "documentType": "invoice",
  "entityType": "customer",
  "issueDate": "2026-06-09",
  "dueDate": "2026-07-09",
  "documentSetId": 123,
  "notes": "opcional",
  "metadata": {
    "expirationDate": "2026-07-09",
    "yourReference": "",
    "ourReference": "",
    "financialDiscount": 0,
    "specialDiscount": 0,
    "deliveryDepartureAddress": "",
    "deliveryDestinationAddress": ""
  },
  "lines": [
    {
      "description": "Serviço",
      "quantity": 1,
      "unitPrice": 100,
      "vatRate": 23,
      "moloniProductId": 456,
      "moloniTaxId": 1
    }
  ]
}
```

| Campo | Obrigatório |
|-------|-------------|
| `billingEntityId` **ou** `clientId` | Sim (um dos dois) |
| `lines` | Sim (mín. 1) |

`clientId` legacy cria/liga `billing_entity` automaticamente.

**Resposta:** `201` com fatura completa.

**Audit:** `invoice.create`

### `PATCH /invoices/:id`

Actualiza **rascunho** existente (`status` tem de ser `draft`).

**Body:** igual a `POST /invoices` (sem `workspaceId` obrigatório no path — scope via invoice).

| Campo | Notas |
|-------|-------|
| `lines` | Substitui todas as linhas (delete + recreate) |
| `metadata` | Merge com campos Moloni (série, entrega, descontos) |
| `billingEntityId` | Entidade fiscal |

**Resposta:** `200` com fatura actualizada.

**Erros:** documento emitido, entidade em falta, validação linhas.

**Audit:** `invoice.update_draft`

**Uso típico:** editar rascunho duplicado antes de `POST /invoices/:id/issue`.

### `POST /invoices/:id/duplicate`

Cria **novo rascunho** espelhando um documento existente (comportamento equivalente ao botão Duplicar do Moloni).

**Pré-requisitos:**

- Documento origem com `billing_entity_id` (ou cliente resolvível)
- Linhas: na BD **ou** fetch Moloni `getOne` se `external_id` + `provider=moloni`

**Fluxo interno:**

1. `GET` invoice origem + linhas
2. Se sem linhas → `MoloniClient.getDocument(documentType, company_id, document_id)`
3. `mapMoloniProductsToInvoiceLines()` + `metadataFromMoloniDocument()`
4. `createInvoice()` — `status=draft`, `issueDate`/`expirationDate` = hoje

**Resposta:** `201`

```json
{
  "success": true,
  "data": {
    "id": "novo-uuid",
    "documentType": "invoice",
    "status": "draft",
    "lines": [ ... ]
  },
  "message": "Rascunho criado a partir do documento"
}
```

**UI:** redirect para `getBillingDocumentEditPath(documentType, data.id)` → ex. `/dashboard/billing/faturas?draft=novo-uuid`.

**Erros:**

| Mensagem | Causa |
|----------|-------|
| `Documento sem entidade` | Sem `billing_entity_id` |
| `Documento sem linhas` | Sem linhas BD e sem `external_id` Moloni |
| `Documento Moloni sem artigos` | `getOne` devolveu `products` vazio |
| `Moloni não configurado` | Token/company em falta no fetch |

**Audit:** `invoice.duplicate` — `afterJson: { sourceInvoiceId, documentType }`

### `POST /invoices/:id/issue`

Emite rascunho no Moloni.

- Endpoint Moloni conforme `document_type`
- Actualiza: `status=issued`, `provider=moloni`, `external_id`, `number`, `issued_at`
- Faz push da entidade se sem `external_id`

**Erros:** rascunho inexistente, Moloni desligado, validação Moloni (`valid: 0`)

**Audit:** `invoice.issue_moloni`

### `GET /invoices/:id/pdf`

Descarrega PDF binário (não JSON).

**Headers resposta:**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="fatura-M-1.pdf"
```

**Erros:** rascunho, sem `external_id`, PDF indisponível Moloni

### `POST /invoices/:id/send-email`

Envia fatura por email com PDF em anexo.

**Pré-requisitos:** emitida, email destinatário, SMTP configurado

**Resposta:**

```json
{
  "success": true,
  "data": { "id": "uuid", "emailSentAt": "2026-06-09T..." },
  "message": "Fatura enviada por email"
}
```

**Audit:** `invoice.send_email`

Ver [EMAIL.md](./EMAIL.md).

### Constantes frontend (`packages/shared`)

| Símbolo | Uso |
|---------|-----|
| `API_PATHS.invoices.byId(id)` | GET detalhe / PATCH rascunho |
| `API_PATHS.invoices.duplicate(id)` | POST duplicar |
| `API_PATHS.invoices.issue(id)` | POST emitir Moloni |
| `getBillingDocumentEditPath(type, draftId)` | URL após duplicar — ex. `/dashboard/billing/faturas?draft=…` |

### `GET /billing/products`

Pesquisa artigos Moloni (live API).

| Query | Descrição |
|-------|-----------|
| `workspaceId` | uuid |
| `q` | Filtro nome/referência |

Máx. 50 resultados.

---

## Entidades de facturação

Pesquisa artigos Moloni (live API).

| Query | Descrição |
|-------|-----------|
| `workspaceId` | uuid |
| `q` | Filtro nome/referência |

Máx. 50 resultados.

---

## Entidades de facturação

### `GET /billing/entities`

| Query | Descrição |
|-------|-----------|
| `entityType` | `customer` \| `supplier` |
| `linkStatus` | `unlinked`, `linked`, `pending_confirm`, `conflict` |
| `status` | `active`, `archived`, `all` |
| `q` | Pesquisa nome/NIF/email |

### `POST /billing/entities`

Cria entidade fiscal.

```json
{
  "entityType": "customer",
  "name": "Cliente Lda",
  "vat": "123456789",
  "isFinalConsumer": false,
  "email": "cliente@empresa.pt",
  "phone": "+351912345678",
  "address": "Rua Exemplo 1",
  "city": "Lisboa",
  "zipCode": "1000-001",
  "countryId": 1,
  "pushToMoloni": true
}
```

- NIF duplicado no workspace → reutiliza entidade existente (`200`)
- `isFinalConsumer: true` → NIF `999999990`

**Audit:** `billing_entity.create`

### `GET /billing/entities/:id`

Detalhe com conflitos abertos.

### `PATCH /billing/entities/:id`

Actualiza campos CMS (nome, morada, email, …). NIF bloqueado se faturas emitidas.

Marca `sync_status=pending_push` se já tem `external_id`.

### `POST /billing/entities/:id/link`

```json
{ "cmsClientId": "uuid" }
```

Só entidades `customer`.

### `POST /billing/entities/:id/confirm-link`

Confirma match híbrido por NIF.

```json
{ "cmsClientId": "uuid" }
```

### `POST /billing/entities/:id/push`

Envia/actualiza no Moloni (`customers/insert|update` ou `suppliers/…`).

### `POST /billing/entities/:id/archive`

Arquiva (soft-hide). Moloni inalterado.

### `POST /billing/entities/:id/restore`

Reactiva entidade arquivada.

### `DELETE /billing/entities/:id`

Remove só do CMS. **Nunca** apaga no Moloni.

Bloqueado se:
- Faturas emitidas/pagas/canceladas associadas
- Rascunhos associados

### `POST /billing/entities/archive-unlinked`

Arquiva em massa entidades `unlinked` sem CRM.

### `POST /billing/entities/purge-archived`

Elimina arquivadas (ignora as com faturas emitidas).

---

## Sincronização Moloni → CMS

### `POST /billing/sync/entities`

Importa `customers/getAll` + `suppliers/getAll`. Match NIF → `pending_confirm`.

### `POST /billing/sync/catalog`

Importa `documentSets/getAll` + `taxes/getAll` → `billing_catalog_items`.

### `POST /billing/sync/documents`

Importa documentos emitidos (4 tipos) → `invoices`.

Ignora documentos sem `billing_entity` resolvível.

### `POST /billing/sync/all`

Executa entidades + catálogo + documentos.

### `GET /billing/catalog`

| Query | Descrição |
|-------|-----------|
| `catalogType` | `document_set` \| `tax` |

---

## Conflitos

### `GET /billing/conflicts`

Fila de conflitos (`status=open` por defeito).

### `POST /billing/conflicts/:id/resolve`

```json
{ "resolution": "cms | moloni | dismiss" }
```

| Valor | Acção |
|-------|-------|
| `moloni` | Actualiza CMS com valor Moloni |
| `cms` | Push valor CMS para Moloni |
| `dismiss` | Fecha sem alterar |

---

## Moloni OAuth e configuração

| Método | Rota | Role | Descrição |
|--------|------|------|-----------|
| GET | `/billing/moloni/status` | staff | Config + saúde ligação |
| GET | `/billing/moloni/companies` | staff | Lista empresas Moloni |
| GET | `/billing/moloni/diagnostics` | staff | Contagens clientes/docs |
| PUT | `/billing/moloni/config` | **superadmin** | Guardar credenciais + company + série |
| GET | `/billing/moloni/auth-url` | **superadmin** | URL OAuth + state assinado |
| GET | `/billing/moloni/callback` | — | Callback OAuth (redirect browser) |

### `PUT /billing/moloni/config`

```json
{
  "clientId": "developer-id",
  "clientSecret": "secret",
  "companyId": 237465,
  "documentSetId": 1,
  "redirectUri": "https://dominio/api/v1/billing/moloni/callback"
}
```

**Audit:** `billing.moloni_config_updated`

---

## Cron (sem JWT)

Requer `BILLING_SYNC_SECRET` e header `X-Billing-Sync-Secret`.

| Método | Rota |
|--------|------|
| POST | `/billing/cron/sync/entities?workspaceId=` |
| POST | `/billing/cron/sync/catalog?workspaceId=` |
| POST | `/billing/cron/sync/documents?workspaceId=` |

---

## Email templates (SMTP)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/email-templates` | Lista templates (`invoice`, `password_reset`) |
| PUT | `/email-templates/:key` | Guardar subject + htmlBody |

Ver [EMAIL.md](./EMAIL.md).

---

## Base de dados

| Tabela | Uso |
|--------|-----|
| `billing_entities` | Entidades fiscais |
| `billing_sync_conflicts` | Fila conflitos |
| `billing_catalog_items` | Cache séries + impostos |
| `invoices` | Rascunhos e emitidos |
| `invoice_lines` | Linhas |
| `billing_connections` | OAuth Moloni por workspace |
| `email_templates` | Override templates (key `invoice`) |
| `smtp_configs` | SMTP tenant/plataforma |
| `clients.external_customer_id` | Legacy — espelhado de billing_entities |

---

## Audit — resumo

| Acção | Rota |
|-------|------|
| `invoice.create` | POST /invoices |
| `invoice.update_draft` | PATCH /invoices/:id |
| `invoice.duplicate` | POST /invoices/:id/duplicate |
| `invoice.issue_moloni` | POST /invoices/:id/issue |
| `invoice.send_email` | POST /invoices/:id/send-email |
| `billing.moloni_config_updated` | PUT /billing/moloni/config |
| `billing_entity.create` | POST /billing/entities |
