import { prisma, Prisma } from '@tvde/database';
import type { CalendarScheduledInvoiceDraft, MoloniDocumentType } from '@tvde/shared';
import {
  buildCalendarStorageKey,
  saveCalendarAttachmentFile,
} from './calendar-attachment-storage.service';
import {
  createInvoice,
  downloadInvoicePdf,
  issueInvoiceToMoloni,
  sendInvoiceEmail,
} from '../billing.service';
import {
  enrichScheduledInvoiceLines,
  resolveScheduledInvoiceMoloniDefaults,
} from './calendar-scheduled-invoice-defaults.service';
import { formatMoloniDocumentSetError } from '@tvde/billing';

function parseDraftPayload(value: unknown): CalendarScheduledInvoiceDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.billingEntityId !== 'string') return null;
  if (typeof row.clientEmail !== 'string') return null;
  if (!Array.isArray(row.lines) || row.lines.length === 0) return null;

  const lines = row.lines
    .filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object'))
    .map((line) => ({
      description: String(line.description ?? ''),
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      vatRate: line.vatRate != null ? Number(line.vatRate) : undefined,
      moloniProductId: line.moloniProductId != null ? Number(line.moloniProductId) : undefined,
      moloniTaxId: line.moloniTaxId != null ? Number(line.moloniTaxId) : undefined,
      moloniExemptionReason:
        typeof line.moloniExemptionReason === 'string' ? line.moloniExemptionReason : undefined,
    }))
    .filter((line) => line.description.trim() && line.quantity > 0);

  if (lines.length === 0) return null;

  return {
    billingEntityId: row.billingEntityId,
    clientEmail: row.clientEmail.trim(),
    lines,
    documentType: typeof row.documentType === 'string' ? row.documentType : 'invoice',
    notes: typeof row.notes === 'string' ? row.notes : undefined,
    autoIssue: row.autoIssue !== false,
    sendEmail: row.sendEmail !== false,
  };
}

function serializeScheduledInvoice<T extends {
  id: string;
  status: string;
  scheduledAt: Date;
  billingEntityId: string;
  invoiceId: string | null;
  errorMessage: string | null;
  emailSentAt?: Date | null;
  emailErrorMessage?: string | null;
  draftPayloadJson: unknown;
  billingEntity?: { id: string; name: string; email: string | null };
  invoice?: { emailSentAt: Date | null } | null;
}>(row: T) {
  const draft = parseDraftPayload(row.draftPayloadJson);
  const emailSentAt =
    row.emailSentAt?.toISOString() ??
    row.invoice?.emailSentAt?.toISOString() ??
    null;
  return {
    id: row.id,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    billingEntityId: row.billingEntityId,
    invoiceId: row.invoiceId,
    errorMessage: row.errorMessage,
    emailSentAt,
    emailSent: Boolean(emailSentAt),
    emailErrorMessage: row.emailErrorMessage ?? null,
    draft,
    billingEntity: row.billingEntity,
  };
}

export async function upsertScheduledInvoiceForEvent(input: {
  tenantId: string;
  workspaceId: string;
  eventId: string;
  createdByUserId: string;
  scheduledAt: Date;
  draft: CalendarScheduledInvoiceDraft;
}) {
  const entity = await prisma.billingEntity.findFirst({
    where: {
      id: input.draft.billingEntityId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
  });
  if (!entity) throw new Error('Cliente de facturação não encontrado');

  const payload = input.draft as unknown as Prisma.InputJsonValue;

  const existing = await prisma.calendarScheduledInvoice.findFirst({
    where: {
      eventId: input.eventId,
      status: { in: ['pending', 'processing', 'failed'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return prisma.calendarScheduledInvoice.update({
      where: { id: existing.id },
      data: {
        billingEntityId: input.draft.billingEntityId,
        scheduledAt: input.scheduledAt,
        draftPayloadJson: payload,
        status: existing.status === 'failed' ? 'pending' : existing.status,
        errorMessage: null,
        emailSentAt: null,
        emailErrorMessage: null,
      },
      include: {
        billingEntity: { select: { id: true, name: true, email: true } },
      },
    });
  }

  return prisma.calendarScheduledInvoice.create({
    data: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      eventId: input.eventId,
      createdByUserId: input.createdByUserId,
      billingEntityId: input.draft.billingEntityId,
      scheduledAt: input.scheduledAt,
      draftPayloadJson: payload,
      status: 'pending',
    },
    include: {
      billingEntity: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function cancelPendingScheduledInvoicesForEvent(eventId: string) {
  await prisma.calendarScheduledInvoice.updateMany({
    where: { eventId, status: 'pending' },
    data: { status: 'cancelled' },
  });
}

async function attachInvoicePdfToEvent(input: {
  tenantId: string;
  eventId: string;
  invoiceId: string;
  uploadedByUserId: string;
}) {
  const { buffer, filename } = await downloadInvoicePdf(input.invoiceId, input.tenantId);
  const storageKey = buildCalendarStorageKey(input.tenantId, input.eventId, filename);
  await saveCalendarAttachmentFile(storageKey, buffer);

  await prisma.calendarEventAttachment.create({
    data: {
      tenantId: input.tenantId,
      eventId: input.eventId,
      fileName: filename,
      storageKey,
      mimeType: 'application/pdf',
      sizeBytes: BigInt(buffer.length),
      uploadedByUserId: input.uploadedByUserId,
    },
  });
}

async function processScheduledInvoiceRow(row: {
  id: string;
  tenantId: string;
  workspaceId: string;
  eventId: string | null;
  createdByUserId: string;
  invoiceId: string | null;
  draftPayloadJson: unknown;
}) {
  const draft = parseDraftPayload(row.draftPayloadJson);
  if (!draft) {
    throw new Error('Payload de fatura inválido');
  }

  const { documentSetId } = await resolveScheduledInvoiceMoloniDefaults(
    row.workspaceId,
    (draft.documentType as MoloniDocumentType) ?? 'invoice'
  );
  const lines = await enrichScheduledInvoiceLines(row.workspaceId, draft.lines);

  let invoice = row.invoiceId
    ? await prisma.invoice.findFirst({
        where: { id: row.invoiceId, tenantId: row.tenantId, workspaceId: row.workspaceId },
        include: { client: true, billingEntity: true, lines: true },
      })
    : null;

  if (invoice && invoice.status !== 'draft') {
    // Já emitida numa tentativa anterior — não criar outro rascunho.
    let emailSentAt: Date | null = null;
    let emailErrorMessage: string | null = null;

    if (draft.sendEmail) {
      try {
        await sendInvoiceEmail(invoice.id, row.tenantId, { toEmail: draft.clientEmail });
        emailSentAt = new Date();
      } catch (emailErr) {
        emailErrorMessage =
          emailErr instanceof Error ? emailErr.message : 'Falha ao enviar email da fatura';
      }
    }

    if (row.eventId) {
      await attachInvoicePdfToEvent({
        tenantId: row.tenantId,
        eventId: row.eventId,
        invoiceId: invoice.id,
        uploadedByUserId: row.createdByUserId,
      });
    }

    return { invoiceId: invoice.id, emailSentAt, emailErrorMessage };
  }

  if (!invoice) {
    invoice = await createInvoice({
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      billingEntityId: draft.billingEntityId,
      documentType: draft.documentType ?? 'invoice',
      lines,
      notes: draft.notes,
      issueDate: new Date().toISOString().slice(0, 10),
      documentSetId,
    });

    await prisma.calendarScheduledInvoice.update({
      where: { id: row.id },
      data: { invoiceId: invoice.id },
    });
  }

  let issued = invoice;
  if (draft.autoIssue) {
    issued = await issueInvoiceToMoloni(invoice.id, row.tenantId);
    if (!issued.externalId) {
      throw new Error('Fatura criada localmente mas Moloni não devolveu ID do documento');
    }
  }

  let emailSentAt: Date | null = null;
  let emailErrorMessage: string | null = null;

  if (draft.sendEmail && draft.autoIssue) {
    try {
      await sendInvoiceEmail(issued.id, row.tenantId, { toEmail: draft.clientEmail });
      emailSentAt = new Date();
    } catch (emailErr) {
      emailErrorMessage =
        emailErr instanceof Error ? emailErr.message : 'Falha ao enviar email da fatura';
      console.warn('[calendar-scheduled-invoice] email failed:', emailErr);
    }
  }

  if (draft.autoIssue && row.eventId) {
    await attachInvoicePdfToEvent({
      tenantId: row.tenantId,
      eventId: row.eventId,
      invoiceId: issued.id,
      uploadedByUserId: row.createdByUserId,
    });
  }

  return { invoiceId: issued.id, emailSentAt, emailErrorMessage };
}

export async function processDueScheduledInvoices(options?: {
  workspaceId?: string;
  limit?: number;
  includeFailed?: boolean;
}) {
  const limit = options?.limit ?? 20;
  const now = new Date();

  const due = await prisma.calendarScheduledInvoice.findMany({
    where: {
      scheduledAt: { lte: now },
      status: options?.includeFailed ? { in: ['pending', 'failed'] } : 'pending',
      ...(options?.workspaceId ? { workspaceId: options.workspaceId } : {}),
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  });

  const results: Array<{
    id: string;
    status: 'completed' | 'failed';
    invoiceId?: string;
    errorMessage?: string;
  }> = [];

  for (const row of due) {
    const claimed = await prisma.calendarScheduledInvoice.updateMany({
      where: {
        id: row.id,
        status: row.status === 'failed' && options?.includeFailed ? 'failed' : 'pending',
      },
      data: { status: 'processing', errorMessage: null },
    });
    if (claimed.count === 0) continue;

    try {
      const result = await processScheduledInvoiceRow(row);
      await prisma.calendarScheduledInvoice.update({
        where: { id: row.id },
        data: {
          status: 'completed',
          invoiceId: result.invoiceId,
          processedAt: new Date(),
          errorMessage: null,
          emailSentAt: result.emailSentAt,
          emailErrorMessage: result.emailErrorMessage,
        },
      });
      results.push({ id: row.id, status: 'completed', invoiceId: result.invoiceId });
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Falha ao processar fatura agendada';
      const message = formatMoloniDocumentSetError(raw);
      await prisma.calendarScheduledInvoice.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          processedAt: new Date(),
          errorMessage: message,
        },
      });
      results.push({ id: row.id, status: 'failed', errorMessage: message });
    }
  }

  return { processed: results.length, results };
}

export { parseDraftPayload, serializeScheduledInvoice };
