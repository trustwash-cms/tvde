import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getApiPrefix } from '@tvde/shared/server';
import {
  InvoiceDownloadError,
  resolveInvoiceDownloadToken,
} from '../services/invoice-download-token.service';
import { downloadInvoicePdf } from '../services/billing.service';
import { renderInvoiceDownloadPage } from '../services/invoice-download-page';

function handleDownloadError(err: unknown) {
  if (err instanceof InvoiceDownloadError) {
    const status =
      err.code === 'invalid' ? 404 : err.code === 'expired' ? 410 : 400;
    return { status, message: err.message };
  }
  if (err instanceof Error) return { status: 400, message: err.message };
  return { status: 500, message: 'Erro interno' };
}

export async function billingPublicRoutes(fastify: FastifyInstance) {
  fastify.get('/invoices/public/download-page', async (request, reply) => {
    const query = z.object({ token: z.string().min(16) }).parse(request.query);

    try {
      await resolveInvoiceDownloadToken(query.token);
      return reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(renderInvoiceDownloadPage(query.token, getApiPrefix()));
    } catch (err) {
      const { status, message } = handleDownloadError(err);
      return reply.status(status).type('text/plain; charset=utf-8').send(message);
    }
  });

  fastify.get('/invoices/public/download', async (request, reply) => {
    const query = z.object({ token: z.string().min(16) }).parse(request.query);

    try {
      const { invoiceId, tenantId } = await resolveInvoiceDownloadToken(query.token);
      const { buffer, filename } = await downloadInvoicePdf(invoiceId, tenantId);

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store')
        .send(buffer);
    } catch (err) {
      const { status, message } = handleDownloadError(err);
      return reply.status(status).type('text/plain; charset=utf-8').send(message);
    }
  });
}
