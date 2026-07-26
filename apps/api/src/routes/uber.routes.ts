import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Role } from '@tvde/shared';
import {
  getUberDashboard,
  importUberCsvText,
  listUberPayments,
} from '../services/uber.service';

function requireTenant(request: { user: { tenantId: string | null } }) {
  if (!request.user.tenantId) throw new Error('Tenant em falta na sessão');
  return request.user.tenantId;
}

export async function uberRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), { limits: { fileSize: 15 * 1024 * 1024 } });
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('uber'));

  fastify.get('/uber/dashboard', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const query = z.object({ month: z.string().optional() }).parse(request.query);
      const data = await getUberDashboard(
        fastify.db,
        tenantId,
        request.user.sub,
        request.user.role as Role,
        query.month
      );
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/uber/payments', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const query = z
        .object({ q: z.string().optional(), page: z.coerce.number().optional() })
        .parse(request.query);
      const data = await listUberPayments(
        fastify.db,
        tenantId,
        request.user.sub,
        request.user.role as Role,
        query
      );
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/uber/import', { preHandler: [fastify.requireRole('superadmin')] }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const file = await request.file();
      if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro CSV em falta' });
      const csvText = (await file.toBuffer()).toString('utf-8');
      const data = await importUberCsvText(fastify.db, tenantId, request.user.sub, csvText);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });
}
