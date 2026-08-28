import { prisma } from '@tvde/database';
import { createAuditLog } from './audit.service';

export class TenantSessionNotFoundError extends Error {
  constructor(message = 'Sessão não encontrada') {
    super(message);
    this.name = 'TenantSessionNotFoundError';
  }
}

const sessionSelect = {
  id: true,
  userId: true,
  tenantId: true,
  ipAddress: true,
  deviceInfo: true,
  userAgent: true,
  createdAt: true,
  expiresAt: true,
  user: {
    select: {
      id: true,
      email: true,
      username: true,
      fullName: true,
      role: true,
    },
  },
} as const;

export async function getTenantActiveSessions(tenantId: string) {
  return prisma.session.findMany({
    where: {
      tenantId,
      isActive: true,
      expiresAt: { gt: new Date() },
    },
    select: sessionSelect,
    orderBy: { createdAt: 'desc' },
  });
}

/** MASTER: sessões activas de todos os tenants (e sessões sem tenant, ex. MASTER). */
export async function listAllActiveSessions(options?: { tenantId?: string }) {
  const sessions = await prisma.session.findMany({
    where: {
      isActive: true,
      expiresAt: { gt: new Date() },
      ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
    },
    select: sessionSelect,
    orderBy: { createdAt: 'desc' },
  });

  const tenantIds = [
    ...new Set(sessions.map((s) => s.tenantId).filter((id): id is string => Boolean(id))),
  ];
  const tenants =
    tenantIds.length > 0
      ? await prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true, siteId: true },
        })
      : [];
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  return sessions.map((session) => {
    const tenant = session.tenantId ? tenantById.get(session.tenantId) : null;
    return {
      ...session,
      tenantName: tenant?.name ?? null,
      siteId: tenant?.siteId ?? null,
    };
  });
}

export async function revokeTenantSession(
  sessionId: string,
  tenantId: string,
  actorUserId: string,
  ipAddress?: string
): Promise<void> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, tenantId, isActive: true },
    select: { id: true, userId: true },
  });

  if (!session) {
    throw new TenantSessionNotFoundError();
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { isActive: false },
  });

  await createAuditLog({
    tenantId,
    userId: actorUserId,
    action: 'tenant.session.revoke',
    entityType: 'session',
    entityId: sessionId,
    afterJson: { revokedUserId: session.userId },
    ipAddress,
  });
}

/** MASTER: revoga qualquer sessão activa (excepto a sessão actual do actor, se passada). */
export async function revokeSessionAsMaster(
  sessionId: string,
  actorUserId: string,
  options?: { excludeSessionId?: string; ipAddress?: string }
): Promise<void> {
  if (options?.excludeSessionId && sessionId === options.excludeSessionId) {
    throw new Error('Não pode revogar a sua própria sessão actual');
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, isActive: true },
    select: { id: true, userId: true, tenantId: true },
  });

  if (!session) {
    throw new TenantSessionNotFoundError();
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { isActive: false },
  });

  await createAuditLog({
    tenantId: session.tenantId,
    userId: actorUserId,
    action: 'tenant.session.revoke',
    entityType: 'session',
    entityId: sessionId,
    afterJson: { revokedUserId: session.userId, scope: 'master' },
    ipAddress: options?.ipAddress,
  });
}

/**
 * MASTER: termina todas as sessões activas (opcionalmente de um tenant).
 * A sessão actual do MASTER nunca é revogada.
 */
export async function revokeAllSessionsAsMaster(input: {
  actorUserId: string;
  excludeSessionId: string;
  tenantId?: string;
  ipAddress?: string;
}): Promise<{ revoked: number }> {
  const where = {
    isActive: true,
    expiresAt: { gt: new Date() },
    id: { not: input.excludeSessionId },
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  };

  const result = await prisma.session.updateMany({
    where,
    data: { isActive: false },
  });

  await createAuditLog({
    tenantId: input.tenantId ?? null,
    userId: input.actorUserId,
    action: 'tenant.session.revoke_all',
    entityType: 'session',
    afterJson: {
      revoked: result.count,
      tenantId: input.tenantId ?? null,
      excludeSessionId: input.excludeSessionId,
    },
    ipAddress: input.ipAddress,
  });

  return { revoked: result.count };
}
