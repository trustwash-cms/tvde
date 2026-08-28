import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAuditLog } from '../services/audit.service';
import { getTenantStorageSummary, updateTenantStorageLimit } from '../services/tenant-storage.service';
import {
  getTenantActiveSessions,
  listAllActiveSessions,
  revokeAllSessionsAsMaster,
  revokeSessionAsMaster,
  revokeTenantSession,
  TenantSessionNotFoundError,
} from '../services/tenant-session.service';
import { updateTenantMaxVehicles, updateTenantVehiclePlan } from '../services/tenant-vehicle-limits.service';

function mapSessionRow(
  session: Awaited<ReturnType<typeof getTenantActiveSessions>>[number] & {
    tenantName?: string | null;
    siteId?: string | null;
  }
) {
  return {
    id: session.id,
    userId: session.userId,
    tenantId: session.tenantId ?? null,
    tenantName: session.tenantName ?? null,
    siteId: session.siteId ?? null,
    ipAddress: session.ipAddress,
    deviceInfo: session.deviceInfo,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    user: session.user,
  };
}

export async function tvdeSettingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/tenants/current/storage', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    if (!request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Sem tenant associado' });
    }

    try {
      const data = await getTenantStorageSummary(fastify.db, request.user.tenantId);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao obter storage';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/tenants/current/sessions', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    if (!request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Sem tenant associado' });
    }

    const sessions = await getTenantActiveSessions(request.user.tenantId);
    return reply.send({ success: true, data: sessions.map(mapSessionRow) });
  });

  fastify.delete('/tenants/current/sessions/:sessionId', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    if (!request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Sem tenant associado' });
    }

    const { sessionId } = request.params as { sessionId: string };

    try {
      await revokeTenantSession(
        sessionId,
        request.user.tenantId,
        request.user.sub,
        request.ip
      );
      return reply.send({ success: true, message: 'Sessão revogada' });
    } catch (err) {
      if (err instanceof TenantSessionNotFoundError) {
        return reply.status(404).send({ success: false, error: err.message });
      }
      const message = err instanceof Error ? err.message : 'Não foi possível revogar sessão';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  /** MASTER: listar sessões activas (todas ou por tenant). */
  fastify.get('/tenants/sessions', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const query = z
      .object({ tenantId: z.string().uuid().optional() })
      .parse(request.query ?? {});
    const sessions = await listAllActiveSessions({ tenantId: query.tenantId });
    return reply.send({ success: true, data: sessions.map(mapSessionRow) });
  });

  fastify.delete('/tenants/sessions/:sessionId', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      await revokeSessionAsMaster(sessionId, request.user.sub, {
        excludeSessionId: request.user.sessionId,
        ipAddress: request.ip,
      });
      return reply.send({ success: true, message: 'Sessão revogada' });
    } catch (err) {
      if (err instanceof TenantSessionNotFoundError) {
        return reply.status(404).send({ success: false, error: err.message });
      }
      const message = err instanceof Error ? err.message : 'Não foi possível revogar sessão';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  /** MASTER: terminar todas as sessões (excepto a actual). Opcional: filtrar por tenant. */
  fastify.post('/tenants/sessions/revoke-all', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const body = z
      .object({ tenantId: z.string().uuid().optional() })
      .parse(request.body ?? {});

    const data = await revokeAllSessionsAsMaster({
      actorUserId: request.user.sub,
      excludeSessionId: request.user.sessionId,
      tenantId: body.tenantId,
      ipAddress: request.ip,
    });

    return reply.send({
      success: true,
      data,
      message:
        data.revoked === 0
          ? 'Nenhuma sessão a revogar'
          : `${data.revoked} sessão(ões) revogada(s)`,
    });
  });

  fastify.patch('/tenants/:id/limits', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        maxVehicles: z.number().int().min(1).optional(),
        planType: z.enum(['gratuito', 'standard', 'business']).optional(),
        storageGb: z.number().positive().optional(),
      })
      .parse(request.body);

    if (
      body.maxVehicles === undefined &&
      body.planType === undefined &&
      body.storageGb === undefined
    ) {
      return reply.status(400).send({ success: false, error: 'Nada para actualizar' });
    }

    const tenant = await fastify.db.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return reply.status(404).send({ success: false, error: 'Tenant não encontrado' });
    }

    try {
      let vehicleLimits;
      let storageSummary;

      if (body.planType !== undefined) {
        if (body.maxVehicles !== undefined) {
          vehicleLimits = await updateTenantMaxVehicles(fastify.db, id, body.maxVehicles, {
            planType: body.planType,
          });
        } else {
          vehicleLimits = await updateTenantVehiclePlan(fastify.db, id, body.planType);
        }
      } else if (body.maxVehicles !== undefined) {
        vehicleLimits = await updateTenantMaxVehicles(fastify.db, id, body.maxVehicles);
      }

      if (body.storageGb !== undefined) {
        storageSummary = await updateTenantStorageLimit(fastify.db, id, body.storageGb);
      }

      await createAuditLog({
        tenantId: id,
        userId: request.user.sub,
        action: 'tenant.limits.update',
        entityType: 'tenant',
        entityId: id,
        afterJson: {
          ...(body.maxVehicles !== undefined ? { max_vehicles: body.maxVehicles } : {}),
          ...(body.planType !== undefined ? { plan_type: body.planType } : {}),
          ...(body.storageGb !== undefined ? { storage_gb: body.storageGb } : {}),
        },
        ipAddress: request.ip,
      });

      return reply.send({
        success: true,
        data: vehicleLimits ?? storageSummary,
        vehicleLimits,
        storage: storageSummary,
        message: 'Limites actualizados',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível actualizar limites';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}
