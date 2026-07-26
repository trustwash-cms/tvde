import type { Prisma, PrismaClient } from '@tvde/database';
import { getMonthUtcRange, parseUberCsv, type Role } from '@tvde/shared';
import { getDriverFleetScope } from './user-vehicle-matching.service';

function decimalToString(value: Prisma.Decimal | number | string): string {
  return String(value);
}

export interface UberDashboardStats {
  totalPayments: number;
  monthTotal: string;
  selectedMonth: string;
}

export interface UberPaymentItem {
  id: string;
  driverUuid: string;
  firstName: string | null;
  lastName: string | null;
  reportDate: string;
  amount: string;
  description: string | null;
  isPaid: boolean;
}

async function buildUberWhere(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  filters: { q?: string } = {}
): Promise<Prisma.UberPaymentWhereInput> {
  const where: Prisma.UberPaymentWhereInput = { tenantId };
  if (filters.q?.trim()) {
    where.OR = [
      { driverUuid: { contains: filters.q.trim(), mode: 'insensitive' } },
      { firstName: { contains: filters.q.trim(), mode: 'insensitive' } },
      { lastName: { contains: filters.q.trim(), mode: 'insensitive' } },
    ];
  }

  const scope = await getDriverFleetScope(db, tenantId, actorId, actorRole);
  if (scope) {
    const scoped: Prisma.UberPaymentWhereInput[] = [{ userId: actorId }];
    if (scope.uuidUber.length) {
      scoped.push({ driverUuid: { in: scope.uuidUber } });
    }
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { OR: scoped },
    ];
  }

  return where;
}

export async function getUberDashboard(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  monthKey?: string
): Promise<UberDashboardStats> {
  const { start, endExclusive, key } = getMonthUtcRange(monthKey);
  const baseWhere = await buildUberWhere(db, tenantId, actorId, actorRole);

  const [totalPayments, monthAgg] = await Promise.all([
    db.uberPayment.count({ where: baseWhere }),
    db.uberPayment.aggregate({
      where: { ...baseWhere, reportDate: { gte: start, lt: endExclusive } },
      _sum: { amount: true },
    }),
  ]);

  return {
    totalPayments,
    monthTotal: decimalToString(monthAgg._sum.amount ?? 0),
    selectedMonth: key,
  };
}

export async function listUberPayments(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  filters: { q?: string; page?: number }
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 50;
  const where = await buildUberWhere(db, tenantId, actorId, actorRole, filters);

  const [total, rows] = await Promise.all([
    db.uberPayment.count({ where }),
    db.uberPayment.findMany({
      where,
      orderBy: [{ reportDate: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map(
      (row): UberPaymentItem => ({
        id: row.id,
        driverUuid: row.driverUuid,
        firstName: row.firstName,
        lastName: row.lastName,
        reportDate: row.reportDate.toISOString(),
        amount: decimalToString(row.amount),
        description: row.description,
        isPaid: row.isPaid,
      })
    ),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function importUberCsvText(
  db: PrismaClient,
  tenantId: string,
  importedByUserId: string,
  csvText: string
) {
  const { rows, errors } = parseUberCsv(csvText);
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      await db.uberPayment.create({
        data: {
          tenantId,
          driverUuid: row.driverUuid,
          firstName: row.firstName,
          lastName: row.lastName,
          reportDate: row.reportDate,
          amount: row.amount,
          transactionUuid: row.transactionUuid,
          description: row.description,
          importedByUserId,
        },
      });
      inserted += 1;
    } catch {
      skipped += 1;
    }
  }
  return { total: rows.length, inserted, skipped, failed: errors.length, errors };
}
