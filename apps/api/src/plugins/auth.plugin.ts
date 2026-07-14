import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma, setTenantContext } from '@tvde/database';
import { hasMinRole } from '@tvde/shared';
import { getJwtAccessExpires } from '@tvde/shared/server';
import type { JwtPayload } from '@tvde/shared';
import { env } from '../config/env';
import { buildJwtPayload } from '../services/auth.service';
import { getBearerToken } from '../lib/request-auth';
import { isAccessTokenBlacklisted } from '../lib/token-blacklist';
import { TENANT_INACTIVE_LOGIN_MESSAGE } from '../lib/tenant-auth';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireRole: (role: JwtPayload['role']) => (request: FastifyRequest) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(import('@fastify/jwt'), {
    secret: env.jwtSecret,
    sign: { expiresIn: getJwtAccessExpires() },
  });

  fastify.decorate('authenticate', async (request: FastifyRequest) => {
    await request.jwtVerify();

    const accessToken = getBearerToken(request);
    if (accessToken && (await isAccessTokenBlacklisted(accessToken))) {
      throw fastify.httpErrors.unauthorized('Token revogado');
    }

    const session = await prisma.session.findFirst({
      where: {
        id: request.user.sessionId,
        userId: request.user.sub,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      throw fastify.httpErrors.unauthorized('Sessão inválida ou expirada');
    }

    if (request.user.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: request.user.tenantId },
        select: { status: true },
      });
      if (!tenant || tenant.status !== 'active') {
        throw fastify.httpErrors.forbidden(TENANT_INACTIVE_LOGIN_MESSAGE);
      }
      await setTenantContext(request.user.tenantId);
    }
  });

  fastify.decorate('requireRole', (minRole: JwtPayload['role']) => {
    return async (request: FastifyRequest) => {
      if (!hasMinRole(request.user.role, minRole)) {
        throw fastify.httpErrors.forbidden('Permissões insuficientes');
      }
    };
  });
});
