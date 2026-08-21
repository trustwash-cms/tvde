import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Role } from '@tvde/shared';
import { createAuditLog } from '../services/audit.service';
import {
  deleteElectricityCharge,
  getElectricityDashboard,
  listElectricityCharges,
  markElectricityChargePaid,
  bulkMarkElectricityChargesPaid,
} from '../services/electricity.service';
import { importElectricityCsv } from '../services/electricity-import.service';

const listQuerySchema = z.object({
  name: z.string().optional(),
  cardNumber: z.string().optional(),
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

export async function electricityRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('eletricidade'));

  fastify.get('/electricity/dashboard', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const query = z
        .object({
          month: z.string().optional(),
          weekYear: z.coerce.number().optional(),
          week: z.coerce.number().optional(),
        })
        .parse(request.query);
      const data = await getElectricityDashboard(
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
      const message = err instanceof Error ? err.message : 'Erro';
      const status = message.includes('Tenant') ? 400 : 500;
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/electricity/charges', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const query = listQuerySchema.parse(request.query);
      const data = await listElectricityCharges(
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

  fastify.post('/electricity/import', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const file = await request.file();
      if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro em falta (CSV, XLS ou XLSX)' });

      const buffer = await file.toBuffer();
      const data = await importElectricityCsv(
        fastify.db,
        tenantId,
        request.user.sub,
        buffer,
        file.filename
      );

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'electricity.import',
        entityType: 'electricity_charge',
        afterJson: data,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, data, message: 'Importação concluída' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro na importação';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.patch('/electricity/charges/:id/paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = request.params as { id: string };
      const data = await markElectricityChargePaid(fastify.db, tenantId, id);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'electricity.mark_paid',
        entityType: 'electricity_charge',
        entityId: id,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, data, message: 'Carregamento marcado como pago' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/electricity/charges/bulk/mark-paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const body = z
        .object({ ids: z.array(z.string().uuid()).min(1).max(100) })
        .parse(request.body ?? {});
      const data = await bulkMarkElectricityChargesPaid(fastify.db, tenantId, body.ids);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'electricity.bulk_mark_paid',
        entityType: 'electricity_charge',
        afterJson: data,
        ipAddress: request.ip,
      });

      return reply.send({
        success: true,
        data,
        message: `${data.updated} carregamento(s) marcado(s) como pago(s)`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/electricity/charges/:id', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = request.params as { id: string };
      await deleteElectricityCharge(fastify.db, tenantId, id);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'electricity.delete',
        entityType: 'electricity_charge',
        entityId: id,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, message: 'Carregamento eliminado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}
