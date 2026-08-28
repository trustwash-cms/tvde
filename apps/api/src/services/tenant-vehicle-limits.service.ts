import type { PrismaClient } from '@tvde/database';
import {
  DEFAULT_LIMITS,
  VEHICLE_LIMIT_PLANS,
  getVehicleLimitPlanLabel,
  isUserVehicleActive,
  resolveVehicleLimitPlanType,
  vehicleLimitUsagePercent,
  type TenantVehicleLimits,
  type VehicleLimitPlanType,
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

function mapLimitsRow(
  tenant: {
    id: string;
    limitsJson: unknown;
    plan: string;
    siteId: string;
    name: string;
  },
  activeCount: number
): TenantVehicleLimits {
  const maxVehicles = getTenantMaxVehicles(tenant.limitsJson);
  return {
    tenantId: tenant.id,
    maxVehicles,
    activeCount,
    usagePercent: vehicleLimitUsagePercent(activeCount, maxVehicles),
    plan: tenant.plan,
    siteId: tenant.siteId,
    tenantName: tenant.name,
  };
}

export async function getTenantVehicleLimits(
  db: PrismaClient,
  tenantId: string
): Promise<TenantVehicleLimits> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, limitsJson: true, plan: true, siteId: true, name: true },
  });

  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const activeCount = await countActiveTenantVehicles(db, tenantId);
  return mapLimitsRow(tenant, activeCount);
}

/** Listagem MASTER: todos os tenants com uso de viaturas. */
export async function listAllTenantVehicleLimits(
  db: PrismaClient
): Promise<TenantVehicleLimits[]> {
  const [tenants, vehicles] = await Promise.all([
    db.tenant.findMany({
      select: { id: true, limitsJson: true, plan: true, siteId: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.userVehicle.findMany({
      select: { tenantId: true, dataFim: true },
    }),
  ]);

  const now = new Date();
  const activeByTenant = new Map<string, number>();
  for (const vehicle of vehicles) {
    if (!isUserVehicleActive(vehicle.dataFim, now)) continue;
    activeByTenant.set(vehicle.tenantId, (activeByTenant.get(vehicle.tenantId) ?? 0) + 1);
  }

  return tenants.map((tenant) => mapLimitsRow(tenant, activeByTenant.get(tenant.id) ?? 0));
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
  maxVehicles: number,
  options?: { planType?: VehicleLimitPlanType }
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
    select: { limitsJson: true, plan: true },
  });

  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const limits = (tenant.limitsJson as Record<string, unknown>) ?? {};
  const planType = options?.planType;
  const nextPlan = planType ? planType : tenant.plan;

  await db.tenant.update({
    where: { id: tenantId },
    data: {
      ...(planType ? { plan: planType } : {}),
      limitsJson: {
        ...limits,
        max_vehicles: maxVehicles,
      },
    },
  });

  const updated = await getTenantVehicleLimits(db, tenantId);
  return {
    ...updated,
    plan: nextPlan,
  };
}

/** Aplica um plano pré-definido (Gratuito / Standard / Business). */
export async function updateTenantVehiclePlan(
  db: PrismaClient,
  tenantId: string,
  planType: VehicleLimitPlanType
): Promise<TenantVehicleLimits> {
  const preset = VEHICLE_LIMIT_PLANS[planType];
  if (!preset) throw new Error('Plano inválido');
  return updateTenantMaxVehicles(db, tenantId, preset.maxVehicles, { planType });
}

export function describeVehicleLimitPlan(plan: string | null | undefined): string {
  return getVehicleLimitPlanLabel(plan);
}

export function inferPlanTypeFromMaxVehicles(maxVehicles: number): VehicleLimitPlanType {
  if (maxVehicles >= VEHICLE_LIMIT_PLANS.business.maxVehicles) return 'business';
  if (maxVehicles >= VEHICLE_LIMIT_PLANS.standard.maxVehicles) return 'standard';
  return resolveVehicleLimitPlanType('gratuito');
}
