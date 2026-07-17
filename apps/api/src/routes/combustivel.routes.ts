import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Role } from '@tvde/shared';
import {
  deleteCombustivelTransaction,
  getCombustivelDashboard,
  importCombustivelFile,
  listCombustivelTransactions,
  markCombustivelPaid,
} from '../services/combustivel.service';

function requireTenant(request: { user: { tenantId: string | null } }) {
  if (!request.user.tenantId) throw new Error('Tenant em falta na sessão');
  return request.user.tenantId;
}

export async function combustivelRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), { limits: { fileSize: 10 * 1024 * 1024 } });
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('combustivel'));

  fastify.get('/combustivel/dashboard', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const query = z.object({ month: z.string().optional() }).parse(request.query);
      const data = await getCombustivelDashboard(
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

  fastify.get('/combustivel/transactions', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const query = z
        .object({
          cardNumber: z.string().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          page: z.coerce.number().optional(),
        })
        .parse(request.query);
      const data = await listCombustivelTransactions(
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

  fastify.post('/combustivel/import', { preHandler: [fastify.requireRole('superadmin')] }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const file = await request.file();
      if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
      const buffer = await file.toBuffer();
      const data = await importCombustivelFile(
        fastify.db,
        tenantId,
        request.user.sub,
        buffer,
        file.filename
      );
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.patch('/combustivel/transactions/:id/paid', { preHandler: [fastify.requireRole('superadmin')] }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = request.params as { id: string };
      await markCombustivelPaid(fastify.db, tenantId, id);
      return reply.send({ success: true, message: 'Marcado como pago' });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.delete('/combustivel/transactions/:id', { preHandler: [fastify.requireRole('superadmin')] }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = request.params as { id: string };
      await deleteCombustivelTransaction(fastify.db, tenantId, id);
      return reply.send({ success: true, message: 'Eliminado' });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });
}
