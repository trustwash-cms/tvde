import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Role } from '@tvde/shared';
import { createAuditLog } from '../services/audit.service';
import {
  getUberDashboard,
  importUberCsvText,
  listUberPayments,
  markUberPaymentPaid,
  bulkMarkUberPaymentsPaid,
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
      const query = z
        .object({
          month: z.string().optional(),
          weekYear: z.coerce.number().optional(),
          week: z.coerce.number().optional(),
        })
        .parse(request.query);
      const data = await getUberDashboard(
        fastify.db,
        tenantId,
        request.user.sub,
        request.user.role as Role,
        query.month,
        query.weekYear,
        query.week
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

  fastify.patch('/uber/payments/:id/paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = request.params as { id: string };
      const data = await markUberPaymentPaid(fastify.db, tenantId, id);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'uber.mark_paid',
        entityType: 'uber_payment',
        entityId: id,
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Pagamento marcado como pago' });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/uber/payments/bulk/mark-paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const body = z
        .object({ ids: z.array(z.string().uuid()).min(1).max(100) })
        .parse(request.body ?? {});
      const data = await bulkMarkUberPaymentsPaid(fastify.db, tenantId, body.ids);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'uber.bulk_mark_paid',
        entityType: 'uber_payment',
        afterJson: data,
        ipAddress: request.ip,
      });
      return reply.send({
        success: true,
        data,
        message: `${data.updated} pagamento(s) marcado(s) como pago(s)`,
      });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });
}
