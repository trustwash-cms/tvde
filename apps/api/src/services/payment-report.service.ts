import type { Prisma, PrismaClient } from '@prisma/client';
import type { PaymentCalculation } from '@tvde/shared';
import { calculateDriverPayment } from './payment-calculator.service';
import { cleanupPaymentReportAttachmentFiles } from './payment-report-attachment.service';
import {
  applyContaCorrenteOnPaymentConfirm,
  reverseContaCorrenteOnPaymentDelete,
} from './driver-current-account.service';

function parseDateOnly(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function money(n: number | string): string {
  return Number(n).toFixed(2);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function asStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string');
}

export type PaymentReportRow = {
  id: string;
  userId: string;
  userLabel: string;
  userEmail: string | null;
  periodStart: string;
  periodEnd: string;
  receitasTotal: string;
  receitasUber: string;
  receitasBolt: string;
  despesasTotal: string;
  despesasViaVerde: string;
  despesasEletricidade: string;
  despesasCombustivel: string;
  despesasComissao: string;
  despesasIva6: string;
  despesasContaCorrente: string;
  /** Impacto conta corrente: negativo = crédito (empresa deve), positivo = débito */
  contaCorrenteLabel: 'credito' | 'debito' | 'zero';
  resultadoFinal: string;
  isPaid: boolean;
  paymentMethod: string | null;
  lastSentAt: string | null;
  attachmentsCount: number;
  createdAt: string;
};

export type PaymentReportsListResult = {
  items: PaymentReportRow[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

export type ListPaymentReportsFilters = {
  periodStart?: string;
  periodEnd?: string;
  search?: string;
  isPaid?: boolean;
  paymentMethod?: string;
  page?: number;
  perPage?: number;
  /** Motorista: só os próprios reports */
  userId?: string;
};

function mapReportRow(r: {
  id: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  receitasUber: { toString(): string };
  receitasBolt: { toString(): string };
  despesasViaVerde: { toString(): string };
  despesasEletricidade: { toString(): string };
  despesasCombustivel: { toString(): string };
  despesasComissao: { toString(): string };
  despesasIva6: { toString(): string };
  despesasContaCorrente: { toString(): string };
  resultadoFinal: { toString(): string };
  isPaid: boolean;
  paymentMethod: string | null;
  lastSentAt: Date | null;
  createdAt: Date;
  user: { fullName: string | null; username: string | null; email: string };
  _count?: { attachments?: number };
}): PaymentReportRow {
  const uber = Number(r.receitasUber.toString());
  const bolt = Number(r.receitasBolt.toString());
  const vv = Number(r.despesasViaVerde.toString());
  const elec = Number(r.despesasEletricidade.toString());
  const fuel = Number(r.despesasCombustivel.toString());
  const com = Number(r.despesasComissao.toString());
  const iva = Number(r.despesasIva6.toString());
  const cc = Number(r.despesasContaCorrente.toString());
  const despesasTotal = vv + elec + fuel + com + iva + Math.max(cc, 0);
  // créditos (cc < 0) reduzem despesas no resultado; na coluna mostramos abs
  let contaCorrenteLabel: PaymentReportRow['contaCorrenteLabel'] = 'zero';
  if (cc < -0.004) contaCorrenteLabel = 'credito';
  else if (cc > 0.004) contaCorrenteLabel = 'debito';

  return {
    id: r.id,
    userId: r.userId,
    userLabel: r.user.fullName || r.user.username || r.user.email || r.userId,
    userEmail: r.user.email || null,
    periodStart: ymd(r.periodStart),
    periodEnd: ymd(r.periodEnd),
    receitasTotal: money(uber + bolt),
    receitasUber: money(uber),
    receitasBolt: money(bolt),
    despesasTotal: money(despesasTotal),
    despesasViaVerde: money(vv),
    despesasEletricidade: money(elec),
    despesasCombustivel: money(fuel),
    despesasComissao: money(com),
    despesasIva6: money(iva),
    despesasContaCorrente: money(Math.abs(cc)),
    contaCorrenteLabel,
    resultadoFinal: money(r.resultadoFinal.toString()),
    isPaid: r.isPaid,
    paymentMethod: r.paymentMethod,
    lastSentAt: r.lastSentAt?.toISOString() ?? null,
    attachmentsCount: r._count?.attachments ?? 0,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listPaymentReports(
  db: PrismaClient,
  tenantId: string,
  filters: ListPaymentReportsFilters = {}
): Promise<PaymentReportsListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = [10, 25, 50, 100].includes(filters.perPage ?? 25)
    ? (filters.perPage as number)
    : 25;

  const where: Prisma.PaymentReportWhereInput = { tenantId };

  if (filters.userId) {
    where.userId = filters.userId;
  }

  if (filters.periodStart && filters.periodEnd) {
    // Sobreposição: periodStart <= fim AND periodEnd >= início
    where.AND = [
      { periodStart: { lte: parseDateOnly(filters.periodEnd) } },
      { periodEnd: { gte: parseDateOnly(filters.periodStart) } },
    ];
  } else if (filters.periodStart) {
    where.periodEnd = { gte: parseDateOnly(filters.periodStart) };
  } else if (filters.periodEnd) {
    where.periodStart = { lte: parseDateOnly(filters.periodEnd) };
  }

  if (typeof filters.isPaid === 'boolean') {
    where.isPaid = filters.isPaid;
  }

  if (filters.paymentMethod) {
    where.paymentMethod = filters.paymentMethod;
  }

  const search = filters.search?.trim();
  if (search) {
    where.user = {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        ...(search.match(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        )
          ? [{ id: search }]
          : []),
      ],
    };
  }

  const [total, rows] = await Promise.all([
    db.paymentReport.count({ where }),
    db.paymentReport.findMany({
      where,
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        user: { select: { fullName: true, username: true, email: true } },
        _count: { select: { attachments: true } },
      },
    }),
  ]);

  return {
    items: rows.map(mapReportRow),
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** Métodos hardcoded até existir tabela payment_methods. */
export const DEFAULT_PAYMENT_METHODS = [
  { code: 'MBWAY', label: 'MB WAY' },
  { code: 'TB', label: 'Transferência' },
  { code: 'CC', label: 'Conta corrente' },
  { code: 'NUM', label: 'Numerário' },
] as const;

export async function setPaymentReportPaid(
  db: PrismaClient,
  tenantId: string,
  reportId: string,
  isPaid: boolean,
  paymentMethod?: string | null
) {
  const existing = await db.paymentReport.findFirst({
    where: { id: reportId, tenantId },
  });
  if (!existing) throw new Error('Pagamento não encontrado');

  if (isPaid) {
    const code = (paymentMethod ?? '').trim().toUpperCase().slice(0, 5);
    if (!code) throw new Error('Seleccione o método de pagamento');
    const allowed = DEFAULT_PAYMENT_METHODS.some((m) => m.code === code);
    if (!allowed) throw new Error('Método de pagamento inválido');

    return db.paymentReport.update({
      where: { id: reportId },
      data: { isPaid: true, paymentMethod: code },
    });
  }

  return db.paymentReport.update({
    where: { id: reportId },
    data: { isPaid: false, paymentMethod: null },
  });
}

export type PaymentReportDetail = PaymentReportRow & {
  details: PaymentCalculation['detalhes'] | null;
  warnings: string[];
};

export async function getPaymentReport(
  db: PrismaClient,
  tenantId: string,
  reportId: string
): Promise<PaymentReportDetail> {
  const row = await db.paymentReport.findFirst({
    where: { id: reportId, tenantId },
    include: {
      user: { select: { fullName: true, username: true, email: true } },
      _count: { select: { attachments: true } },
    },
  });
  if (!row) throw new Error('Pagamento não encontrado');

  const base = mapReportRow(row);
  const details =
    row.detailsJson && typeof row.detailsJson === 'object'
      ? (row.detailsJson as unknown as PaymentCalculation['detalhes'])
      : null;
  const warnings = Array.isArray(row.warningsJson)
    ? (row.warningsJson as string[])
    : [];

  return { ...base, details, warnings };
}

export async function deletePaymentReport(
  db: PrismaClient,
  tenantId: string,
  reportId: string
): Promise<{ id: string }> {
  const existing = await db.paymentReport.findFirst({
    where: { id: reportId, tenantId },
  });
  if (!existing) throw new Error('Pagamento não encontrado');

  const vvIds = asStringIds(existing.viaVerdeMovementIds);
  const elecIds = asStringIds(existing.electricityChargeIds);
  const fuelIds = asStringIds(existing.fuelTransactionIds);
  const uberIds = asStringIds(existing.uberPaymentIds);
  const boltIds = asStringIds(existing.boltOrderIds);
  const expenseIds = asStringIds(existing.driverExpenseIds);

  await db.$transaction(async (tx) => {
    // Repor movimentos como não pagos para poderem voltar a entrar num cálculo
    if (vvIds.length) {
      await tx.viaVerdeMovement.updateMany({
        where: { tenantId, id: { in: vvIds } },
        data: { isPaid: false, paymentDate: null },
      });
    }
    if (elecIds.length) {
      await tx.electricityCharge.updateMany({
        where: { tenantId, id: { in: elecIds } },
        data: { isPaid: false, paymentDate: null },
      });
    }
    if (fuelIds.length) {
      await tx.fuelTransaction.updateMany({
        where: { tenantId, id: { in: fuelIds } },
        data: { isPaid: false, paymentDate: null },
      });
    }
    if (uberIds.length) {
      await tx.uberPayment.updateMany({
        where: { tenantId, id: { in: uberIds } },
        data: { isPaid: false, paymentDate: null },
      });
    }
    if (boltIds.length) {
      await tx.boltOrder.updateMany({
        where: { tenantId, id: { in: boltIds } },
        data: { isPaid: false, paymentDate: null },
      });
    }
    await reverseContaCorrenteOnPaymentDelete(tx, tenantId, expenseIds);
    await tx.paymentReportAttachment.deleteMany({
      where: { tenantId, paymentReportId: reportId },
    });
    await tx.paymentReport.delete({ where: { id: reportId } });
  });

  await cleanupPaymentReportAttachmentFiles(db, tenantId, reportId);

  return { id: reportId };
}

export async function confirmDriverPayment(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  periodStart?: string,
  periodEnd?: string,
  opts?: {
    viaVerdeIds?: string[];
    createdByUserId?: string;
  }
): Promise<{ reportId: string; calculation: PaymentCalculation }> {
  const calculation = await calculateDriverPayment(
    db,
    tenantId,
    userId,
    periodStart,
    periodEnd,
    { viaVerdeIds: opts?.viaVerdeIds }
  );

  const paidAt = new Date();
  const { ids } = calculation;

  const report = await db.$transaction(async (tx) => {
    const created = await tx.paymentReport.create({
      data: {
        tenantId,
        userId: calculation.userId,
        periodStart: parseDateOnly(calculation.periodStart),
        periodEnd: parseDateOnly(calculation.periodEnd),
        receitasUber: calculation.receitas.uber,
        receitasBolt: calculation.receitas.bolt,
        despesasViaVerde: calculation.despesas.viaVerde,
        despesasEletricidade: calculation.despesas.eletricidade,
        despesasCombustivel: calculation.despesas.combustivel,
        despesasComissao: calculation.despesas.comissaoViatura,
        despesasIva6: calculation.despesas.iva6Receitas,
        despesasContaCorrente: calculation.despesas.contaCorrente,
        resultadoFinal: calculation.resultado,
        isPaid: false,
        viaVerdeMovementIds: ids.viaVerdeMovementIds,
        electricityChargeIds: ids.electricityChargeIds,
        fuelTransactionIds: ids.fuelTransactionIds,
        uberPaymentIds: ids.uberPaymentIds,
        boltOrderIds: ids.boltOrderIds,
        driverExpenseIds: ids.driverExpenseIds,
        detailsJson: calculation.detalhes as unknown as Prisma.InputJsonValue,
        warningsJson: calculation.warnings as unknown as Prisma.InputJsonValue,
        createdByUserId: opts?.createdByUserId ?? null,
      },
    });

    if (ids.viaVerdeMovementIds.length) {
      await tx.viaVerdeMovement.updateMany({
        where: {
          tenantId,
          id: { in: ids.viaVerdeMovementIds },
          isPaid: false,
        },
        data: { isPaid: true, paymentDate: paidAt },
      });
    }

    if (ids.electricityChargeIds.length) {
      await tx.electricityCharge.updateMany({
        where: {
          tenantId,
          id: { in: ids.electricityChargeIds },
          isPaid: false,
        },
        data: { isPaid: true, paymentDate: paidAt },
      });
    }

    if (ids.fuelTransactionIds.length) {
      await tx.fuelTransaction.updateMany({
        where: {
          tenantId,
          id: { in: ids.fuelTransactionIds },
          isPaid: false,
        },
        data: { isPaid: true, paymentDate: paidAt },
      });
    }

    if (ids.uberPaymentIds.length) {
      await tx.uberPayment.updateMany({
        where: {
          tenantId,
          id: { in: ids.uberPaymentIds },
          isPaid: false,
        },
        data: { isPaid: true, paymentDate: paidAt },
      });
    }

    if (ids.boltOrderIds.length) {
      await tx.boltOrder.updateMany({
        where: {
          tenantId,
          id: { in: ids.boltOrderIds },
          isPaid: false,
        },
        data: { isPaid: true, paymentDate: paidAt },
      });
    }

    await applyContaCorrenteOnPaymentConfirm(tx, tenantId, ids.driverExpenseIds, created.id);

    return created;
  });

  return { reportId: report.id, calculation };
}
