import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BoltSyncType } from '@tvde/bolt';
import { env } from '../config/env';
import { syncAllBoltWorkspaces, syncBoltData } from '../services/bolt-sync.service';

/** Sync Bolt — autenticação via X-Billing-Sync-Secret (sem JWT). */
export async function boltSyncCronRoutes(fastify: FastifyInstance) {
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

  const register = (path: string, type: BoltSyncType) => {
    fastify.post(path, async (request, reply) => {
      const query = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);

      try {
        if (query.workspaceId) {
          const ws = await fastify.db.workspace.findUnique({
            where: { id: query.workspaceId },
            select: { id: true },
          });
          if (!ws) {
            return reply.status(404).send({ success: false, error: 'Workspace não encontrado' });
          }
          const data = await syncBoltData(query.workspaceId, type);
          return reply.send({ success: true, data });
        }

        const summary = await syncAllBoltWorkspaces(type);
        return reply.send({ success: true, data: { summary } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha na sincronização Bolt';
        return reply.status(400).send({ success: false, error: message });
      }
    });
  };

  register('/bolt/cron/sync/orders', 'orders');
  register('/bolt/cron/sync/drivers', 'drivers');
  register('/bolt/cron/sync/vehicles', 'vehicles');
  register('/bolt/cron/sync/all', 'all');
}
