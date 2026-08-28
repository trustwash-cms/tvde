import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hasMinRole } from '@tvde/shared';
import { resolveWhatsappTenantId } from '../../lib/whatsapp-tenant';

export function whatsappBusinessAccess(fastify: FastifyInstance) {
  return async (request: FastifyRequest) => {
    if (request.user.role === 'master') {
      throw fastify.httpErrors.forbidden(
        'WhatsApp Business API é configurada pelo superadmin de cada tenant'
      );
    }
    if (!hasMinRole(request.user.role, 'superadmin')) {
      throw fastify.httpErrors.forbidden('Permissões insuficientes');
    }
    if (!request.user.tenantId) {
      throw fastify.httpErrors.badRequest('Tenant não definido');
    }
    await fastify.requireModule('whatsapp')(request);
  };
}

export function resolveWhatsappBusinessTenantId(request: FastifyRequest): string {
  return resolveWhatsappTenantId(request);
}
