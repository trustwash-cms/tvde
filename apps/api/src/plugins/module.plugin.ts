import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isTenantModuleAllowed } from '../services/tenant-modules.service';

declare module 'fastify' {
  interface FastifyInstance {
    requireModule: (moduleKey: string) => (request: FastifyRequest) => Promise<void>;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate('requireModule', (moduleKey: string) => {
    return async (request: FastifyRequest) => {
      if (request.user.role === 'master') return;

      const workspaceId =
        (request.query as { workspaceId?: string }).workspaceId ??
        (request.body as { workspaceId?: string } | undefined)?.workspaceId ??
        request.user.workspaceId;

      if (!workspaceId) {
        throw fastify.httpErrors.badRequest('workspaceId obrigatório');
      }

      if (request.user.tenantId) {
        const tenantAllowed = await isTenantModuleAllowed(request.user.tenantId, moduleKey);
        if (!tenantAllowed) {
          throw fastify.httpErrors.forbidden(
            `Módulo "${moduleKey}" não autorizado para este tenant`
          );
        }
      }

      const mod = await fastify.db.workspaceModule.findFirst({
        where: { workspaceId, moduleKey, enabled: true },
      });

      if (!mod) {
        throw fastify.httpErrors.forbidden(`Módulo "${moduleKey}" não activo neste workspace`);
      }
    };
  });
});
