import { prisma } from '@tvde/database';
import { getServerConfig } from '@tvde/shared/server';
import { generateToken, hashToken } from '../lib/crypto';

export class InvoiceDownloadError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'expired' | 'not_ready' = 'invalid'
  ) {
    super(message);
    this.name = 'InvoiceDownloadError';
  }
}

export function formatExpiresIn(ms: number): string {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days} dias`;
  const hours = Math.round(ms / (60 * 60 * 1000));
  return `${hours} horas`;
}

function buildInvoiceDownloadUrl(rawToken: string): string {
  const { apiPublicUrl } = getServerConfig();
  const base = apiPublicUrl.replace(/\/$/, '');
  // Página intermédia: contorna aviso ngrok free e inicia download com header correcto.
  return `${base}/invoices/public/download-page?token=${encodeURIComponent(rawToken)}`;
}

async function findInvoiceByDownloadToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const row = await prisma.invoiceDownloadToken.findUnique({
    where: { tokenHash },
    include: {
      invoice: {
        select: {
          id: true,
          tenantId: true,
          status: true,
          externalId: true,
          number: true,
        },
      },
    },
  });
  return row;
}

/** Gera (ou renova) link de download público válido por 90 dias (configurável). */
export async function createInvoiceDownloadLink(invoiceId: string, tenantId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { id: true, status: true, externalId: true },
  });
  if (!invoice) throw new InvoiceDownloadError('Fatura não encontrada');
  if (invoice.status === 'draft') throw new InvoiceDownloadError('Rascunho sem PDF', 'not_ready');
  if (!invoice.externalId) throw new InvoiceDownloadError('Documento ainda não emitido no Moloni', 'not_ready');

  const { invoiceDownloadTokenExpiresMs } = getServerConfig();
  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + invoiceDownloadTokenExpiresMs);

  await prisma.$transaction([
    prisma.invoiceDownloadToken.deleteMany({ where: { invoiceId } }),
    prisma.invoiceDownloadToken.create({
      data: { invoiceId, tokenHash, expiresAt },
    }),
  ]);

  return {
    rawToken,
    url: buildInvoiceDownloadUrl(rawToken),
    expiresAt,
    expiresIn: formatExpiresIn(invoiceDownloadTokenExpiresMs),
  };
}

export async function resolveInvoiceDownloadToken(rawToken: string) {
  const row = await findInvoiceByDownloadToken(rawToken);
  if (!row) throw new InvoiceDownloadError('Link inválido');
  if (row.expiresAt.getTime() < Date.now()) {
    throw new InvoiceDownloadError('Link expirado', 'expired');
  }

  const invoice = row.invoice;
  if (invoice.status === 'draft') throw new InvoiceDownloadError('PDF indisponível', 'not_ready');
  if (!invoice.externalId) throw new InvoiceDownloadError('Documento ainda não emitido', 'not_ready');

  return {
    invoiceId: invoice.id,
    tenantId: invoice.tenantId,
  };
}
