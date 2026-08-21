import type { Prisma, PrismaClient } from '@tvde/database';
import {
  VIA_VERDE_PAGE_SIZE,
  getMonthUtcRange,
  type ViaVerdeDashboardStats,
  type ViaVerdeMovementItem,
} from '@tvde/shared';
import type { Role } from '@tvde/shared';
import { getDriverFleetScope } from './user-vehicle-matching.service';

function decimalToString(value: Prisma.Decimal | number | string): string {
  return String(value);
}

function mapMovement(row: {
  id: string;
  licensePlate: string;
  entryDate: Date | null;
  systemEntryDate: Date | null;
  entryPoint: string | null;
  exitPoint: string | null;
  value: Prisma.Decimal;
  isPaid: boolean;
  paymentDate: Date | null;
  serviceDescription: string | null;
  userId: string | null;
}): ViaVerdeMovementItem {
  return {
    id: row.id,
    licensePlate: row.licensePlate,
    entryDate: row.entryDate?.toISOString() ?? null,
    systemEntryDate: row.systemEntryDate?.toISOString() ?? null,
    entryPoint: row.entryPoint,
    exitPoint: row.exitPoint,
    value: decimalToString(row.value),
    isPaid: row.isPaid,
    paymentDate: row.paymentDate?.toISOString() ?? null,
    serviceDescription: row.serviceDescription,
    userId: row.userId,
  };
}

function parseDateFilter(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const dt = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

async function buildWhere(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  filters: {
    licensePlate?: string;
    startDate?: string;
    endDate?: string;
    isPaid?: boolean;
  }
): Promise<Prisma.ViaVerdeMovementWhereInput> {
  const where: Prisma.ViaVerdeMovementWhereInput = { tenantId };

  if (filters.licensePlate?.trim()) {
    where.licensePlate = { contains: filters.licensePlate.trim(), mode: 'insensitive' };
  }

  const start = parseDateFilter(filters.startDate);
  const end = parseDateFilter(filters.endDate);
  if (start || end) {
    where.entryDate = {};
    if (start) where.entryDate.gte = start;
    if (end) {
      const endOfDay = new Date(end);
      endOfDay.setUTCHours(23, 59, 59, 999);
      where.entryDate.lte = endOfDay;
    }
  }

  if (filters.isPaid !== undefined) {
    where.isPaid = filters.isPaid;
  }

  const scope = await getDriverFleetScope(db, tenantId, actorId, actorRole);
  if (scope) {
    where.OR = [
      { userId: actorId },
      ...(scope.plates.length ? [{ licensePlate: { in: scope.plates } }] : []),
    ];
  }

  return where;
}

export async function getViaVerdeDashboard(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  monthKey?: string
): Promise<ViaVerdeDashboardStats> {
  const baseWhere = await buildWhere(db, tenantId, actorId, actorRole, {});
  const { start, endExclusive, key } = getMonthUtcRange(monthKey);

  const [totalMovements, unpaidAgg, monthAgg] = await Promise.all([
    db.viaVerdeMovement.count({ where: baseWhere }),
    db.viaVerdeMovement.aggregate({
      where: { ...baseWhere, isPaid: false },
      _count: { _all: true },
      _sum: { value: true },
    }),
    db.viaVerdeMovement.aggregate({
      where: {
        ...baseWhere,
        entryDate: { gte: start, lt: endExclusive },
      },
      _sum: { value: true },
    }),
  ]);

  return {
    totalMovements,
    unpaidCount: unpaidAgg._count._all,
    unpaidTotal: decimalToString(unpaidAgg._sum.value ?? 0),
    monthTotal: decimalToString(monthAgg._sum.value ?? 0),
    selectedMonth: key,
  };
}

export async function listViaVerdeMovements(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  filters: {
    licensePlate?: string;
    startDate?: string;
    endDate?: string;
    isPaid?: boolean;
    page?: number;
    pageSize?: number;
  }
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? VIA_VERDE_PAGE_SIZE));
  const where = await buildWhere(db, tenantId, actorId, actorRole, filters);

  const [total, rows, agg] = await Promise.all([
    db.viaVerdeMovement.count({ where }),
    db.viaVerdeMovement.findMany({
      where,
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.viaVerdeMovement.aggregate({
      where,
      _sum: { value: true },
      _count: { _all: true },
    }),
  ]);

  return {
    items: rows.map(mapMovement),
    total,
    filteredTotal: decimalToString(agg._sum.value ?? 0),
    filteredCount: agg._count._all,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function markViaVerdeMovementPaid(
  db: PrismaClient,
  tenantId: string,
  movementId: string,
  isPaid = true
) {
  const existing = await db.viaVerdeMovement.findFirst({
    where: { id: movementId, tenantId },
  });
  if (!existing) throw new Error('Movimento não encontrado');

  const updated = await db.viaVerdeMovement.update({
    where: { id: movementId },
    data: {
      isPaid,
      paymentDate: isPaid ? new Date() : null,
    },
  });

  return mapMovement(updated);
}

export async function bulkMarkViaVerdeMovementsPaid(
  db: PrismaClient,
  tenantId: string,
  ids: string[]
) {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) throw new Error('Seleccione pelo menos um movimento');

  const result = await db.viaVerdeMovement.updateMany({
    where: { tenantId, id: { in: unique }, isPaid: false },
    data: { isPaid: true, paymentDate: new Date() },
  });

  return { updated: result.count, requested: unique.length };
}

export async function deleteViaVerdeMovement(
  db: PrismaClient,
  tenantId: string,
  movementId: string
) {
  const existing = await db.viaVerdeMovement.findFirst({
    where: { id: movementId, tenantId },
  });
  if (!existing) throw new Error('Movimento não encontrado');

  await db.viaVerdeMovement.delete({ where: { id: movementId } });
}
