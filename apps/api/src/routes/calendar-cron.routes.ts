import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env';
import { processDueScheduledInvoices } from '../services/calendar/calendar-scheduled-invoice.service';

/** Worker de autofaturação — autenticação via X-Billing-Sync-Secret (sem JWT). */
export async function calendarSyncCronRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request, reply) => {
    const secret = env.billingSyncSecret;
    if (!secret) {
      return reply.status(503).send({ success: false, error: 'BILLING_SYNC_SECRET não configurado' });
    }
    const header = request.headers['x-billing-sync-secret'];
    if (header !== secret) {
      return reply.status(401).send({ success: false, error: 'Secret inválido' });
    }
  });

  fastify.post('/calendar/cron/process-scheduled-invoices', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        includeFailed: z.coerce.boolean().optional(),
      })
      .parse(request.query);

    if (query.workspaceId) {
      const ws = await fastify.db.workspace.findUnique({
        where: { id: query.workspaceId },
        select: { id: true },
      });
      if (!ws) {
        return reply.status(404).send({ success: false, error: 'Workspace não encontrado' });
      }
    }

    try {
      const data = await processDueScheduledInvoices({
        workspaceId: query.workspaceId,
        limit: query.limit,
        includeFailed: query.includeFailed,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao processar faturas agendadas';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}
