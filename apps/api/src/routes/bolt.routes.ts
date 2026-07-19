import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BoltSyncType } from '@tvde/bolt';
import { createAuditLog } from '../services/audit.service';
import { resolveWorkspaceTenantScope } from '../lib/workspace-scope';
import { parseSearchQuery, textOr } from '../services/search.service';
import {
  getBoltPublicStatus,
  saveBoltConfig,
  testBoltConnection,
} from '../services/bolt.service';
import {
  getBoltDashboardStats,
  listBoltOrders,
  syncBoltData,
} from '../services/bolt-sync.service';

const syncTypeSchema = z.enum(['orders', 'drivers', 'vehicles', 'all']);

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
    const query = request.query as { workspaceId?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await getBoltDashboardStats(workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.get('/bolt/orders', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        q: z.string().optional(),
        page: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    const q = parseSearchQuery(query.q);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await listBoltOrders(workspaceId, {
      q,
      page: query.page,
      limit: query.limit ?? 50,
    });

    return reply.send({ success: true, data });
  });

  fastify.get('/bolt/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const order = await fastify.db.boltOrder.findFirst({
      where: { id, workspaceId },
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

  fastify.get('/bolt/drivers', async (request, reply) => {
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

  fastify.get('/bolt/vehicles', async (request, reply) => {
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
