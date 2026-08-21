import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Role } from '@tvde/shared';
import { createAuditLog } from '../services/audit.service';
import {
  deleteViaVerdeMovement,
  getViaVerdeDashboard,
  listViaVerdeMovements,
  markViaVerdeMovementPaid,
  bulkMarkViaVerdeMovementsPaid,
} from '../services/via-verde.service';
import { importViaVerdeCsv } from '../services/via-verde-import.service';

const listQuerySchema = z.object({
  licensePlate: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isPaid: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

function requireTenant(request: { user: { tenantId: string | null } }) {
  if (!request.user.tenantId) {
    throw new Error('Tenant em falta na sessão');
  }
  return request.user.tenantId;
}

export async function viaVerdeRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('via_verde'));

  fastify.get('/via-verde/dashboard', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const query = z.object({ month: z.string().optional() }).parse(request.query);
      const data = await getViaVerdeDashboard(
        fastify.db,
        tenantId,
        request.user.sub,
        request.user.role as Role,
        query.month
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      const status = message.includes('Tenant') ? 400 : 500;
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/via-verde/movements', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const query = listQuerySchema.parse(request.query);
      const data = await listViaVerdeMovements(
        fastify.db,
        tenantId,
        request.user.sub,
        request.user.role as Role,
        query
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      const status = message.includes('Tenant') ? 400 : 500;
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.post('/via-verde/import', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const file = await request.file();
      if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro em falta (CSV, XLS ou XLSX)' });

      const buffer = await file.toBuffer();
      const data = await importViaVerdeCsv(
        fastify.db,
        tenantId,
        request.user.sub,
        buffer,
        file.filename
      );

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'via_verde.import',
        entityType: 'via_verde_movement',
        afterJson: data,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, data, message: 'Importação concluída' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro na importação';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.patch('/via-verde/movements/:id/paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = request.params as { id: string };
      const body = z
        .object({ isPaid: z.boolean().optional() })
        .optional()
        .parse(request.body);
      const isPaid = body?.isPaid ?? true;
      const data = await markViaVerdeMovementPaid(fastify.db, tenantId, id, isPaid);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: isPaid ? 'via_verde.mark_paid' : 'via_verde.mark_unpaid',
        entityType: 'via_verde_movement',
        entityId: id,
        ipAddress: request.ip,
      });

      return reply.send({
        success: true,
        data,
        message: isPaid ? 'Movimento marcado como pago' : 'Movimento marcado como não pago',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/via-verde/movements/bulk/mark-paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const body = z
        .object({ ids: z.array(z.string().uuid()).min(1).max(100) })
        .parse(request.body ?? {});
      const data = await bulkMarkViaVerdeMovementsPaid(fastify.db, tenantId, body.ids);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'via_verde.bulk_mark_paid',
        entityType: 'via_verde_movement',
        afterJson: data,
        ipAddress: request.ip,
      });

      return reply.send({
        success: true,
        data,
        message: `${data.updated} movimento(s) marcado(s) como pago(s)`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/via-verde/movements/:id', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = request.params as { id: string };
      await deleteViaVerdeMovement(fastify.db, tenantId, id);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'via_verde.delete',
        entityType: 'via_verde_movement',
        entityId: id,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, message: 'Movimento eliminado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}
