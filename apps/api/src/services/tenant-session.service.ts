import { prisma } from '@tvde/database';
import { createAuditLog } from './audit.service';

export class TenantSessionNotFoundError extends Error {
  constructor(message = 'Sessão não encontrada') {
    super(message);
    this.name = 'TenantSessionNotFoundError';
  }
}

export async function getTenantActiveSessions(tenantId: string) {
  return prisma.session.findMany({
    where: {
      tenantId,
      isActive: true,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      userId: true,
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
    },
    orderBy: { createdAt: 'desc' },
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
