import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { createAuditLog } from '../services/audit.service';
import { isTenantModuleAllowed } from '../services/tenant-modules.service';
import { isRemovedModule } from '@tvde/shared';
import { parseSearchQuery } from '../services/search.service';

export async function workspaceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/workspaces', async (request, reply) => {
    const q = parseSearchQuery((request.query as { q?: string }).q);
    const where = request.user.role === 'master'
      ? {}
      : { tenantId: request.user.tenantId! };

    const searchWhere = q
      ? {
          AND: [
            where,
            {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { slug: { contains: q, mode: 'insensitive' as const } },
                { type: { contains: q, mode: 'insensitive' as const } },
                ...(request.user.role === 'master'
                  ? [
                      { tenant: { name: { contains: q, mode: 'insensitive' as const } } },
                      { tenant: { siteId: { contains: q, mode: 'insensitive' as const } } },
                    ]
                  : []),
              ],
            },
          ],
        }
      : where;

    const workspaces = await fastify.db.workspace.findMany({
      where: searchWhere,
      include: {
        tenant: { select: { id: true, name: true, siteId: true } },
        workspaceModules: { include: { module: true } },
        _count: { select: { users: true } },
      },
      orderBy: [{ tenant: { name: 'asc' } }, { name: 'asc' }],
    });
    return reply.send({ success: true, data: workspaces });
  });

  fastify.patch('/workspaces/:id/modules/:moduleKey', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id, moduleKey } = request.params as { id: string; moduleKey: string };
    const body = z.object({
      enabled: z.boolean(),
      configJson: z.record(z.unknown()).optional(),
    }).parse(request.body);

    const workspace = await fastify.db.workspace.findFirst({
      where: {
        id,
        ...(request.user.role !== 'master' ? { tenantId: request.user.tenantId! } : {}),
      },
    });

    if (!workspace) {
      throw fastify.httpErrors.notFound('Workspace não encontrado');
    }

    const moduleDef = await fastify.db.moduleRegistry.findUnique({ where: { key: moduleKey } });
    if (!moduleDef || isRemovedModule(moduleKey)) {
      throw fastify.httpErrors.notFound('Módulo não encontrado');
    }
    if (moduleDef.isCore) {
      throw fastify.httpErrors.badRequest('Módulos core não podem ser desactivados');
    }

    if (request.user.role === 'superadmin' && moduleKey === 'clients') {
      throw fastify.httpErrors.forbidden(
        'O módulo Clientes (CRM) é activado pelo MASTER — utilize Utilizadores para gerir a equipa'
      );
    }

    if (request.user.role !== 'master') {
      const allowed = await isTenantModuleAllowed(workspace.tenantId, moduleKey);
      if (!allowed) {
        throw fastify.httpErrors.forbidden(
          `Módulo "${moduleKey}" não autorizado pelo MASTER para este tenant`
        );
      }
    }

    const updated = await fastify.db.workspaceModule.upsert({
      where: { workspaceId_moduleKey: { workspaceId: id, moduleKey } },
      update: {
        enabled: body.enabled,
        configJson: (body.configJson ?? {}) as Prisma.InputJsonValue,
        enabledAt: body.enabled ? new Date() : null,
      },
      create: {
        workspaceId: id,
        moduleKey,
        enabled: body.enabled,
        configJson: (body.configJson ?? {}) as Prisma.InputJsonValue,
        enabledAt: body.enabled ? new Date() : null,
      },
    });

    await createAuditLog({
      tenantId: workspace.tenantId,
      userId: request.user.sub,
      action: body.enabled ? 'module.enable' : 'module.disable',
      entityType: 'workspace_module',
      entityId: updated.id,
      afterJson: { workspaceId: id, moduleKey, enabled: body.enabled },
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: updated });
  });
}
