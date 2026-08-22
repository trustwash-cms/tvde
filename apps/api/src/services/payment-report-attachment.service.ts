import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { assertTenantStorageQuota } from './tenant-storage.service';
import {
  buildPaymentReceiptStorageKey,
  deletePaymentReceiptDir,
  deletePaymentReceiptFile,
  savePaymentReceiptFile,
} from './payment-report-attachment-storage.service';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

export type PaymentReportAttachmentRow = {
  id: string;
  paymentReportId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  uploadedByUserId: string;
  createdAt: string;
};

function serializeAttachment(row: {
  id: string;
  paymentReportId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: bigint;
  uploadedByUserId: string;
  createdAt: Date;
  storageKey?: string;
}): PaymentReportAttachmentRow {
  return {
    id: row.id,
    paymentReportId: row.paymentReportId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes.toString(),
    uploadedByUserId: row.uploadedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function assertAllowedFile(fileName: string, mimeType: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error('Formato não permitido. Use PDF, JPG, PNG ou WEBP.');
  }
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    throw new Error('Tipo MIME não permitido.');
  }
}

async function requireReport(db: PrismaClient, tenantId: string, reportId: string) {
  const report = await db.paymentReport.findFirst({
    where: { id: reportId, tenantId },
    select: { id: true },
  });
  if (!report) throw new Error('Pagamento não encontrado');
  return report;
}

export async function listPaymentReportAttachments(
  db: PrismaClient,
  tenantId: string,
  reportId: string
): Promise<PaymentReportAttachmentRow[]> {
  await requireReport(db, tenantId, reportId);
  const rows = await db.paymentReportAttachment.findMany({
    where: { tenantId, paymentReportId: reportId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeAttachment);
}

export async function uploadPaymentReportAttachment(
  db: PrismaClient,
  tenantId: string,
  reportId: string,
  uploadedByUserId: string,
  input: { fileName: string; mimeType: string; buffer: Buffer }
): Promise<PaymentReportAttachmentRow> {
  await requireReport(db, tenantId, reportId);

  const fileName = input.fileName.trim().slice(0, 200) || 'comprovativo';
  assertAllowedFile(fileName, input.mimeType);

  if (input.buffer.length > env.paymentReceiptsMaxBytes) {
    throw new Error(
      `Ficheiro demasiado grande (máx. ${Math.round(env.paymentReceiptsMaxBytes / 1024 / 1024)} MB)`
    );
  }

  const count = await db.paymentReportAttachment.count({
    where: { tenantId, paymentReportId: reportId },
  });
  if (count >= 20) {
    throw new Error('Limite de 20 comprovativos por pagamento');
  }

  await assertTenantStorageQuota(db, tenantId, input.buffer.length);

  const storageKey = buildPaymentReceiptStorageKey(tenantId, reportId, fileName);
  await savePaymentReceiptFile(storageKey, input.buffer);

  try {
    const row = await db.paymentReportAttachment.create({
      data: {
        tenantId,
        paymentReportId: reportId,
        fileName,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.buffer.length),
        uploadedByUserId,
      },
    });
    return serializeAttachment(row);
  } catch (err) {
    await deletePaymentReceiptFile(storageKey);
    throw err;
  }
}

export async function getPaymentReportAttachmentForDownload(
  db: PrismaClient,
  tenantId: string,
  reportId: string,
  attachmentId: string
) {
  const row = await db.paymentReportAttachment.findFirst({
    where: { id: attachmentId, paymentReportId: reportId, tenantId },
  });
  if (!row) throw new Error('Comprovativo não encontrado');
  return row;
}

export async function deletePaymentReportAttachment(
  db: PrismaClient,
  tenantId: string,
  reportId: string,
  attachmentId: string
): Promise<{ id: string }> {
  const row = await db.paymentReportAttachment.findFirst({
    where: { id: attachmentId, paymentReportId: reportId, tenantId },
  });
  if (!row) throw new Error('Comprovativo não encontrado');

  await db.paymentReportAttachment.delete({ where: { id: row.id } });
  await deletePaymentReceiptFile(row.storageKey);
  return { id: row.id };
}

/** Remove ficheiros físicos de um pagamento (chamado antes/depois do delete do report). */
export async function cleanupPaymentReportAttachmentFiles(
  db: PrismaClient,
  tenantId: string,
  reportId: string
): Promise<number> {
  const rows = await db.paymentReportAttachment.findMany({
    where: { tenantId, paymentReportId: reportId },
    select: { storageKey: true },
  });
  await Promise.all(rows.map((r) => deletePaymentReceiptFile(r.storageKey)));
  await deletePaymentReceiptDir(tenantId, reportId);
  return rows.length;
}
