import { prisma } from '@tvde/database';

interface AuditParams {
  tenantId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  ipAddress?: string | null;
}

function normalizeEntityId(entityId?: string | null): string | null {
  if (entityId == null) return null;
  const trimmed = String(entityId).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function createAuditLog(params: AuditParams) {
  return prisma.auditLog.create({
    data: {
      tenantId: params.tenantId ?? null,
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: normalizeEntityId(params.entityId),
      beforeJson: params.beforeJson ? (params.beforeJson as object) : undefined,
      afterJson: params.afterJson ? (params.afterJson as object) : undefined,
      ipAddress: params.ipAddress ?? null,
    },
  });
}
