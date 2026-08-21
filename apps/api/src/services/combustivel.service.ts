import type { Prisma, PrismaClient } from '@tvde/database';
import {
  COMBUSTIVEL_PAGE_SIZE,
  formatWeekDate,
  getMonthUtcRange,
  getWeekRange,
  parseWeekQuery,
  type Role,
} from '@tvde/shared';
import { getDriverFleetScope } from './user-vehicle-matching.service';
import { parseCombustivelRows } from '@tvde/shared';
import { parseImportFileToRows, validateImportFilename } from '../lib/spreadsheet-import';

function decimalToString(value: Prisma.Decimal | number | string): string {
  return String(value);
}

export interface CombustivelDashboardStats {
  totalTransactions: number;
  unpaidCount: number;
  unpaidTotal: string;
  monthTotal: string;
  selectedMonth: string;
  weekNumber: number;
  weekYear: number;
  weekTotal: string;
  weekStart: string;
  weekEnd: string;
}

export interface CombustivelTransactionItem {
  id: string;
  chargeDate: string;
  station: string | null;
  cardNumber: string | null;
  fuelType: string | null;
  liters: string | null;
  totalWithVat: string;
  isPaid: boolean;
}

async function buildWhere(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  filters: { cardNumber?: string; startDate?: string; endDate?: string }
): Promise<Prisma.FuelTransactionWhereInput> {
  const where: Prisma.FuelTransactionWhereInput = { tenantId };
  if (filters.cardNumber?.trim()) {
    where.cardNumber = { contains: filters.cardNumber.trim(), mode: 'insensitive' };
  }
  const start = filters.startDate?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? new Date(`${filters.startDate}T00:00:00.000Z`)
    : undefined;
  const end = filters.endDate?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? new Date(`${filters.endDate}T23:59:59.999Z`)
    : undefined;
  if (start || end) {
    where.chargeDate = {};
    if (start) where.chargeDate.gte = start;
    if (end) where.chargeDate.lte = end;
  }

  const scope = await getDriverFleetScope(db, tenantId, actorId, actorRole);
  if (scope) {
    where.OR = [
      { userId: actorId },
      ...(scope.cardNumbers.length ? [{ cardNumber: { in: scope.cardNumbers } }] : []),
    ];
  }
  return where;
}

export async function getCombustivelDashboard(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  monthKey?: string,
  weekYear?: string | number,
  week?: string | number
): Promise<CombustivelDashboardStats> {
  const baseWhere = await buildWhere(db, tenantId, actorId, actorRole, {});
  const { start, endExclusive, key } = getMonthUtcRange(monthKey);
  const { year: wYear, week: wNum } = parseWeekQuery(weekYear, week);
  const weekRange = getWeekRange(wYear, wNum);

  const [totalTransactions, unpaidAgg, monthAgg, weekAgg] = await Promise.all([
    db.fuelTransaction.count({ where: baseWhere }),
    db.fuelTransaction.aggregate({
      where: { ...baseWhere, isPaid: false },
      _count: { _all: true },
      _sum: { totalWithVat: true },
    }),
    db.fuelTransaction.aggregate({
      where: { ...baseWhere, chargeDate: { gte: start, lt: endExclusive } },
      _sum: { totalWithVat: true },
    }),
    db.fuelTransaction.aggregate({
      where: {
        ...baseWhere,
        chargeDate: { gte: weekRange.start, lt: weekRange.endExclusive },
      },
      _sum: { totalWithVat: true },
    }),
  ]);

  return {
    totalTransactions,
    unpaidCount: unpaidAgg._count._all,
    unpaidTotal: decimalToString(unpaidAgg._sum.totalWithVat ?? 0),
    monthTotal: decimalToString(monthAgg._sum.totalWithVat ?? 0),
    selectedMonth: key,
    weekNumber: weekRange.week,
    weekYear: weekRange.year,
    weekTotal: decimalToString(weekAgg._sum.totalWithVat ?? 0),
    weekStart: formatWeekDate(weekRange.start),
    weekEnd: formatWeekDate(weekRange.end),
  };
}

export async function listCombustivelTransactions(
  db: PrismaClient,
  tenantId: string,
  actorId: string,
  actorRole: Role,
  filters: { cardNumber?: string; startDate?: string; endDate?: string; page?: number }
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = COMBUSTIVEL_PAGE_SIZE;
  const where = await buildWhere(db, tenantId, actorId, actorRole, filters);
  const [total, rows] = await Promise.all([
    db.fuelTransaction.count({ where }),
    db.fuelTransaction.findMany({
      where,
      orderBy: [{ chargeDate: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map(
      (row): CombustivelTransactionItem => ({
        id: row.id,
        chargeDate: row.chargeDate.toISOString(),
        station: row.station,
        cardNumber: row.cardNumber,
        fuelType: row.fuelType,
        liters: row.liters != null ? decimalToString(row.liters) : null,
        totalWithVat: decimalToString(row.totalWithVat),
        isPaid: row.isPaid,
      })
    ),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function importCombustivelFile(
  db: PrismaClient,
  tenantId: string,
  importedByUserId: string,
  buffer: Buffer,
  filename: string
) {
  validateImportFilename(filename, ['.csv', '.txt', '.xls', '.xlsx']);
  const rawRows = parseImportFileToRows(buffer, filename);
  const { rows, errors } = parseCombustivelRows(rawRows);
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const existing = row.receiptNumber
      ? await db.fuelTransaction.findFirst({
          where: { tenantId, receiptNumber: row.receiptNumber },
        })
      : null;
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.fuelTransaction.create({
      data: {
        tenantId,
        station: row.station,
        chargeDate: row.chargeDate,
        cardNumber: row.cardNumber,
        cardDescription: row.cardDescription,
        liters: row.liters,
        fuelType: row.fuelType,
        receiptNumber: row.receiptNumber,
        totalWithVat: row.totalWithVat,
        clientName: row.clientName,
        importedByUserId,
      },
    });
    inserted += 1;
  }

  return { total: rows.length, inserted, skipped, failed: errors.length, errors };
}

export async function markCombustivelPaid(db: PrismaClient, tenantId: string, id: string) {
  const existing = await db.fuelTransaction.findFirst({ where: { id, tenantId } });
  if (!existing) throw new Error('Abastecimento não encontrado');
  return db.fuelTransaction.update({
    where: { id },
    data: { isPaid: true, paymentDate: new Date() },
  });
}

export async function bulkMarkCombustivelPaid(db: PrismaClient, tenantId: string, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) throw new Error('Seleccione pelo menos um abastecimento');

  const result = await db.fuelTransaction.updateMany({
    where: { tenantId, id: { in: unique }, isPaid: false },
    data: { isPaid: true, paymentDate: new Date() },
  });

  return { updated: result.count, requested: unique.length };
}

export async function deleteCombustivelTransaction(db: PrismaClient, tenantId: string, id: string) {
  const existing = await db.fuelTransaction.findFirst({ where: { id, tenantId } });
  if (!existing) throw new Error('Abastecimento não encontrado');
  await db.fuelTransaction.delete({ where: { id } });
}
