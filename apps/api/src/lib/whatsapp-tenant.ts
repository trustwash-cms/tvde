import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@tvde/database';
import { hasMinRole } from '@tvde/shared';

/** Tenant interno da sessão WhatsApp da plataforma (MASTER). Não aparece nas listagens. */
export const PLATFORM_WHATSAPP_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const PLATFORM_WHATSAPP_SITE_ID = '__platform__';

export const platformWhatsappTenantExcludeWhere = {
  id: { not: PLATFORM_WHATSAPP_TENANT_ID },
  siteId: { not: PLATFORM_WHATSAPP_SITE_ID },
} as const;

let cachedPlatformTenantId: string | null = null;

export function isPlatformWhatsappTenantId(tenantId: string | null | undefined): boolean {
  return tenantId === PLATFORM_WHATSAPP_TENANT_ID;
}

export function isPlatformWhatsappTenant(tenant: { id?: string; siteId?: string }): boolean {
  return tenant.id === PLATFORM_WHATSAPP_TENANT_ID || tenant.siteId === PLATFORM_WHATSAPP_SITE_ID;
}

export async function ensurePlatformWhatsappTenant(): Promise<string> {
  if (cachedPlatformTenantId) return cachedPlatformTenantId;

  const existing = await prisma.tenant.findFirst({
    where: {
      OR: [{ id: PLATFORM_WHATSAPP_TENANT_ID }, { siteId: PLATFORM_WHATSAPP_SITE_ID }],
    },
    select: { id: true },
  });
  if (existing) {
    cachedPlatformTenantId = existing.id;
    return existing.id;
  }

  const created = await prisma.tenant.create({
    data: {
      id: PLATFORM_WHATSAPP_TENANT_ID,
      siteId: PLATFORM_WHATSAPP_SITE_ID,
      name: 'Plataforma',
      plan: 'platform',
    },
    select: { id: true },
  });
  cachedPlatformTenantId = created.id;
  return created.id;
}

export async function resolveWhatsappSessionTenantId(
  role: string,
  userTenantId: string | null | undefined
): Promise<string> {
  if (role === 'master') {
    return ensurePlatformWhatsappTenant();
  }
  if (!userTenantId) {
    throw new Error('Tenant não definido');
  }
  return userTenantId;
}

export async function resolveWhatsappTenantId(request: FastifyRequest): Promise<string> {
  if (request.user.role === 'master') {
    return ensurePlatformWhatsappTenant();
  }
  if (!request.user.tenantId) {
    throw request.server.httpErrors.badRequest('Tenant não definido');
  }
  return request.user.tenantId;
}

export function whatsappTenantAccess(fastify: FastifyInstance) {
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
