import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env';
import { syncDocumentsFromMoloni, syncEntitiesFromMoloni, syncCatalogFromMoloni } from '../services/billing-sync.service';

/** Rotas de sync periódica — autenticação via X-Billing-Sync-Secret (sem JWT). */
export async function billingSyncCronRoutes(fastify: FastifyInstance) {
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

  fastify.post('/billing/cron/sync/entities', async (request, reply) => {
    const query = z.object({ workspaceId: z.string().uuid() }).parse(request.query);

    const ws = await fastify.db.workspace.findUnique({
      where: { id: query.workspaceId },
      select: { id: true, tenantId: true },
    });
    if (!ws) {
      return reply.status(404).send({ success: false, error: 'Workspace não encontrado' });
    }

    try {
      const data = await syncEntitiesFromMoloni(ws.id, ws.tenantId, { restoreArchived: false });
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/cron/sync/catalog', async (request, reply) => {
    const query = z.object({ workspaceId: z.string().uuid() }).parse(request.query);

    const ws = await fastify.db.workspace.findUnique({
      where: { id: query.workspaceId },
      select: { id: true },
    });
    if (!ws) {
      return reply.status(404).send({ success: false, error: 'Workspace não encontrado' });
    }

    try {
      const data = await syncCatalogFromMoloni(ws.id);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/cron/sync/documents', async (request, reply) => {
    const query = z.object({ workspaceId: z.string().uuid() }).parse(request.query);

    const ws = await fastify.db.workspace.findUnique({
      where: { id: query.workspaceId },
      select: { id: true, tenantId: true },
    });
    if (!ws) {
      return reply.status(404).send({ success: false, error: 'Workspace não encontrado' });
    }

    try {
      const data = await syncDocumentsFromMoloni(ws.id, ws.tenantId);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}
