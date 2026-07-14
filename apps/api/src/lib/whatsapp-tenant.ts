import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hasMinRole } from '@tvde/shared';

export function resolveWhatsappTenantId(request: FastifyRequest): string {
  if (request.user.role === 'master') {
    throw request.server.httpErrors.forbidden(
      'WhatsApp é configurado pelo superadmin de cada tenant'
    );
  }
  if (!request.user.tenantId) {
    throw request.server.httpErrors.badRequest('Tenant não definido');
  }
  return request.user.tenantId;
}

export function whatsappTenantAccess(fastify: FastifyInstance) {
  return async (request: FastifyRequest) => {
    if (request.user.role === 'master') {
      throw fastify.httpErrors.forbidden(
        'WhatsApp é configurado pelo superadmin de cada tenant'
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
