import type { PrismaClient } from '@prisma/client';
import { DEFAULT_LIMITS } from '@tvde/shared';
import { isRemovedModule } from '@tvde/shared';

type Db = Pick<
  PrismaClient,
  'workspace' | 'workspaceModule' | 'moduleRegistry' | 'tenantModule' | 'tenant'
>;

export function getMaxWorkspaces(limitsJson: unknown): number {
  const limits = limitsJson as Record<string, unknown> | null;
  const value = limits?.max_workspaces;
  if (typeof value === 'number' && value >= 1) return value;
  return DEFAULT_LIMITS.max_workspaces;
}

export async function createWorkspaceWithModules(
  db: Db,
  input: { tenantId: string; name: string; slug: string; type?: string }
) {
  const workspace = await db.workspace.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      slug: input.slug,
      type: input.type ?? 'general',
    },
  });

  const coreModules = await db.moduleRegistry.findMany({ where: { isCore: true } });
  const allowedBusiness = await db.tenantModule.findMany({
    where: { tenantId: input.tenantId, allowed: true },
    select: { moduleKey: true },
  });

  for (const mod of coreModules) {
    await db.workspaceModule.create({
      data: {
        workspaceId: workspace.id,
        moduleKey: mod.key,
        enabled: true,
        enabledAt: new Date(),
      },
    });
  }

  for (const { moduleKey } of allowedBusiness) {
    if (isRemovedModule(moduleKey)) continue;
    await db.workspaceModule.create({
      data: {
        workspaceId: workspace.id,
        moduleKey,
        enabled: false,
      },
    });
  }

  return workspace;
}

export async function incrementMaxWorkspaces(db: Pick<PrismaClient, 'tenant'>, tenantId: string) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const current = getMaxWorkspaces(tenant.limitsJson);
  const limits = (tenant.limitsJson as Record<string, unknown>) ?? {};

  await db.tenant.update({
    where: { id: tenantId },
    data: {
      limitsJson: { ...limits, max_workspaces: current + 1 },
    },
  });
}

export async function getWorkspaceQuota(db: Db, tenantId: string) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const maxWorkspaces = getMaxWorkspaces(tenant.limitsJson);
  const used = await db.workspace.count({ where: { tenantId } });
  return {
    maxWorkspaces,
    used,
    canRequestMore: used >= maxWorkspaces,
  };
}
