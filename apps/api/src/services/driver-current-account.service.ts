import type { Prisma, PrismaClient } from '@prisma/client';
import type { PaymentMoneyLine } from '@tvde/shared';
import {
  deleteDriverCurrentAccountFile,
  saveDriverCurrentAccountFile,
  buildDriverCurrentAccountStorageKey,
} from './driver-current-account-storage.service';

export type ContaCorrenteType = 'credit' | 'debit';
export type ContaCorrenteStatus = 'open' | 'settled' | 'cancelled';

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function dec(value: { toString(): string } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

function signedImpact(type: ContaCorrenteType, amount: number): number {
  // credit (empresa deve) → reduz despesas; debit → aumenta
  return type === 'credit' ? -Math.abs(amount) : Math.abs(amount);
}

/** Valor a aplicar neste período de pagamento (parcela ou total). */
export function periodAmountForEntry(entry: {
  type: ContaCorrenteType;
  amount: { toString(): string } | number;
  installmentEnabled: boolean;
  totalInstallments: number | null;
  installmentAmount: { toString(): string } | number | null;
  installmentsPaid: number;
  status: ContaCorrenteStatus;
}): number {
  if (entry.status !== 'open') return 0;
  if (entry.installmentEnabled) {
    const total = entry.totalInstallments ?? 0;
    if (entry.installmentsPaid >= total || total <= 0) return 0;
    return Math.abs(dec(entry.installmentAmount));
  }
  return Math.abs(dec(entry.amount));
}

export interface ContaCorrenteEntryDto {
  id: string;
  driverUserId: string;
  driverLabel: string;
  description: string;
  amount: string;
  /** Valor ainda em dívida (parcelas restantes ou total se em aberto). */
  remainingBalance: string;
  type: ContaCorrenteType;
  category: string | null;
  reference: string | null;
  status: ContaCorrenteStatus;
  installmentEnabled: boolean;
  totalInstallments: number | null;
  installmentAmount: string | null;
  installmentsPaid: number;
  hasAttachment: boolean;
  attachmentFileName: string | null;
  paymentReportId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContaCorrenteSummary {
  openBalance: string;
  openCount: number;
  accumulatedBalance: string;
  lastUpdate: {
    driverLabel: string;
    at: string;
  } | null;
}

export interface ContaCorrenteListResult {
  entries: ContaCorrenteEntryDto[];
  summary: ContaCorrenteSummary;
}

export interface ContaCorrentePaymentSlice {
  impact: number;
  details: PaymentMoneyLine[];
  entryIds: string[];
}

function remainingBalanceForEntry(row: {
  type: ContaCorrenteType;
  amount: { toString(): string } | number;
  status: ContaCorrenteStatus;
  installmentEnabled: boolean;
  totalInstallments: number | null;
  installmentAmount: { toString(): string } | number | null;
  installmentsPaid: number;
}): number {
  if (row.status === 'cancelled') return 0;
  if (row.installmentEnabled && row.totalInstallments && row.installmentAmount) {
    const remaining = Math.max(0, row.totalInstallments - row.installmentsPaid);
    return remaining * Math.abs(dec(row.installmentAmount));
  }
  if (row.status === 'open') return Math.abs(dec(row.amount));
  return 0;
}

function mapEntry(
  row: {
    id: string;
    driverUserId: string;
    description: string;
    amount: { toString(): string };
    type: ContaCorrenteType;
    category: string | null;
    reference: string | null;
    status: ContaCorrenteStatus;
    installmentEnabled: boolean;
    totalInstallments: number | null;
    installmentAmount: { toString(): string } | null;
    installmentsPaid: number;
    attachmentStorageKey: string | null;
    attachmentFileName: string | null;
    paymentReportId: string | null;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    driver?: { fullName: string | null; username: string | null; email: string | null } | null;
  }
): ContaCorrenteEntryDto {
  const driverLabel =
    row.driver?.fullName || row.driver?.username || row.driver?.email || row.driverUserId;
  return {
    id: row.id,
    driverUserId: row.driverUserId,
    driverLabel,
    description: row.description,
    amount: money(dec(row.amount)),
    remainingBalance: money(remainingBalanceForEntry(row)),
    type: row.type,
    category: row.category,
    reference: row.reference,
    status: row.status,
    installmentEnabled: row.installmentEnabled,
    totalInstallments: row.totalInstallments,
    installmentAmount: row.installmentAmount != null ? money(dec(row.installmentAmount)) : null,
    installmentsPaid: row.installmentsPaid,
    hasAttachment: Boolean(row.attachmentStorageKey),
    attachmentFileName: row.attachmentFileName,
    paymentReportId: row.paymentReportId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function balanceFromEntries(
  entries: Array<{
    type: ContaCorrenteType;
    amount: { toString(): string } | number;
    status: ContaCorrenteStatus;
    installmentEnabled: boolean;
    totalInstallments: number | null;
    installmentAmount: { toString(): string } | number | null;
    installmentsPaid: number;
  }>
): number {
  let total = 0;
  for (const e of entries) {
    if (e.installmentEnabled && e.totalInstallments && e.installmentAmount) {
      const paid = Math.min(e.installmentsPaid, e.totalInstallments);
      const remainingInstallments = e.totalInstallments - paid;
      // Saldo em aberto: parcelas restantes; acumulado: tudo (pago + aberto)
      if (e.status === 'open') {
        total += signedImpact(e.type, remainingInstallments * dec(e.installmentAmount));
      } else if (e.status === 'settled') {
        total += signedImpact(e.type, e.totalInstallments * dec(e.installmentAmount));
      }
      // cancelled: 0
    } else {
      if (e.status === 'cancelled') continue;
      total += signedImpact(e.type, dec(e.amount));
    }
  }
  return total;
}

function openBalanceFromEntries(
  entries: Array<{
    type: ContaCorrenteType;
    amount: { toString(): string } | number;
    status: ContaCorrenteStatus;
    installmentEnabled: boolean;
    totalInstallments: number | null;
    installmentAmount: { toString(): string } | number | null;
    installmentsPaid: number;
  }>
): { balance: number; count: number } {
  let balance = 0;
  let count = 0;
  for (const e of entries) {
    if (e.status !== 'open') continue;
    count += 1;
    if (e.installmentEnabled && e.totalInstallments && e.installmentAmount) {
      const remaining = Math.max(0, e.totalInstallments - e.installmentsPaid);
      balance += signedImpact(e.type, remaining * dec(e.installmentAmount));
    } else {
      balance += signedImpact(e.type, dec(e.amount));
    }
  }
  return { balance, count };
}

export async function listContaCorrenteDrivers(db: PrismaClient, tenantId: string) {
  const users = await db.user.findMany({
    where: {
      tenantId,
      role: 'admin',
      status: 'active',
    },
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
    },
    orderBy: [{ fullName: 'asc' }, { username: 'asc' }, { email: 'asc' }],
  });

  return users.map((u) => ({
    id: u.id,
    label: u.fullName || u.username || u.email || u.id,
    email: u.email,
  }));
}

export async function getContaCorrenteSummary(
  db: PrismaClient,
  tenantId: string,
  driverUserId?: string
): Promise<ContaCorrenteSummary> {
  const where: Prisma.DriverCurrentAccountEntryWhereInput = {
    tenantId,
    ...(driverUserId ? { driverUserId } : {}),
  };

  const [all, last] = await Promise.all([
    db.driverCurrentAccountEntry.findMany({
      where,
      select: {
        type: true,
        amount: true,
        status: true,
        installmentEnabled: true,
        totalInstallments: true,
        installmentAmount: true,
        installmentsPaid: true,
      },
    }),
    db.driverCurrentAccountEntry.findFirst({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        driver: { select: { fullName: true, username: true, email: true } },
      },
    }),
  ]);

  const open = openBalanceFromEntries(all);
  const accumulated = balanceFromEntries(all);

  return {
    openBalance: money(open.balance),
    openCount: open.count,
    accumulatedBalance: money(accumulated),
    lastUpdate: last
      ? {
          driverLabel:
            last.driver.fullName || last.driver.username || last.driver.email || last.driverUserId,
          at: last.updatedAt.toISOString(),
        }
      : null,
  };
}

export async function listContaCorrenteEntries(
  db: PrismaClient,
  tenantId: string,
  opts: { driverUserId?: string; status?: ContaCorrenteStatus | 'all' }
): Promise<ContaCorrenteListResult> {
  const statusFilter =
    opts.status && opts.status !== 'all'
      ? { status: opts.status as ContaCorrenteStatus }
      : {};

  const where: Prisma.DriverCurrentAccountEntryWhereInput = {
    tenantId,
    ...(opts.driverUserId ? { driverUserId: opts.driverUserId } : {}),
    ...statusFilter,
  };

  const [rows, summary] = await Promise.all([
    db.driverCurrentAccountEntry.findMany({
      where,
      include: {
        driver: { select: { fullName: true, username: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    getContaCorrenteSummary(db, tenantId, opts.driverUserId),
  ]);

  return {
    entries: rows.map(mapEntry),
    summary,
  };
}

export async function createContaCorrenteEntry(
  db: PrismaClient,
  tenantId: string,
  input: {
    driverUserId: string;
    description: string;
    amount: number;
    type: ContaCorrenteType;
    category?: string | null;
    reference?: string | null;
    installmentEnabled?: boolean;
    totalInstallments?: number | null;
    installmentAmount?: number | null;
    createdByUserId?: string | null;
    attachment?: {
      fileName: string;
      mimeType: string;
      buffer: Buffer;
    } | null;
  }
): Promise<ContaCorrenteEntryDto> {
  const driver = await db.user.findFirst({
    where: { id: input.driverUserId, tenantId },
    select: { id: true, workspaceId: true, role: true },
  });
  if (!driver) throw new Error('Motorista não encontrado neste tenant');

  const amount = Math.abs(input.amount);
  if (!(amount > 0)) throw new Error('Valor deve ser maior que zero');

  const installmentEnabled = Boolean(input.installmentEnabled) && input.type === 'debit';
  let totalInstallments: number | null = null;
  let installmentAmount: number | null = null;

  if (installmentEnabled) {
    const n = Number(input.totalInstallments);
    if (!Number.isInteger(n) || n < 2) {
      throw new Error('Número de parcelas inválido (mínimo 2)');
    }
    totalInstallments = n;
    const slice =
      input.installmentAmount != null && input.installmentAmount > 0
        ? Math.abs(input.installmentAmount)
        : Math.round((amount / n) * 100) / 100;
    installmentAmount = slice;
  }

  const created = await db.driverCurrentAccountEntry.create({
    data: {
      tenantId,
      workspaceId: driver.workspaceId,
      driverUserId: driver.id,
      description: input.description.trim(),
      amount,
      type: input.type,
      category: input.category?.trim() || null,
      reference: input.reference?.trim() || null,
      status: 'open',
      installmentEnabled,
      totalInstallments,
      installmentAmount,
      installmentsPaid: 0,
      createdByUserId: input.createdByUserId ?? null,
    },
    include: {
      driver: { select: { fullName: true, username: true, email: true } },
    },
  });

  if (input.attachment) {
    const storageKey = buildDriverCurrentAccountStorageKey(
      tenantId,
      created.id,
      input.attachment.fileName
    );
    await saveDriverCurrentAccountFile(storageKey, input.attachment.buffer);
    const updated = await db.driverCurrentAccountEntry.update({
      where: { id: created.id },
      data: {
        attachmentFileName: input.attachment.fileName,
        attachmentStorageKey: storageKey,
        attachmentMimeType: input.attachment.mimeType,
        attachmentSizeBytes: BigInt(input.attachment.buffer.length),
      },
      include: {
        driver: { select: { fullName: true, username: true, email: true } },
      },
    });
    return mapEntry(updated);
  }

  return mapEntry(created);
}

export async function updateContaCorrenteEntry(
  db: PrismaClient,
  tenantId: string,
  entryId: string,
  input: {
    description: string;
    amount?: number;
    type?: ContaCorrenteType;
    category?: string | null;
    reference?: string | null;
    installmentEnabled?: boolean;
    totalInstallments?: number | null;
    installmentAmount?: number | null;
    attachment?: { fileName: string; mimeType: string; buffer: Buffer } | null;
    removeAttachment?: boolean;
  }
): Promise<ContaCorrenteEntryDto> {
  const existing = await db.driverCurrentAccountEntry.findFirst({
    where: { id: entryId, tenantId },
  });
  if (!existing) throw new Error('Lançamento não encontrado');
  if (existing.status !== 'open') {
    throw new Error('Só é possível editar lançamentos em aberto');
  }

  const description = input.description.trim();
  if (!description) throw new Error('Descrição é obrigatória');

  const partialInstallments = existing.installmentsPaid > 0;
  const data: Prisma.DriverCurrentAccountEntryUpdateInput = {
    description,
    category: input.category?.trim() || null,
    reference: input.reference?.trim() || null,
  };

  if (!partialInstallments) {
    if (input.amount == null || !(input.amount > 0)) {
      throw new Error('Valor deve ser maior que zero');
    }
    const type = input.type ?? existing.type;
    const amount = Math.abs(input.amount);

    const installmentEnabled = Boolean(input.installmentEnabled) && type === 'debit';
    let totalInstallments: number | null = null;
    let installmentAmount: number | null = null;

    if (installmentEnabled) {
      const n = Number(input.totalInstallments);
      if (!Number.isInteger(n) || n < 2) {
        throw new Error('Número de parcelas inválido (mínimo 2)');
      }
      totalInstallments = n;
      const slice =
        input.installmentAmount != null && input.installmentAmount > 0
          ? Math.abs(input.installmentAmount)
          : Math.round((amount / n) * 100) / 100;
      installmentAmount = slice;
    }

    data.amount = amount;
    data.type = type;
    data.installmentEnabled = installmentEnabled;
    data.totalInstallments = totalInstallments;
    data.installmentAmount = installmentAmount;
    if (!installmentEnabled) {
      data.totalInstallments = null;
      data.installmentAmount = null;
    }
  }

  if (input.removeAttachment && existing.attachmentStorageKey) {
    await deleteDriverCurrentAccountFile(existing.attachmentStorageKey);
    data.attachmentFileName = null;
    data.attachmentStorageKey = null;
    data.attachmentMimeType = null;
    data.attachmentSizeBytes = null;
  }

  if (input.attachment) {
    if (existing.attachmentStorageKey) {
      await deleteDriverCurrentAccountFile(existing.attachmentStorageKey);
    }
    const storageKey = buildDriverCurrentAccountStorageKey(
      tenantId,
      entryId,
      input.attachment.fileName
    );
    await saveDriverCurrentAccountFile(storageKey, input.attachment.buffer);
    data.attachmentFileName = input.attachment.fileName;
    data.attachmentStorageKey = storageKey;
    data.attachmentMimeType = input.attachment.mimeType;
    data.attachmentSizeBytes = BigInt(input.attachment.buffer.length);
  }

  const updated = await db.driverCurrentAccountEntry.update({
    where: { id: entryId },
    data,
    include: {
      driver: { select: { fullName: true, username: true, email: true } },
    },
  });
  return mapEntry(updated);
}

export async function cancelContaCorrenteEntry(
  db: PrismaClient,
  tenantId: string,
  entryId: string
): Promise<ContaCorrenteEntryDto> {
  const existing = await db.driverCurrentAccountEntry.findFirst({
    where: { id: entryId, tenantId },
  });
  if (!existing) throw new Error('Lançamento não encontrado');
  if (existing.status !== 'open') {
    throw new Error('Só é possível cancelar lançamentos em aberto');
  }
  if (existing.installmentsPaid > 0) {
    throw new Error('Lançamento com parcelas já deduzidas — não pode ser cancelado');
  }

  const updated = await db.driverCurrentAccountEntry.update({
    where: { id: entryId },
    data: { status: 'cancelled' },
    include: {
      driver: { select: { fullName: true, username: true, email: true } },
    },
  });
  return mapEntry(updated);
}

export async function deleteContaCorrenteEntry(
  db: PrismaClient,
  tenantId: string,
  entryId: string
): Promise<{ id: string }> {
  const existing = await db.driverCurrentAccountEntry.findFirst({
    where: { id: entryId, tenantId },
  });
  if (!existing) throw new Error('Lançamento não encontrado');

  if (existing.paymentReportId) {
    const report = await db.paymentReport.findFirst({
      where: { id: existing.paymentReportId, tenantId },
      select: { driverExpenseIds: true },
    });
    if (report) {
      const ids = Array.isArray(report.driverExpenseIds)
        ? (report.driverExpenseIds as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const nextIds = ids.filter((id) => id !== entryId);
      if (nextIds.length !== ids.length) {
        await db.paymentReport.update({
          where: { id: existing.paymentReportId },
          data: { driverExpenseIds: nextIds },
        });
      }
    }
  }

  await db.driverCurrentAccountEntry.delete({ where: { id: entryId } });
  if (existing.attachmentStorageKey) {
    await deleteDriverCurrentAccountFile(existing.attachmentStorageKey);
  }
  return { id: entryId };
}

/** Repor lançamento liquidado para em aberto (reversão manual). */
export async function reopenContaCorrenteEntry(
  db: PrismaClient,
  tenantId: string,
  entryId: string
): Promise<ContaCorrenteEntryDto> {
  const existing = await db.driverCurrentAccountEntry.findFirst({
    where: { id: entryId, tenantId },
  });
  if (!existing) throw new Error('Lançamento não encontrado');
  if (existing.status !== 'settled') {
    throw new Error('Só é possível reabrir lançamentos liquidados');
  }

  if (existing.paymentReportId) {
    const report = await db.paymentReport.findFirst({
      where: { id: existing.paymentReportId, tenantId },
      select: { driverExpenseIds: true },
    });
    if (report) {
      const ids = Array.isArray(report.driverExpenseIds)
        ? (report.driverExpenseIds as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const nextIds = ids.filter((id) => id !== entryId);
      if (nextIds.length !== ids.length) {
        await db.paymentReport.update({
          where: { id: existing.paymentReportId },
          data: { driverExpenseIds: nextIds },
        });
      }
    }
  }

  const updated = await db.driverCurrentAccountEntry.update({
    where: { id: entryId },
    data: {
      status: 'open',
      paymentReportId: null,
      ...(existing.installmentEnabled &&
      existing.totalInstallments &&
      existing.installmentsPaid >= existing.totalInstallments
        ? { installmentsPaid: 0 }
        : {}),
    },
    include: {
      driver: { select: { fullName: true, username: true, email: true } },
    },
  });
  return mapEntry(updated);
}

export async function getContaCorrenteEntryForDownload(
  db: PrismaClient,
  tenantId: string,
  entryId: string
) {
  const entry = await db.driverCurrentAccountEntry.findFirst({
    where: { id: entryId, tenantId },
  });
  if (!entry?.attachmentStorageKey) throw new Error('Anexo não encontrado');
  return entry;
}

/**
 * Soma impacto de lançamentos em aberto para o motorista (pagamento semanal).
 * Crédito → impacto negativo nas despesas; débito → positivo.
 * Parcelados: aplica uma parcela por confirmação de pagamento.
 */
export async function getOpenContaCorrenteForDriver(
  db: PrismaClient,
  tenantId: string,
  driverUserId: string
): Promise<ContaCorrentePaymentSlice> {
  const entries = await db.driverCurrentAccountEntry.findMany({
    where: { tenantId, driverUserId, status: 'open' },
    orderBy: { createdAt: 'asc' },
  });

  let impact = 0;
  const details: PaymentMoneyLine[] = [];
  const entryIds: string[] = [];

  for (const entry of entries) {
    const periodAmt = periodAmountForEntry(entry);
    if (periodAmt <= 0) continue;

    impact += signedImpact(entry.type, periodAmt);
    entryIds.push(entry.id);

    const tipoLabel = entry.type === 'credit' ? 'Crédito' : 'Débito';
    let label = entry.description.trim().slice(0, 120);
    if (entry.installmentEnabled && entry.totalInstallments) {
      const parcela = (entry.installmentsPaid ?? 0) + 1;
      const total = entry.totalInstallments;
      if (!/parcela\s*\d/i.test(label)) {
        label = `${label.slice(0, 90)} (Parcela ${parcela} de ${total})`.slice(0, 120);
      }
    }

    let meta = tipoLabel;
    if (entry.category?.trim()) meta += ` · ${entry.category.trim()}`;
    if (entry.reference?.trim()) meta += ` · ref. ${entry.reference.trim()}`;

    details.push({
      label,
      amount: money(signedImpact(entry.type, periodAmt)),
      meta,
    });
  }

  return { impact, details, entryIds };
}

/** Após confirmar pagamento: liquidar totais / avançar parcelas. */
export async function applyContaCorrenteOnPaymentConfirm(
  db: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  entryIds: string[],
  paymentReportId: string
): Promise<void> {
  if (!entryIds.length) return;

  const entries = await db.driverCurrentAccountEntry.findMany({
    where: { tenantId, id: { in: entryIds }, status: 'open' },
  });

  for (const entry of entries) {
    if (entry.installmentEnabled && entry.totalInstallments) {
      const nextPaid = entry.installmentsPaid + 1;
      const settled = nextPaid >= entry.totalInstallments;
      await db.driverCurrentAccountEntry.update({
        where: { id: entry.id },
        data: {
          installmentsPaid: nextPaid,
          status: settled ? 'settled' : 'open',
          paymentReportId: settled ? paymentReportId : entry.paymentReportId,
        },
      });
    } else {
      await db.driverCurrentAccountEntry.update({
        where: { id: entry.id },
        data: {
          status: 'settled',
          paymentReportId,
        },
      });
    }
  }
}

/** Ao apagar um payment_report: repor lançamentos aplicados. */
export async function reverseContaCorrenteOnPaymentDelete(
  db: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  entryIds: string[]
): Promise<void> {
  if (!entryIds.length) return;

  const entries = await db.driverCurrentAccountEntry.findMany({
    where: { tenantId, id: { in: entryIds } },
  });

  for (const entry of entries) {
    if (entry.installmentEnabled && entry.totalInstallments) {
      const nextPaid = Math.max(0, entry.installmentsPaid - 1);
      await db.driverCurrentAccountEntry.update({
        where: { id: entry.id },
        data: {
          installmentsPaid: nextPaid,
          status: 'open',
          paymentReportId: null,
        },
      });
    } else {
      await db.driverCurrentAccountEntry.update({
        where: { id: entry.id },
        data: {
          status: 'open',
          paymentReportId: null,
        },
      });
    }
  }
}
