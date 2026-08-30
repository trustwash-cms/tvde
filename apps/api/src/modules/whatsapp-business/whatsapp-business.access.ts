import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hasMinRole } from '@tvde/shared';
import { resolveWhatsappTenantId } from '../../lib/whatsapp-tenant';

export function whatsappBusinessAccess(fastify: FastifyInstance) {
  return async (request: FastifyRequest) => {
    if (request.user.role === 'master') return;
    if (!hasMinRole(request.user.role, 'superadmin')) {
      throw fastify.httpErrors.forbidden('Permissões insuficientes');
    }
    if (!request.user.tenantId) {
      throw fastify.httpErrors.badRequest('Tenant não definido');
    }
    await fastify.requireModule('whatsapp')(request);
  };
}

export async function resolveWhatsappBusinessTenantId(request: FastifyRequest): Promise<string> {
  return resolveWhatsappTenantId(request);
}
