import type { Prisma, PrismaClient } from '@tvde/database';
import {
  ELECTRICITY_PAGE_SIZE,
  getMonthUtcRange,
  type ElectricityChargeItem,
  type ElectricityDashboardStats,
} from '@tvde/shared';
import type { Role } from '@tvde/shared';
import { getDriverFleetScope } from './user-vehicle-matching.service';

function decimalToString(value: Prisma.Decimal | number | string): string {
  return String(value);
}

function mapCharge(row: {
  id: string;
  chargeDate: Date;
  name: string | null;
  cardNumber: string | null;
  licensePlate: string | null;
  station: string | null;
  energyKwh: Prisma.Decimal | null;
  duration: string | null;
  totalWithVat: Prisma.Decimal;
  isPaid: boolean;
  paymentDate: Date | null;
  userId: string | null;
}): ElectricityChargeItem {
  return {
    id: row.id,
    chargeDate: row.chargeDate.toISOString().slice(0, 10),
    name: row.name,
    cardNumber: row.cardNumber,
    licensePlate: row.licensePlate,
    station: row.station,
    energyKwh: row.energyKwh != null ? decimalToString(row.energyKwh) : null,
    duration: row.duration,
    totalWithVat: decimalToString(row.totalWithVat),
    isPaid: row.isPaid,
    paymentDate: row.paymentDate?.toISOString() ?? null,
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
    name?: string;
    cardNumber?: string;
    licensePlate?: string;
    startDate?: string;
    endDate?: string;
    isPaid?: boolean;
  }
): Promise<Prisma.ElectricityChargeWhereInput> {
  const where: Prisma.ElectricityChargeWhereInput = { tenantId };

  if (filters.name?.trim()) {
    where.name = { contains: filters.name.trim(), mode: 'insensitive' };
  }
  if (filters.cardNumber?.trim()) {
    where.cardNumber = { contains: filters.cardNumber.trim(), mode: 'insensitive' };
  }
  if (filters.licensePlate?.trim()) {
    where.licensePlate = { contains: filters.licensePlate.trim(), mode: 'insensitive' };
  }

  const start = parseDateFilter(filters.startDate);
  const end = parseDateFilter(filters.endDate);
  if (start || end) {
    where.chargeDate = {};
    if (start) where.chargeDate.gte = start;
    if (end) where.chargeDate.lte = end;
  }

  if (filters.isPaid !== undefined) {
    where.isPaid = filters.isPaid;
  }

  const scope = await getDriverFleetScope(db, tenantId, actorId, actorRole);
  if (scope) {
    const orFilters: Prisma.ElectricityChargeWhereInput[] = [{ userId: actorId }];
    if (scope.plates.length) {
      orFilters.push({ licensePlate: { in: scope.plates } });
    }
    if (scope.cardNumbers.length) {
      orFilters.push({ cardNumber: { in: scope.cardNumbers } });
    }
    where.OR = orFilters;
  }

  return where;
}

export async function getElectricityDashboard(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  monthKey?: string
): Promise<ElectricityDashboardStats> {
  const baseWhere = await buildWhere(db, tenantId, actorId, actorRole, {});
  const { start, endExclusive, key } = getMonthUtcRange(monthKey);

  const [totalCharges, unpaidAgg, monthAgg] = await Promise.all([
    db.electricityCharge.count({ where: baseWhere }),
    db.electricityCharge.aggregate({
      where: { ...baseWhere, isPaid: false },
      _count: { _all: true },
      _sum: { totalWithVat: true },
    }),
    db.electricityCharge.aggregate({
      where: {
        ...baseWhere,
        chargeDate: { gte: start, lt: endExclusive },
      },
      _sum: { totalWithVat: true },
    }),
  ]);

  return {
    totalCharges,
    unpaidCount: unpaidAgg._count._all,
    unpaidTotal: decimalToString(unpaidAgg._sum.totalWithVat ?? 0),
    monthTotal: decimalToString(monthAgg._sum.totalWithVat ?? 0),
    selectedMonth: key,
  };
}

export async function listElectricityCharges(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  filters: {
    name?: string;
    cardNumber?: string;
    licensePlate?: string;
    startDate?: string;
    endDate?: string;
    isPaid?: boolean;
    page?: number;
    pageSize?: number;
  }
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? ELECTRICITY_PAGE_SIZE));
  const where = await buildWhere(db, tenantId, actorId, actorRole, filters);

  const [total, rows] = await Promise.all([
    db.electricityCharge.count({ where }),
    db.electricityCharge.findMany({
      where,
      orderBy: [{ chargeDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map(mapCharge),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function markElectricityChargePaid(
  db: PrismaClient,
  tenantId: string,
  chargeId: string
) {
  const existing = await db.electricityCharge.findFirst({
    where: { id: chargeId, tenantId },
  });
  if (!existing) throw new Error('Carregamento não encontrado');

  const updated = await db.electricityCharge.update({
    where: { id: chargeId },
    data: {
      isPaid: true,
      paymentDate: new Date(),
    },
  });

  return mapCharge(updated);
}

export async function deleteElectricityCharge(
  db: PrismaClient,
  tenantId: string,
  chargeId: string
) {
  const existing = await db.electricityCharge.findFirst({
    where: { id: chargeId, tenantId },
  });
  if (!existing) throw new Error('Carregamento não encontrado');

  await db.electricityCharge.delete({ where: { id: chargeId } });
}
