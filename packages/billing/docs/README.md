# @tvde/billing — Módulo de facturação portável

Pacote **autónomo** para facturação com provider [Moloni](https://www.moloni.pt/dev/visao-geral/) (Portugal). Pode ser copiado para outro projecto sem o resto do CMS.

## Documentação

| Documento | Conteúdo |
|-----------|----------|
| **[FATURACAO.md](./FATURACAO.md)** | **Guia completo** — UI, fluxos, BD, troubleshooting |
| [ENTITIES.md](./ENTITIES.md) | CRM ↔ entidades fiscais, conflitos, cron |
| [MOLONI.md](./MOLONI.md) | API Moloni, OAuth, PDF |
| [CMS-API.md](./CMS-API.md) | REST `/api/v1/invoices`, `/billing/*` |
| [EMAIL.md](./EMAIL.md) | SMTP, template faturas, envio por email |

## Estrutura

```
packages/billing/
├── src/
│   ├── types.ts              # InvoiceDraft, metadata Moloni, providers
│   ├── calculations.ts       # Totais e IVA (sem DB)
│   └── providers/moloni/
│       ├── config.ts         # URLs e OAuth
│       ├── oauth.ts          # authorization_code + refresh_token
│       ├── client.ts         # MoloniClient — getAll, getOne, insert, PDF
│       ├── map-invoice.ts    # Draft → Moloni; getOne → linhas duplicação
│       ├── provider.ts       # BillingProvider.issueInvoice()
│       └── pdf-download.ts   # fetchMoloniDocumentPdf()
└── docs/                     # Documentação (ver tabela acima)
```

## Portabilidade

| Camada | Dependências | Migração |
|--------|--------------|----------|
| `@tvde/billing` | Nenhuma (só `fetch`) | Copiar pasta `packages/billing` |
| CMS API | `@tvde/billing` + Prisma | `billing.service.ts`, `billing.routes.ts` |
| CMS Web | `@tvde/shared` routes | `dashboard/billing/*`, componentes `billing/` |

O núcleo **não importa** Prisma, Fastify nem Next.js.

## Uso directo (outro projecto)

```typescript
import {
  computeInvoiceTotals,
  MoloniClient,
  MoloniBillingProvider,
  exchangeAuthorizationCode,
  buildAuthorizeUrl,
  fetchMoloniDocumentPdf,
} from '@tvde/billing';

const totals = computeInvoiceTotals([
  { description: 'Serviço', quantity: 1, unitPrice: 100, vatRate: 23 },
]);
```

**Rebuild após alterações:**

```bash
npm run build -w @tvde/billing
```

## Providers

| ID | Estado | Descrição |
|----|--------|-----------|
| `local` | Rascunho CMS | Sem emissão fiscal externa |
| `moloni` | Implementado | OAuth 2.0 + sync + emissão + PDF |

## Capacidades CMS (resumo)

- Criar rascunhos e emitir 4 tipos de documento Moloni
- Entidades fiscais independentes do CRM
- Sync bidireccional (entidades, catálogo, documentos)
- PDF directo (proxy server-side)
- Email com template HTML + anexo PDF
- **Duplicar documentos** emitidos → rascunho editável (getOne + create local)
- Coluna **Data** na lista usa `issued_at` (data fiscal Moloni)
- Fila de conflitos CRM ↔ Moloni

Ver [FATURACAO.md](./FATURACAO.md) para o guia completo.
