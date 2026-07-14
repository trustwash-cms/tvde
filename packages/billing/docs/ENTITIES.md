# Entidades de facturação — CRM ↔ Moloni

## Problema

O módulo **Clientes** do CMS é **CRM** (contactos da app). O Moloni tem **customers** e **suppliers** fiscais. Não são o mesmo conceito.

## Solução: `billing_entities`

Camada fiscal independente que:

- Representa clientes e fornecedores para documentos
- Liga opcionalmente a um `clients` CRM via `cms_client_id`
- Guarda `external_id` Moloni (`customer_id` / `supplier_id`)
- Gere estados de ligação e conflitos

```
CRM (clients)          billing_entities          Moloni API
     │                        │                      │
     │── cms_client_id ──────►│◄── external_id ─────►│
     │   (opcional)           │                      │
```

## Estados de ligação (`link_status`)

| Valor | Significado |
|-------|-------------|
| `unlinked` | Entidade fiscal sem ligação CRM (ex.: importada só do Moloni) |
| `pending_confirm` | Match por NIF detectado — utilizador deve confirmar na UI |
| `linked` | Ligada a um cliente CRM |
| `conflict` | Dados divergem — resolver manualmente |

## Match híbrido por NIF (pull Moloni → CMS)

1. `POST /billing/sync/entities` importa `customers/getAll` + `suppliers/getAll`
2. Por cada entidade Moloni com NIF:
   - **0** clientes CRM com mesmo NIF → `unlinked`
   - **1** cliente CRM → `pending_confirm` (UI pede confirmação)
   - **2+** clientes CRM → `pending_confirm` (utilizador escolhe qual)

## Conflitos (`billing_sync_conflicts`)

Quando uma entidade **já ligada** tem dados diferentes (nome, email, telefone, NIF):

- Cria registo na fila `open`
- Marca entidade `conflict`
- **Não** faz merge automático

Resolução via `POST /billing/conflicts/:id/resolve`:

| `resolution` | Acção |
|--------------|-------|
| `moloni` | Actualiza CMS + billing_entity com valor Moloni |
| `cms` | Push para Moloni |
| `dismiss` | Fecha conflito sem alterar dados |

## Emissão de documentos

1. Rascunho referencia `billing_entity_id` (preferido) ou `client_id` (legacy → cria entidade)
2. Na emissão: `ensureMoloniPartyId` — push se sem `external_id`
3. Documento enviado ao endpoint correcto por `document_type`

## Editar, arquivar e eliminar

| Acção | Efeito no CMS | Efeito no Moloni |
|-------|---------------|------------------|
| **Editar** | Actualiza snapshot local | Inalterado até `POST .../push` |
| **Arquivar** | Oculta da app; sync não reactiva | Inalterado |
| **Eliminar** | Remove registo CMS | **Nunca apagado** pela app |

Regras de eliminação:
- Bloqueado se existirem facturas **emitidas** (ou pagas/canceladas) → usar Arquivar
- Bloqueado se existirem **rascunhos** → eliminar rascunhos primeiro
- Remove **apenas** do CMS; Moloni nunca é afectado

`POST /billing/entities/archive-unlinked` — arquiva em massa importações Moloni sem ligação CRM (útil para dados de teste).

## Deprecação `clients.external_customer_id`

Mantido por compatibilidade. Escrita espelhada quando entidade ligada recebe `external_id`.

## Sync periódica (cron externo)

Configure no `.env`:

```env
BILLING_SYNC_SECRET="um-secret-forte"
```

Endpoints **sem JWT**, com header `X-Billing-Sync-Secret`:

```bash
# Entidades
curl -X POST "https://API/api/v1/billing/cron/sync/entities?workspaceId=UUID" \
  -H "X-Billing-Sync-Secret: um-secret-forte"

# Catálogo (séries + impostos)
curl -X POST "https://API/api/v1/billing/cron/sync/catalog?workspaceId=UUID" \
  -H "X-Billing-Sync-Secret: um-secret-forte"

# Documentos emitidos no Moloni
curl -X POST "https://API/api/v1/billing/cron/sync/documents?workspaceId=UUID" \
  -H "X-Billing-Sync-Secret: um-secret-forte"
```

Exemplo crontab (diário às 6h):

```
0 6 * * * curl -s -X POST "https://tiana-unetched-johnathan.ngrok-free.dev/api/v1/billing/cron/sync/entities?workspaceId=WORKSPACE_UUID" -H "X-Billing-Sync-Secret: ..."
```
