import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getApiPrefix } from '@tvde/shared/server';
import {
  InvoiceDownloadError,
  claimInvoiceDownload,
  getInvoiceDownloadMaxCount,
  releaseInvoiceDownloadClaim,
  resolveInvoiceDownloadToken,
} from '../services/invoice-download-token.service';
import { downloadInvoicePdf } from '../services/billing.service';
import {
  renderInvoiceDownloadLimitPage,
  renderInvoiceDownloadPage,
} from '../services/invoice-download-page';

function handleDownloadError(err: unknown) {
  if (err instanceof InvoiceDownloadError) {
    const status =
      err.code === 'invalid'
        ? 404
        : err.code === 'expired'
          ? 410
          : err.code === 'limit'
            ? 429
            : 400;
    return { status, message: err.message, code: err.code };
  }
  if (err instanceof Error) return { status: 400, message: err.message, code: 'error' as const };
  return { status: 500, message: 'Erro interno', code: 'error' as const };
}

export async function billingPublicRoutes(fastify: FastifyInstance) {
  fastify.get('/invoices/public/download-page', async (request, reply) => {
    const query = z.object({ token: z.string().min(16) }).parse(request.query);

    try {
      const resolved = await resolveInvoiceDownloadToken(query.token);
      if (resolved.remainingDownloads <= 0) {
        return reply
          .status(429)
          .header('Content-Type', 'text/html; charset=utf-8')
          .header('Cache-Control', 'no-store')
          .send(renderInvoiceDownloadLimitPage(resolved.maxDownloads));
      }
      return reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(
          renderInvoiceDownloadPage({
            token: query.token,
            apiPrefix: getApiPrefix(),
            remainingDownloads: resolved.remainingDownloads,
            maxDownloads: resolved.maxDownloads,
          })
        );
    } catch (err) {
      const { status, message, code } = handleDownloadError(err);
      if (code === 'limit') {
        return reply
          .status(429)
          .header('Content-Type', 'text/html; charset=utf-8')
          .header('Cache-Control', 'no-store')
          .send(renderInvoiceDownloadLimitPage(getInvoiceDownloadMaxCount()));
      }
      return reply.status(status).type('text/plain; charset=utf-8').send(message);
    }
  });

  fastify.get('/invoices/public/download', async (request, reply) => {
    const query = z.object({ token: z.string().min(16) }).parse(request.query);

    let claimed = false;
    try {
      const { invoiceId, tenantId, remainingDownloads } = await claimInvoiceDownload(query.token);
      claimed = true;
      const { buffer, filename } = await downloadInvoicePdf(invoiceId, tenantId);

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store')
        .header('X-Downloads-Remaining', String(remainingDownloads))
        .send(buffer);
    } catch (err) {
      if (claimed) {
        try {
          await releaseInvoiceDownloadClaim(query.token);
        } catch {
          /* ignore rollback failure */
        }
      }
      const { status, message } = handleDownloadError(err);
      return reply.status(status).type('text/plain; charset=utf-8').send(message);
    }
  });
}
