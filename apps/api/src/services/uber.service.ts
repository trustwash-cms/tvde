import type { Prisma, PrismaClient } from '@tvde/database';
import {
  formatWeekDate,
  getMonthUtcRange,
  getWeekRange,
  parseUberCsv,
  parseWeekQuery,
  uberPaymentOrderDateRange,
  type Role,
} from '@tvde/shared';
import { getDriverFleetScope } from './user-vehicle-matching.service';

function decimalToString(value: Prisma.Decimal | number | string): string {
  return String(value);
}

export interface UberDashboardStats {
  totalPayments: number;
  monthTotal: string;
  selectedMonth: string;
  weekNumber: number;
  weekYear: number;
  weekTotal: string;
  weekStart: string;
  weekEnd: string;
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
  filters: { q?: string; startDate?: string; endDate?: string } = {}
): Promise<Prisma.UberPaymentWhereInput> {
  const where: Prisma.UberPaymentWhereInput = { tenantId };
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { driverUuid: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { transactionUuid: { contains: q, mode: 'insensitive' } },
    ];
  }

  const startYmd = filters.startDate?.trim();
  const endYmd = filters.endDate?.trim();
  if (startYmd || endYmd) {
    // Mesma janela do calculador: dia civil com corte Uber 04:00 (relógio de parede na BD)
    const range = uberPaymentOrderDateRange(
      startYmd && /^\d{4}-\d{2}-\d{2}$/.test(startYmd) ? startYmd : '1970-01-01',
      endYmd && /^\d{4}-\d{2}-\d{2}$/.test(endYmd) ? endYmd : '2099-12-31'
    );
    where.reportDate = {
      ...(startYmd ? { gte: range.gte } : {}),
      ...(endYmd ? { lt: range.lt } : {}),
    };
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
  monthKey?: string,
  weekYear?: string | number,
  week?: string | number
): Promise<UberDashboardStats> {
  const { start, endExclusive, key } = getMonthUtcRange(monthKey);
  const { year: wYear, week: wNum } = parseWeekQuery(weekYear, week);
  const weekRange = getWeekRange(wYear, wNum);
  const baseWhere = await buildUberWhere(db, tenantId, actorId, actorRole);

  const [totalPayments, monthAgg, weekAgg] = await Promise.all([
    db.uberPayment.count({ where: baseWhere }),
    db.uberPayment.aggregate({
      where: { ...baseWhere, reportDate: { gte: start, lt: endExclusive } },
      _sum: { amount: true },
    }),
    db.uberPayment.aggregate({
      where: {
        ...baseWhere,
        reportDate: { gte: weekRange.start, lt: weekRange.endExclusive },
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    totalPayments,
    monthTotal: decimalToString(monthAgg._sum.amount ?? 0),
    selectedMonth: key,
    weekNumber: weekRange.week,
    weekYear: weekRange.year,
    weekTotal: decimalToString(weekAgg._sum.amount ?? 0),
    weekStart: formatWeekDate(weekRange.start),
    weekEnd: formatWeekDate(weekRange.end),
  };
}

export async function listUberPayments(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  filters: { q?: string; page?: number; startDate?: string; endDate?: string }
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 50;
  const where = await buildUberWhere(db, tenantId, actorId, actorRole, filters);

  const [total, rows, sumAgg] = await Promise.all([
    db.uberPayment.count({ where }),
    db.uberPayment.findMany({
      where,
      orderBy: [{ reportDate: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.uberPayment.aggregate({
      where,
      _sum: { amount: true },
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
    /** Soma de `amount` de todos os registos do filtro (não só a página). */
    filteredTotal: decimalToString(sumAgg._sum.amount ?? 0),
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
  const { rows, errors } = parseUberCsv(csvText, { filename: 'upload.csv' });
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

export async function markUberPaymentPaid(db: PrismaClient, tenantId: string, id: string) {
  const existing = await db.uberPayment.findFirst({ where: { id, tenantId } });
  if (!existing) throw new Error('Pagamento não encontrado');
  const updated = await db.uberPayment.update({
    where: { id },
    data: { isPaid: true, paymentDate: new Date() },
  });
  return {
    id: updated.id,
    driverUuid: updated.driverUuid,
    firstName: updated.firstName,
    lastName: updated.lastName,
    reportDate: updated.reportDate.toISOString(),
    amount: decimalToString(updated.amount),
    description: updated.description,
    isPaid: updated.isPaid,
  } satisfies UberPaymentItem;
}

export async function bulkMarkUberPaymentsPaid(db: PrismaClient, tenantId: string, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) throw new Error('Seleccione pelo menos um pagamento');

  const result = await db.uberPayment.updateMany({
    where: { tenantId, id: { in: unique }, isPaid: false },
    data: { isPaid: true, paymentDate: new Date() },
  });

  return { updated: result.count, requested: unique.length };
}
