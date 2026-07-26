import type { FastifyInstance } from 'fastify';
import { isDriverRole, type Role } from '@tvde/shared';
import { getModuleCapabilities } from '../services/tenant-modules.service';
import { getDriverSummary } from '../services/driver-dashboard.service';

export async function driverDashboardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/dashboard/driver-summary', async (request, reply) => {
    if (!isDriverRole(request.user.role as Role)) {
      return reply.status(403).send({ success: false, error: 'Apenas para motoristas' });
    }
    if (!request.user.tenantId) {
      return reply.status(400).send({ success: false, error: 'Tenant em falta' });
    }

    const user = await fastify.db.user.findUnique({
      where: { id: request.user.sub },
      select: {
        email: true,
        fullName: true,
        username: true,
        workspaceId: true,
      },
    });
    if (!user) {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    const capabilities = await getModuleCapabilities(
      request.user.role,
      request.user.tenantId,
      request.user.workspaceId
    );

    const data = await getDriverSummary(fastify.db, {
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      role: request.user.role as Role,
      workspaceId: user.workspaceId ?? request.user.workspaceId,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      activeModules: capabilities.activeModules,
    });

    return reply.send({ success: true, data });
  });
}
