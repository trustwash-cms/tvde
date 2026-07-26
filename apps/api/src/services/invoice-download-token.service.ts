import { prisma } from '@tvde/database';
import { getServerConfig } from '@tvde/shared/server';
import { generateToken, hashToken } from '../lib/crypto';

export class InvoiceDownloadError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'expired' | 'not_ready' | 'limit' = 'invalid'
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

export function getInvoiceDownloadMaxCount(): number {
  return getServerConfig().invoiceDownloadMaxCount;
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
    maxDownloads: getInvoiceDownloadMaxCount(),
  };
}

export type ResolvedInvoiceDownloadToken = {
  invoiceId: string;
  tenantId: string;
  downloadCount: number;
  maxDownloads: number;
  remainingDownloads: number;
  firstDownloadedAt: Date | null;
  expiresAt: Date;
};

function assertInvoiceReady(invoice: {
  status: string;
  externalId: string | null;
}) {
  if (invoice.status === 'draft') throw new InvoiceDownloadError('PDF indisponível', 'not_ready');
  if (!invoice.externalId) throw new InvoiceDownloadError('Documento ainda não emitido', 'not_ready');
}

/** Valida o token sem consumir downloads (para a página HTML). */
export async function resolveInvoiceDownloadToken(
  rawToken: string
): Promise<ResolvedInvoiceDownloadToken> {
  const row = await findInvoiceByDownloadToken(rawToken);
  if (!row) throw new InvoiceDownloadError('Link inválido');
  if (row.expiresAt.getTime() < Date.now()) {
    throw new InvoiceDownloadError('Link expirado', 'expired');
  }

  assertInvoiceReady(row.invoice);

  const maxDownloads = getInvoiceDownloadMaxCount();
  const remainingDownloads = Math.max(0, maxDownloads - row.downloadCount);

  return {
    invoiceId: row.invoice.id,
    tenantId: row.invoice.tenantId,
    downloadCount: row.downloadCount,
    maxDownloads,
    remainingDownloads,
    firstDownloadedAt: row.firstDownloadedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Reserva um download (incrementa contador atomicamente) antes de servir o PDF.
 * Em falha ao obter o PDF, chamar `releaseInvoiceDownloadClaim` para devolver o crédito.
 */
export async function claimInvoiceDownload(
  rawToken: string
): Promise<ResolvedInvoiceDownloadToken> {
  const tokenHash = hashToken(rawToken);
  const maxDownloads = getInvoiceDownloadMaxCount();

  const claimed = await prisma.$queryRaw<
    Array<{
      invoice_id: string;
      download_count: number;
      first_downloaded_at: Date | null;
      expires_at: Date;
    }>
  >`
    UPDATE invoice_download_tokens
    SET
      download_count = download_count + 1,
      first_downloaded_at = COALESCE(first_downloaded_at, NOW())
    WHERE token_hash = ${tokenHash}
      AND expires_at > NOW()
      AND download_count < ${maxDownloads}
    RETURNING invoice_id, download_count, first_downloaded_at, expires_at
  `;

  if (!claimed.length) {
    const row = await findInvoiceByDownloadToken(rawToken);
    if (!row) throw new InvoiceDownloadError('Link inválido');
    if (row.expiresAt.getTime() < Date.now()) {
      throw new InvoiceDownloadError('Link expirado', 'expired');
    }
    if (row.downloadCount >= maxDownloads) {
      throw new InvoiceDownloadError(
        `Limite de downloads atingido (${maxDownloads} de ${maxDownloads}). Peça uma nova cópia à empresa emissora.`,
        'limit'
      );
    }
    assertInvoiceReady(row.invoice);
    throw new InvoiceDownloadError('Link inválido');
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: claimed[0].invoice_id },
    select: { id: true, tenantId: true, status: true, externalId: true },
  });
  if (!invoice) throw new InvoiceDownloadError('Fatura não encontrada');
  try {
    assertInvoiceReady(invoice);
  } catch (err) {
    await releaseInvoiceDownloadClaim(rawToken);
    throw err;
  }

  return {
    invoiceId: invoice.id,
    tenantId: invoice.tenantId,
    downloadCount: claimed[0].download_count,
    maxDownloads,
    remainingDownloads: Math.max(0, maxDownloads - claimed[0].download_count),
    firstDownloadedAt: claimed[0].first_downloaded_at,
    expiresAt: claimed[0].expires_at,
  };
}

/** Devolve o crédito de download se a obtenção do PDF falhar após o claim. */
export async function releaseInvoiceDownloadClaim(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await prisma.$executeRaw`
    UPDATE invoice_download_tokens
    SET
      download_count = GREATEST(download_count - 1, 0),
      first_downloaded_at = CASE
        WHEN download_count - 1 <= 0 THEN NULL
        ELSE first_downloaded_at
      END
    WHERE token_hash = ${tokenHash}
      AND download_count > 0
  `;
}
