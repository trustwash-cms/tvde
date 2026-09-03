import { createReadStream, existsSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { PassThrough } from 'node:stream';
import { getPaymentReceiptPath } from './payment-report-attachment-storage.service';

const ZIP_MAX_TOTAL_BYTES = 80 * 1024 * 1024;

function parseDateOnly(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function safePathSegment(value: string): string {
  return value.replace(/[^\w.\-() ]+/g, '_').trim() || 'ficheiro';
}

export type PaymentAttachmentsZipFilters = {
  periodStart: string;
  periodEnd: string;
  userId?: string;
  isPaid?: boolean;
  search?: string;
  paymentMethod?: string;
};

export async function streamPaymentReportAttachmentsZip(
  db: PrismaClient,
  tenantId: string,
  filters: PaymentAttachmentsZipFilters
): Promise<{ stream: PassThrough; fileName: string; fileCount: number }> {
  const where: {
    tenantId: string;
    userId?: string;
    isPaid?: boolean;
    paymentMethod?: string;
    AND?: Array<{ periodStart: { lte: Date } } | { periodEnd: { gte: Date } }>;
    user?: {
      OR: Array<
        | { fullName: { contains: string; mode: 'insensitive' } }
        | { username: { contains: string; mode: 'insensitive' } }
        | { email: { contains: string; mode: 'insensitive' } }
      >;
    };
  } = { tenantId };

  if (filters.userId) where.userId = filters.userId;
  if (typeof filters.isPaid === 'boolean') where.isPaid = filters.isPaid;
  if (filters.paymentMethod) where.paymentMethod = filters.paymentMethod;

  where.AND = [
    { periodStart: { lte: parseDateOnly(filters.periodEnd) } },
    { periodEnd: { gte: parseDateOnly(filters.periodStart) } },
  ];

  const search = filters.search?.trim();
  if (search) {
    where.user = {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  const reports = await db.paymentReport.findMany({
    where,
    orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      user: { select: { fullName: true, username: true, email: true } },
      attachments: {
        orderBy: { createdAt: 'asc' },
        select: { fileName: true, storageKey: true, sizeBytes: true },
      },
    },
  });

  const entries: Array<{ zipPath: string; diskPath: string; size: number }> = [];
  let totalBytes = 0;

  for (const report of reports) {
    const driverLabel = safePathSegment(
      report.user.fullName || report.user.username || report.user.email || report.id
    );
    const periodLabel = `${ymd(report.periodStart)}_${ymd(report.periodEnd)}`;

    for (const att of report.attachments) {
      const diskPath = getPaymentReceiptPath(att.storageKey);
      if (!existsSync(diskPath)) continue;

      const size = Number(att.sizeBytes);
      if (totalBytes + size > ZIP_MAX_TOTAL_BYTES) {
        throw new Error(
          `Limite de ${Math.round(ZIP_MAX_TOTAL_BYTES / 1024 / 1024)} MB excedido — refine o período ou motorista`
        );
      }

      const baseName = safePathSegment(att.fileName);
      entries.push({
        zipPath: `${driverLabel}/${periodLabel}/${baseName}`,
        diskPath,
        size,
      });
      totalBytes += size;
    }
  }

  if (entries.length === 0) {
    throw new Error('Nenhum comprovativo encontrado para o critério indicado');
  }

  const stream = new PassThrough();
  const { ZipArchive } = await import('archiver');
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (err: Error) => stream.destroy(err));
  archive.pipe(stream);

  for (const entry of entries) {
    archive.append(createReadStream(entry.diskPath), { name: entry.zipPath });
  }

  void archive.finalize();

  const fileName = filters.userId
    ? `pagamentos_${filters.periodStart}_${filters.periodEnd}.zip`
    : `pagamentos_anexos_${filters.periodStart}_${filters.periodEnd}.zip`;

  return { stream, fileName, fileCount: entries.length };
}
