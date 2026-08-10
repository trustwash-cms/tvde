import { prisma } from '@tvde/database';
import {
  markAdminMgmtFaturaPaid,
  markAdminMgmtFaturaPending,
} from './admin-mgmt-fatura.service';

export const BILLING_PAYMENT_STATUSES = ['pendente', 'pago', 'parcial', 'cancelado'] as const;
export type BillingPaymentStatus = (typeof BILLING_PAYMENT_STATUSES)[number];

export function isInvoiceReceiptLike(documentType: string): boolean {
  const n = documentType.trim().toLowerCase();
  if (n === 'invoice_receipt' || n.includes('receipt')) return true;
  return n.includes('fatura') && n.includes('recibo');
}

export function defaultPaymentStatusOnIssue(documentType: string): BillingPaymentStatus {
  return isInvoiceReceiptLike(documentType) ? 'pago' : 'pendente';
}

const openPaymentWhere = {
  status: 'issued' as const,
  paymentStatus: { in: ['pendente', 'parcial'] },
};

async function mirrorAdminMgmtPaid(
  invoiceId: string,
  workspaceId: string,
  tenantId: string,
  paidAt: Date
) {
  const linked = await prisma.adminMgmtFatura.findFirst({
    where: { workspaceId, billingInvoiceId: invoiceId },
    select: { id: true },
  });
  if (!linked) return;

  await markAdminMgmtFaturaPaid(linked.id, workspaceId, tenantId, {
    dataPagamento: paidAt.toISOString().slice(0, 10),
    metodoPagamento: 'transferencia',
  });
}

async function mirrorAdminMgmtPending(invoiceId: string, workspaceId: string, tenantId: string) {
  const linked = await prisma.adminMgmtFatura.findFirst({
    where: { workspaceId, billingInvoiceId: invoiceId },
    select: { id: true },
  });
  if (!linked) return;

  await markAdminMgmtFaturaPending(linked.id, workspaceId, tenantId, { internal: true });
}

async function requireIssuedInvoice(id: string, workspaceId: string, tenantId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, workspaceId, tenantId },
    include: {
      client: { select: { id: true, name: true, nif: true, email: true } },
      billingEntity: {
        select: { id: true, name: true, vat: true, entityType: true, email: true },
      },
      lines: true,
    },
  });
  if (!invoice) return null;
  if (invoice.status === 'draft') {
    throw new Error('Rascunhos não têm estado de pagamento');
  }
  if (invoice.status === 'cancelled') {
    throw new Error('Documentos cancelados não podem alterar o pagamento');
  }
  if (invoice.status !== 'issued') {
    throw new Error('Só documentos emitidos podem alterar o pagamento');
  }
  return invoice;
}

export async function markBillingInvoicePaid(
  id: string,
  workspaceId: string,
  tenantId: string,
  paidAtInput?: Date | string | null
) {
  const invoice = await requireIssuedInvoice(id, workspaceId, tenantId);
  if (!invoice) return null;

  const paidAt =
    paidAtInput instanceof Date
      ? paidAtInput
      : typeof paidAtInput === 'string' && paidAtInput.trim()
        ? new Date(paidAtInput)
        : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    throw new Error('Data de pagamento inválida');
  }

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      paymentStatus: 'pago',
      paidAt,
    },
    include: {
      client: { select: { id: true, name: true, nif: true, email: true } },
      billingEntity: {
        select: { id: true, name: true, vat: true, entityType: true, email: true },
      },
      lines: true,
    },
  });

  await mirrorAdminMgmtPaid(updated.id, workspaceId, tenantId, paidAt);
  return updated;
}

export async function markBillingInvoicePending(id: string, workspaceId: string, tenantId: string) {
  const invoice = await requireIssuedInvoice(id, workspaceId, tenantId);
  if (!invoice) return null;

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      paymentStatus: 'pendente',
      paidAt: null,
    },
    include: {
      client: { select: { id: true, name: true, nif: true, email: true } },
      billingEntity: {
        select: { id: true, name: true, vat: true, entityType: true, email: true },
      },
      lines: true,
    },
  });

  await mirrorAdminMgmtPending(updated.id, workspaceId, tenantId);
  return updated;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

export async function bulkMarkBillingInvoicesPaid(
  ids: string[],
  workspaceId: string,
  tenantId: string,
  paidAtInput?: Date | string | null
) {
  const unique = uniqueIds(ids);
  if (unique.length === 0) throw new Error('Seleccione pelo menos um documento');
  if (unique.length > 50) throw new Error('Máximo de 50 documentos por operação');

  let updated = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const id of unique) {
    try {
      const row = await markBillingInvoicePaid(id, workspaceId, tenantId, paidAtInput);
      if (row) updated++;
      else skipped++;
    } catch (err) {
      skipped++;
      errors.push({
        id,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  }

  return { updated, skipped, requested: unique.length, errors };
}

export { openPaymentWhere };
