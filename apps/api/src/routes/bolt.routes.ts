import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BoltSyncType } from '@tvde/bolt';
import { isDriverRole, type Role } from '@tvde/shared';
import { createAuditLog } from '../services/audit.service';
import { resolveWorkspaceTenantScope } from '../lib/workspace-scope';
import { parseSearchQuery, textOr } from '../services/search.service';
import {
  getBoltPublicStatus,
  saveBoltConfig,
  setBoltAutoSync,
  testBoltConnection,
} from '../services/bolt.service';
import {
  getBoltDashboardStats,
  listBoltOrders,
  syncBoltData,
  markBoltOrderPaid,
  bulkMarkBoltOrdersPaid,
} from '../services/bolt-sync.service';
import { getDriverFleetScope } from '../services/user-vehicle-matching.service';
import { sumDriverPaymentReportsInMonth } from '../services/payment-report.service';

const syncTypeSchema = z.enum(['orders', 'drivers', 'vehicles', 'all']);

async function resolveDriverUuids(
  fastify: FastifyInstance,
  request: { user: { sub: string; role: string; tenantId: string | null } },
  tenantId: string
): Promise<string[] | undefined> {
  const scope = await getDriverFleetScope(
    fastify.db,
    tenantId,
    request.user.sub,
    request.user.role as Role
  );
  return scope ? scope.uuidBolt : undefined;
}

export async function boltRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('bolt'));

  fastify.get('/bolt/status', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await getBoltPublicStatus(workspaceId, tenantId);
    return reply.send({ success: true, data });
  });

  fastify.put('/bolt/config', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z.object({
      workspaceId: z.string().uuid().optional(),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1).optional(),
      boltCompanyId: z.coerce.number().int().positive().optional(),
    }).parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const config = await saveBoltConfig({
        workspaceId,
        tenantId,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        boltCompanyId: body.boltCompanyId,
      });

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'bolt.config_updated',
        entityType: 'bolt_connection',
        entityId: config.id,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, data: config, message: 'Configuração Bolt guardada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao guardar configuração';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.patch('/bolt/auto-sync', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z.object({
      workspaceId: z.string().uuid().optional(),
      autoSyncEnabled: z.boolean(),
    }).parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const config = await setBoltAutoSync(workspaceId, body.autoSyncEnabled);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'bolt.auto_sync_updated',
        entityType: 'bolt_connection',
        entityId: config.id,
        afterJson: { autoSyncEnabled: body.autoSyncEnabled },
        ipAddress: request.ip,
      });
      return reply.send({
        success: true,
        data: { autoSyncEnabled: config.autoSyncEnabled },
        message: body.autoSyncEnabled
          ? 'Sincronização automática diária activada'
          : 'Sincronização automática diária desactivada',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao actualizar sincronização automática';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/bolt/test-connection', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z.object({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
      boltCompanyId: z.coerce.number().int().positive().optional(),
    }).parse(request.body);

    try {
      const data = await testBoltConnection(body);
      return reply.send({ success: true, data, message: 'Ligação Bolt OK' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no teste de ligação';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/bolt/sync', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z.object({
      workspaceId: z.string().uuid().optional(),
      type: syncTypeSchema.default('all'),
    }).parse(request.body ?? {});

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const results = await syncBoltData(workspaceId, body.type as BoltSyncType);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'bolt.sync_manual',
        entityType: 'bolt_connection',
        afterJson: { type: body.type, results },
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data: results, message: 'Sincronização concluída' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/bolt/dashboard', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        month: z.string().optional(),
        weekYear: z.coerce.number().optional(),
        week: z.coerce.number().optional(),
      })
      .parse(request.query);
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const driverUuids = await resolveDriverUuids(fastify, request, tenantId);
    const data = await getBoltDashboardStats(workspaceId, {
      driverUuids,
      monthKey: query.month,
      weekYear: query.weekYear,
      week: query.week,
    });
    const paidToDriver = isDriverRole(request.user.role as Role)
      ? await sumDriverPaymentReportsInMonth(
          fastify.db,
          tenantId,
          request.user.sub,
          query.month
        )
      : null;
    return reply.send({ success: true, data: { ...data, paidToDriver } });
  });

  fastify.get('/bolt/orders', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        q: z.string().optional(),
        page: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .parse(request.query);

    const q = parseSearchQuery(query.q);
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const driverUuids = await resolveDriverUuids(fastify, request, tenantId);

    const data = await listBoltOrders(workspaceId, {
      q,
      page: query.page,
      limit: query.limit ?? 50,
      driverUuids,
      startDate: query.startDate,
      endDate: query.endDate,
    });

    return reply.send({ success: true, data });
  });

  fastify.get('/bolt/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const driverUuids = await resolveDriverUuids(fastify, request, tenantId);

    const order = await fastify.db.boltOrder.findFirst({
      where: {
        id,
        workspaceId,
        ...(driverUuids != null
          ? driverUuids.length
            ? { driverUuid: { in: driverUuids } }
            : { id: { in: [] as string[] } }
          : {}),
      },
      include: { stops: { orderBy: { stopOrder: 'asc' } } },
    });
    if (!order) {
      return reply.status(404).send({ success: false, error: 'Pedido não encontrado' });
    }

    return reply.send({
      success: true,
      data: {
        ...order,
        ridePrice: order.ridePrice?.toString() ?? null,
        bookingFee: order.bookingFee?.toString() ?? null,
        tollFee: order.tollFee?.toString() ?? null,
      },
    });
  });

  fastify.patch('/bolt/orders/:id/paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await markBoltOrderPaid(workspaceId, id);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'bolt.mark_paid',
        entityType: 'bolt_order',
        entityId: id,
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Pedido marcado como pago' });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/bolt/orders/bulk/mark-paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        ids: z.array(z.string().uuid()).min(1).max(100),
      })
      .parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await bulkMarkBoltOrdersPaid(workspaceId, body.ids);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'bolt.bulk_mark_paid',
        entityType: 'bolt_order',
        afterJson: data,
        ipAddress: request.ip,
      });
      return reply.send({
        success: true,
        data,
        message: `${data.updated} pedido(s) marcado(s) como pago(s)`,
      });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/bolt/drivers', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const query = request.query as {
      workspaceId?: string;
      q?: string;
      status?: string;
      page?: string;
      limit?: string;
    };
    const q = parseSearchQuery(query.q);
    const page = Math.max(0, Number(query.page) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const where = {
      workspaceId,
      ...(query.status ? { portalStatus: query.status } : {}),
      ...(q ? textOr(q, ['name', 'phone', 'email']) : {}),
    };

    const [total, drivers] = await Promise.all([
      fastify.db.boltDriver.count({ where }),
      fastify.db.boltDriver.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: page * limit,
        take: limit,
      }),
    ]);

    return reply.send({
      success: true,
      data: { items: drivers, total, page, limit },
    });
  });

  fastify.get('/bolt/vehicles', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const query = request.query as {
      workspaceId?: string;
      q?: string;
      status?: string;
      page?: string;
      limit?: string;
    };
    const q = parseSearchQuery(query.q);
    const page = Math.max(0, Number(query.page) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const where = {
      workspaceId,
      ...(query.status ? { portalStatus: query.status } : {}),
      ...(q ? textOr(q, ['model', 'regNumber', 'vin']) : {}),
    };

    const [total, vehicles] = await Promise.all([
      fastify.db.boltVehicle.count({ where }),
      fastify.db.boltVehicle.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: page * limit,
        take: limit,
      }),
    ]);

    return reply.send({
      success: true,
      data: { items: vehicles, total, page, limit },
    });
  });

  fastify.get('/bolt/sync-logs', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const logs = await fastify.db.boltSyncLog.findMany({
      where: { workspaceId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });

    return reply.send({ success: true, data: logs });
  });
}
