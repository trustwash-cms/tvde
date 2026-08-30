import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAuditLog } from '../services/audit.service';
import { seedTenantModules, setTenantModuleAllowed } from '../services/tenant-modules.service';
import { createWorkspaceWithModules } from '../services/workspace.service';
import {
  provisionTenantSuperadmin,
  resendTenantSuperadminCredentials,
  findProvisionedSuperadmin,
} from '../services/tenant-provisioning.service';
import { DEFAULT_LIMITS } from '@tvde/shared';
import { parseSearchQuery, textOr } from '../services/search.service';
import {
  sendTenantDeleteConfirmationCode,
  verifyTenantDeleteConfirmationCode,
} from '../services/action-confirmation.service';
import {
  isPlatformWhatsappTenant,
  platformWhatsappTenantExcludeWhere,
} from '../lib/whatsapp-tenant';
import {
  getTenantVehicleLimits,
  listAllTenantVehicleLimits,
} from '../services/tenant-vehicle-limits.service';
import { listAllTenantStorageSummaries } from '../services/tenant-storage.service';

export async function tenantRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/tenants', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const q = parseSearchQuery((request.query as { q?: string }).q);
    const tenants = await fastify.db.tenant.findMany({
      where: q
        ? { AND: [platformWhatsappTenantExcludeWhere, textOr(q, ['name', 'siteId'])] }
        : platformWhatsappTenantExcludeWhere,
      include: {
        _count: { select: { workspaces: true, users: true } },
        tenantModules: { include: { module: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const tenantIds = tenants.map((t) => t.id);
    const provisionedAdmins = tenantIds.length
      ? await fastify.db.user.findMany({
          where: {
            tenantId: { in: tenantIds },
            role: 'superadmin',
            mustChangePassword: true,
          },
          select: {
            tenantId: true,
            email: true,
            tempPasswordExpiresAt: true,
          },
        })
      : [];

    const adminByTenant = new Map(provisionedAdmins.map((a) => [a.tenantId, a]));
    const now = new Date();

    const data = tenants.map((tenant) => {
      const admin = adminByTenant.get(tenant.id);
      return {
        ...tenant,
        provisionedAdmin: admin
          ? {
              email: admin.email,
              canResendCredentials: true,
              tempPasswordExpired: admin.tempPasswordExpiresAt
                ? admin.tempPasswordExpiresAt < now
                : false,
            }
          : null,
      };
    });

    return reply.send({ success: true, data });
  });

  fastify.get('/tenants/current', async (request, reply) => {
    if (!request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Sem tenant associado' });
    }
    const tenant = await fastify.db.tenant.findUnique({
      where: { id: request.user.tenantId },
      include: {
        workspaces: true,
        tenantModules: { include: { module: true } },
      },
    });
    return reply.send({ success: true, data: tenant });
  });

  fastify.get('/tenants/current/vehicle-limits', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    if (!request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Sem tenant associado' });
    }

    const data = await getTenantVehicleLimits(fastify.db, request.user.tenantId);
    return reply.send({ success: true, data });
  });

  /** MASTER: limites de viaturas de todos os tenants. */
  fastify.get('/tenants/vehicle-limits', {
    preHandler: [fastify.requireRole('master')],
  }, async (_request, reply) => {
    const data = await listAllTenantVehicleLimits(fastify.db);
    return reply.send({ success: true, data });
  });

  /** MASTER: quotas de storage de todos os tenants. */
  fastify.get('/tenants/storage', {
    preHandler: [fastify.requireRole('master')],
  }, async (_request, reply) => {
    const data = await listAllTenantStorageSummaries(fastify.db);
    return reply.send({ success: true, data });
  });

  fastify.post('/tenants', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const body = z.object({
      siteId: z.string().min(2).regex(/^[a-z0-9-]+$/),
      name: z.string().min(2),
      plan: z.string().default('starter'),
      limitsJson: z.record(z.unknown()).optional(),
      adminEmail: z.string().email().optional(),
    }).parse(request.body);

    if (body.adminEmail) {
      const existing = await fastify.db.user.findUnique({
        where: { email: body.adminEmail.toLowerCase() },
      });
      if (existing) {
        return reply.status(409).send({ success: false, error: 'Email já registado' });
      }
    }

    const tenant = await fastify.db.tenant.create({
      data: {
        siteId: body.siteId,
        name: body.name,
        plan: body.plan,
        limitsJson: {
          ...DEFAULT_LIMITS,
          ...(body.limitsJson ?? {}),
          max_workspaces: 1,
        },
      },
    });

    await seedTenantModules(tenant.id, true);

    const workspace = await createWorkspaceWithModules(fastify.db, {
      tenantId: tenant.id,
      name: 'Workspace Principal',
      slug: 'principal',
      type: 'general',
    });

    let adminUser: { id: string; email: string } | null = null;
    if (body.adminEmail) {
      try {
        const result = await provisionTenantSuperadmin({
          tenantId: tenant.id,
          workspaceId: workspace.id,
          email: body.adminEmail,
          actorUserId: request.user.sub,
          ipAddress: request.ip,
        });
        adminUser = result.adminUser;
      } catch (err) {
        await fastify.db.tenant.delete({ where: { id: tenant.id } });
        const message = err instanceof Error ? err.message : 'Provisionamento falhou';
        return reply.status(400).send({ success: false, error: message });
      }
    }

    await createAuditLog({
      userId: request.user.sub,
      action: 'tenant.create',
      entityType: 'tenant',
      entityId: tenant.id,
      afterJson: tenant,
      ipAddress: request.ip,
    });

    return reply.status(201).send({
      success: true,
      data: { tenant, adminUser },
    });
  });

  fastify.post('/tenants/:id/resend-admin-credentials', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const tenant = await fastify.db.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw fastify.httpErrors.notFound('Tenant não encontrado');
    }

    const pending = await findProvisionedSuperadmin(id);
    if (!pending) {
      return reply.status(400).send({
        success: false,
        error:
          'Não é possível reenviar credenciais — o cliente já activou a conta. Deve usar «Esqueci a password» no login.',
      });
    }

    try {
      const result = await resendTenantSuperadminCredentials({
        tenantId: id,
        actorUserId: request.user.sub,
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reenvio falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.patch('/tenants/:id/modules/:moduleKey', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { id, moduleKey } = request.params as { id: string; moduleKey: string };
    const body = z.object({ allowed: z.boolean() }).parse(request.body);

    const tenant = await fastify.db.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw fastify.httpErrors.notFound('Tenant não encontrado');
    }

    if (isPlatformWhatsappTenant(tenant)) {
      throw fastify.httpErrors.notFound('Tenant não encontrado');
    }

    const moduleDef = await fastify.db.moduleRegistry.findUnique({ where: { key: moduleKey } });
    if (!moduleDef) {
      throw fastify.httpErrors.notFound('Módulo não encontrado');
    }
    if (moduleDef.isCore) {
      throw fastify.httpErrors.badRequest('Módulos core são sempre permitidos');
    }

    const updated = await setTenantModuleAllowed(id, moduleKey, body.allowed);

    await createAuditLog({
      tenantId: id,
      userId: request.user.sub,
      action: body.allowed ? 'tenant_module.allow' : 'tenant_module.deny',
      entityType: 'tenant_module',
      entityId: updated.id,
      afterJson: { tenantId: id, moduleKey, allowed: body.allowed },
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: updated });
  });

  fastify.patch('/tenants/:id', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      status: z.enum(['active', 'inactive']),
    }).parse(request.body);

    const tenant = await fastify.db.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw fastify.httpErrors.notFound('Tenant não encontrado');
    }

    if (isPlatformWhatsappTenant(tenant)) {
      return reply.status(403).send({
        success: false,
        error: 'O tenant interno da plataforma não pode ser alterado',
      });
    }

    const updated = await fastify.db.tenant.update({
      where: { id },
      data: { status: body.status },
    });

    if (body.status === 'inactive') {
      await fastify.db.session.updateMany({
        where: { tenantId: id, isActive: true },
        data: { isActive: false },
      });
    }

    await createAuditLog({
      userId: request.user.sub,
      action: body.status === 'active' ? 'tenant.activate' : 'tenant.deactivate',
      entityType: 'tenant',
      entityId: id,
      beforeJson: { status: tenant.status },
      afterJson: { status: body.status },
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: updated });
  });

  fastify.post('/tenants/:id/delete-confirmation', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const tenant = await fastify.db.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw fastify.httpErrors.notFound('Tenant não encontrado');
    }

    if (isPlatformWhatsappTenant(tenant)) {
      return reply.status(403).send({
        success: false,
        error: 'O tenant interno da plataforma não pode ser eliminado',
      });
    }

    try {
      const result = await sendTenantDeleteConfirmationCode(request.user.sub, tenant);
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Envio falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/tenants/:id', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      confirmSiteId: z.string().min(1),
      confirmationCode: z.string().min(6).max(6),
    }).parse(request.body ?? {});

    const tenant = await fastify.db.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw fastify.httpErrors.notFound('Tenant não encontrado');
    }

    if (isPlatformWhatsappTenant(tenant)) {
      return reply.status(403).send({
        success: false,
        error: 'O tenant interno da plataforma não pode ser eliminado',
      });
    }

    if (body.confirmSiteId.trim() !== tenant.siteId) {
      return reply.status(400).send({
        success: false,
        error: 'Site ID de confirmação não coincide',
      });
    }

    try {
      await verifyTenantDeleteConfirmationCode(
        request.user.sub,
        id,
        body.confirmationCode.trim()
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Código inválido';
      return reply.status(400).send({ success: false, error: message });
    }

    await createAuditLog({
      userId: request.user.sub,
      action: 'tenant.delete',
      entityType: 'tenant',
      entityId: id,
      beforeJson: { siteId: tenant.siteId, name: tenant.name },
      ipAddress: request.ip,
    });

    await fastify.db.tenant.delete({ where: { id } });

    return reply.send({ success: true, message: 'Tenant eliminado' });
  });
}
