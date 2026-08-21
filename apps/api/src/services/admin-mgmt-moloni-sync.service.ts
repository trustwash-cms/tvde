import { prisma, Prisma } from '@tvde/database';
import { defaultEstadoPagamentoForTipoDocumento } from '@tvde/shared';
import { getAdminMgmtSettings } from './admin-mgmt-settings.service';
import { importAdminMgmtClienteFromSource } from './admin-mgmt-cliente.service';

function mapMoloniDocumentType(documentType: string): string {
  const n = documentType.trim().toLowerCase();
  if (n === 'invoice_receipt' || n === 'invoicereceipts') return 'fatura_recibo';
  if (n === 'simplified_invoice') return 'fatura';
  if (n.includes('receipt')) return 'recibo_verde';
  if (n.includes('credit') || n === 'debit_note') return 'nota_credito';
  return 'fatura';
}

export async function syncAdminMgmtFromBillingInvoice(invoiceId: string, tenantId: string) {
  const settingsRow = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { workspaceId: true },
  });
  if (!settingsRow) return null;

  const settings = await getAdminMgmtSettings(settingsRow.workspaceId, tenantId);
  if (!settings.syncFromMoloni) return null;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId, status: 'issued' },
    include: { billingEntity: true, lines: true },
  });
  if (!invoice?.billingEntity) return null;

  const existing = await prisma.adminMgmtFatura.findFirst({
    where: { workspaceId: invoice.workspaceId, billingInvoiceId: invoice.id },
  });
  if (existing) return existing;

  if (invoice.externalId) {
    const byMoloni = await prisma.adminMgmtFatura.findFirst({
      where: {
        workspaceId: invoice.workspaceId,
        origem: 'moloni',
        origemExternaId: invoice.externalId,
      },
    });
    if (byMoloni) return byMoloni;
  }

  let cliente = invoice.billingEntityId
    ? await prisma.adminMgmtCliente.findFirst({
        where: {
          workspaceId: invoice.workspaceId,
          tenantId,
          billingEntityId: invoice.billingEntityId,
        },
      })
    : null;

  if (!cliente && invoice.billingEntity.vat) {
    const nif = invoice.billingEntity.vat.replace(/\s/g, '').toUpperCase();
    cliente = await prisma.adminMgmtCliente.findFirst({
      where: { workspaceId: invoice.workspaceId, tenantId, nif },
    });
  }

  if (!cliente) {
    const imported = await importAdminMgmtClienteFromSource(invoice.workspaceId, tenantId, {
      source: 'billing',
      sourceId: invoice.billingEntityId!,
    });
    cliente = await prisma.adminMgmtCliente.findFirst({
      where: { id: imported.id, workspaceId: invoice.workspaceId, tenantId },
    });
  }

  if (!cliente) return null;

  const tipoDocumento = mapMoloniDocumentType(invoice.documentType);
  const inferred = defaultEstadoPagamentoForTipoDocumento(tipoDocumento);
  // When setting is off, keep receipt-like docs as pendente (manual control).
  const estadoPagamento =
    inferred === 'pago' && !settings.syncMoloniMarkPaidOnReceipt ? 'pendente' : inferred;

  const dataEmissao = invoice.issuedAt ?? new Date();
  const dataPagamento = estadoPagamento === 'pago' ? dataEmissao : null;

  const descricaoResumo =
    invoice.lines.length > 0
      ? invoice.lines
          .slice(0, 3)
          .map((l) => l.description)
          .join('; ')
      : null;

  return prisma.adminMgmtFatura.create({
    data: {
      tenantId,
      workspaceId: invoice.workspaceId,
      clienteId: cliente.id,
      tipoDocumento,
      numero: invoice.number,
      dataEmissao,
      dataVencimento: invoice.dueDate,
      descricaoResumo,
      valorLiquido: invoice.subtotal,
      valorIva: invoice.vatAmount,
      valorTotal: invoice.total,
      estadoPagamento,
      dataPagamento,
      metodoPagamento: estadoPagamento === 'pago' ? 'transferencia' : null,
      notas: invoice.notes,
      origem: 'moloni',
      origemExternaId: invoice.externalId,
      billingInvoiceId: invoice.id,
      anexosJson: [],
    },
  });
}
