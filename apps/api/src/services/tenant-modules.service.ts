import { prisma } from '@tvde/database';
import type { Role } from '@tvde/shared';
import { filterTvdeModules, isRemovedModule } from '@tvde/shared';

export interface ModuleCapabilities {
  allowedModules: string[];
  activeModules: string[];
}

/** Módulos de negócio permitidos pelo MASTER para este tenant. */
export async function getTenantAllowedModuleKeys(tenantId: string): Promise<string[]> {
  const rows = await prisma.tenantModule.findMany({
    where: { tenantId, allowed: true },
    select: { moduleKey: true },
  });
  return rows.map((r) => r.moduleKey).filter((key) => !isRemovedModule(key));
}

export async function isTenantModuleAllowed(tenantId: string, moduleKey: string): Promise<boolean> {
  const row = await prisma.tenantModule.findUnique({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
  });
  return row?.allowed ?? false;
}

/** Cria entradas tenant_modules para todos os módulos de negócio (default: allowed). */
export async function seedTenantModules(tenantId: string, allowed = true) {
  const business = filterTvdeModules(
    await prisma.moduleRegistry.findMany({
      where: { isCore: false },
      select: { key: true },
    })
  );

  for (const mod of business) {
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleKey: { tenantId, moduleKey: mod.key } },
      update: {},
      create: {
        tenantId,
        moduleKey: mod.key,
        allowed,
        allowedAt: allowed ? new Date() : null,
      },
    });
  }
}

/** MASTER activa/desactiva módulo ao nível do tenant; desactiva também nos workspaces. */
export async function setTenantModuleAllowed(
  tenantId: string,
  moduleKey: string,
  allowed: boolean
) {
  const mod = await prisma.moduleRegistry.findUnique({ where: { key: moduleKey } });
  if (!mod || mod.isCore || isRemovedModule(moduleKey)) {
    throw new Error('Módulo inválido ou core');
  }

  const updated = await prisma.tenantModule.upsert({
    where: { tenantId_moduleKey: { tenantId, moduleKey } },
    update: { allowed, allowedAt: allowed ? new Date() : null },
    create: { tenantId, moduleKey, allowed, allowedAt: allowed ? new Date() : null },
  });

  if (!allowed) {
    await prisma.workspaceModule.updateMany({
      where: { moduleKey, workspace: { tenantId } },
      data: { enabled: false, enabledAt: null },
    });
  }

  return updated;
}

/** allowed = o que o MASTER deixou; active = allowed + activo no workspace do user. */
export async function getModuleCapabilities(
  role: Role,
  tenantId: string | null,
  workspaceId: string | null
): Promise<ModuleCapabilities> {
  if (role === 'master') {
    const business = filterTvdeModules(
      await prisma.moduleRegistry.findMany({
        where: { isCore: false },
        select: { key: true },
      })
    );
    const keys = business.map((m) => m.key);
    return { allowedModules: keys, activeModules: keys };
  }

  if (!tenantId) {
    return { allowedModules: [], activeModules: [] };
  }

  const allowedModules = await getTenantAllowedModuleKeys(tenantId);

  if (!workspaceId) {
    return { allowedModules, activeModules: [] };
  }

  const enabled = await prisma.workspaceModule.findMany({
    where: {
      workspaceId,
      moduleKey: { in: allowedModules },
      enabled: true,
    },
    select: { moduleKey: true },
  });

  return {
    allowedModules,
    activeModules: enabled.map((w) => w.moduleKey),
  };
}
