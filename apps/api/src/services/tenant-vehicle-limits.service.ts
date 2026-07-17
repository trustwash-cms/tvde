import type { PrismaClient } from '@tvde/database';
import {
  DEFAULT_LIMITS,
  isUserVehicleActive,
  vehicleLimitUsagePercent,
  type TenantVehicleLimits,
} from '@tvde/shared';

type TenantLimits = {
  max_vehicles?: number;
};

export class TenantVehicleLimitError extends Error {
  constructor(
    message = 'Limite de viaturas do tenant atingido',
    public readonly limits?: TenantVehicleLimits
  ) {
    super(message);
    this.name = 'TenantVehicleLimitError';
  }
}

export function getTenantMaxVehicles(limitsJson: unknown): number {
  const limits = (limitsJson ?? {}) as TenantLimits;
  const value = limits.max_vehicles;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return DEFAULT_LIMITS.max_vehicles;
}

export async function countActiveTenantVehicles(
  db: PrismaClient,
  tenantId: string,
  referenceDate = new Date()
): Promise<number> {
  const vehicles = await db.userVehicle.findMany({
    where: { tenantId },
    select: { dataFim: true },
  });

  return vehicles.filter((vehicle) => isUserVehicleActive(vehicle.dataFim, referenceDate)).length;
}

export async function getTenantVehicleLimits(
  db: PrismaClient,
  tenantId: string
): Promise<TenantVehicleLimits> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { limitsJson: true, plan: true, siteId: true, name: true },
  });

  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const maxVehicles = getTenantMaxVehicles(tenant.limitsJson);
  const activeCount = await countActiveTenantVehicles(db, tenantId);

  return {
    maxVehicles,
    activeCount,
    usagePercent: vehicleLimitUsagePercent(activeCount, maxVehicles),
    plan: tenant.plan,
    siteId: tenant.siteId,
    tenantName: tenant.name,
  };
}

export async function assertTenantCanAddActiveVehicle(
  db: PrismaClient,
  tenantId: string,
  willBeActive: boolean,
  excludeVehicleId?: string
): Promise<void> {
  if (!willBeActive) return;

  const limits = await getTenantVehicleLimits(db, tenantId);
  let activeCount = limits.activeCount;

  if (excludeVehicleId) {
    const existing = await db.userVehicle.findFirst({
      where: { id: excludeVehicleId, tenantId },
      select: { dataFim: true },
    });
    if (existing && isUserVehicleActive(existing.dataFim)) {
      activeCount = Math.max(0, activeCount - 1);
    }
  }

  if (activeCount + 1 > limits.maxVehicles) {
    throw new TenantVehicleLimitError(
      `Limite de viaturas atingido (${limits.activeCount}/${limits.maxVehicles}). Contacte o administrador para aumentar o plano.`,
      limits
    );
  }
}

export async function updateTenantMaxVehicles(
  db: PrismaClient,
  tenantId: string,
  maxVehicles: number
): Promise<TenantVehicleLimits> {
  if (!Number.isFinite(maxVehicles) || maxVehicles < 1) {
    throw new Error('Limite de viaturas inválido');
  }

  const activeCount = await countActiveTenantVehicles(db, tenantId);
  if (maxVehicles < activeCount) {
    throw new Error(
      `O novo limite (${maxVehicles}) não pode ser inferior às viaturas activas (${activeCount})`
    );
  }

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { limitsJson: true, plan: true, siteId: true, name: true },
  });

  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const limits = (tenant.limitsJson as Record<string, unknown>) ?? {};
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      limitsJson: {
        ...limits,
        max_vehicles: maxVehicles,
      },
    },
  });

  return getTenantVehicleLimits(db, tenantId);
}
