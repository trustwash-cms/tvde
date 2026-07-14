import { prisma } from '@tvde/database';
import type { AdminMgmtVencimentoOrigem } from '@tvde/shared';
import { getAdminMgmtSettings } from './admin-mgmt-settings.service';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function computeVencimentoStatus(dataVencimento: Date, status: string): string {
  if (status === 'resolvido') return 'resolvido';
  const today = startOfDay(new Date());
  const due = startOfDay(dataVencimento);
  if (due < today) return 'atrasado';
  return status === 'atrasado' ? 'pendente' : status;
}

function mapVencimento(row: {
  id: string;
  origemTipo: string;
  origemId: string;
  descricao: string;
  dataVencimento: Date;
  diasAntecedenciaAlerta: number;
  valorAssociado: { toString(): string } | null;
  status: string;
  responsavel: string | null;
  resolvidoAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const status = computeVencimentoStatus(row.dataVencimento, row.status);
  return {
    id: row.id,
    origemTipo: row.origemTipo,
    origemId: row.origemId,
    descricao: row.descricao,
    dataVencimento: row.dataVencimento.toISOString().slice(0, 10),
    diasAntecedenciaAlerta: row.diasAntecedenciaAlerta,
    valorAssociado: row.valorAssociado?.toString() ?? null,
    status,
    responsavel: row.responsavel,
    resolvidoAt: row.resolvidoAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertAdminMgmtVencimento(input: {
  tenantId: string;
  workspaceId: string;
  origemTipo: AdminMgmtVencimentoOrigem;
  origemId: string;
  descricao: string;
  dataVencimento: Date;
  valorAssociado?: number | null;
  diasAntecedenciaAlerta?: number;
  responsavel?: string | null;
}) {
  const settings = await getAdminMgmtSettings(input.workspaceId, input.tenantId);
  const row = await prisma.adminMgmtVencimento.upsert({
    where: {
      workspaceId_origemTipo_origemId: {
        workspaceId: input.workspaceId,
        origemTipo: input.origemTipo,
        origemId: input.origemId,
      },
    },
    create: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      origemTipo: input.origemTipo,
      origemId: input.origemId,
      descricao: input.descricao,
      dataVencimento: input.dataVencimento,
      valorAssociado: input.valorAssociado ?? null,
      diasAntecedenciaAlerta: input.diasAntecedenciaAlerta ?? settings.defaultAlertDays,
      responsavel: input.responsavel ?? settings.defaultResponsavel,
      status: computeVencimentoStatus(input.dataVencimento, 'pendente'),
    },
    update: {
      descricao: input.descricao,
      dataVencimento: input.dataVencimento,
      valorAssociado: input.valorAssociado ?? null,
      diasAntecedenciaAlerta: input.diasAntecedenciaAlerta ?? settings.defaultAlertDays,
      responsavel: input.responsavel ?? settings.defaultResponsavel,
      status: computeVencimentoStatus(input.dataVencimento, 'pendente'),
      resolvidoAt: null,
    },
  });
  return mapVencimento(row);
}

export async function deleteAdminMgmtVencimentoByOrigem(
  workspaceId: string,
  origemTipo: AdminMgmtVencimentoOrigem,
  origemId: string
) {
  await prisma.adminMgmtVencimento.deleteMany({
    where: { workspaceId, origemTipo, origemId },
  });
}

export async function listAdminMgmtVencimentos(
  workspaceId: string,
  tenantId: string,
  options?: { status?: string; from?: string; to?: string }
) {
  const rows = await prisma.adminMgmtVencimento.findMany({
    where: {
      workspaceId,
      tenantId,
      ...(options?.from || options?.to
        ? {
            dataVencimento: {
              ...(options.from ? { gte: new Date(options.from) } : {}),
              ...(options.to ? { lte: new Date(options.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ dataVencimento: 'asc' }, { createdAt: 'asc' }],
  });

  const mapped = rows.map(mapVencimento);
  if (options?.status && options.status !== 'all') {
    return mapped.filter((row) => row.status === options.status);
  }
  return mapped;
}

export async function resolveAdminMgmtVencimento(
  id: string,
  workspaceId: string,
  tenantId: string
) {
  const existing = await prisma.adminMgmtVencimento.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return null;
  const row = await prisma.adminMgmtVencimento.update({
    where: { id },
    data: { status: 'resolvido', resolvidoAt: new Date() },
  });
  return mapVencimento(row);
}

export async function resolveAdminMgmtVencimentoByOrigem(
  workspaceId: string,
  tenantId: string,
  origemTipo: AdminMgmtVencimentoOrigem,
  origemId: string
) {
  const existing = await prisma.adminMgmtVencimento.findFirst({
    where: { workspaceId, tenantId, origemTipo, origemId },
  });
  if (!existing) return null;
  return resolveAdminMgmtVencimento(existing.id, workspaceId, tenantId);
}

export async function reopenAdminMgmtVencimentoByOrigem(
  workspaceId: string,
  tenantId: string,
  origemTipo: AdminMgmtVencimentoOrigem,
  origemId: string
) {
  const existing = await prisma.adminMgmtVencimento.findFirst({
    where: { workspaceId, tenantId, origemTipo, origemId },
  });
  if (!existing) return null;
  return reopenAdminMgmtVencimento(existing.id, workspaceId, tenantId);
}

export async function reopenAdminMgmtVencimento(id: string, workspaceId: string, tenantId: string) {
  const existing = await prisma.adminMgmtVencimento.findFirst({
    where: { id, workspaceId, tenantId },
  });
  if (!existing) return null;
  const row = await prisma.adminMgmtVencimento.update({
    where: { id },
    data: {
      status: computeVencimentoStatus(existing.dataVencimento, 'pendente'),
      resolvidoAt: null,
    },
  });
  return mapVencimento(row);
}

export async function getAdminMgmtDashboard(workspaceId: string, tenantId: string) {
  const today = startOfDay(new Date());
  const monthEnd = addDays(today, 30);

  const rows = await listAdminMgmtVencimentos(workspaceId, tenantId);
  const pending = rows.filter((row) => row.status !== 'resolvido');

  const thisMonth = pending.filter((row) => {
    const due = startOfDay(new Date(row.dataVencimento));
    return due >= today && due <= monthEnd;
  });

  const overdue = pending.filter((row) => row.status === 'atrasado');

  const faturasPendentes = await prisma.adminMgmtFatura.count({
    where: {
      workspaceId,
      tenantId,
      estadoPagamento: { in: ['pendente', 'parcial'] },
    },
  });

  const faturasPendentesRows = await prisma.adminMgmtFatura.findMany({
    where: {
      workspaceId,
      tenantId,
      estadoPagamento: { in: ['pendente', 'parcial'] },
    },
    select: { valorTotal: true, dataVencimento: true, clienteId: true },
  });

  const lancamentosRows = await prisma.adminMgmtLancamento.findMany({
    where: { workspaceId, tenantId },
    select: { valorAbatimento: true, clienteId: true },
  });

  const lancamentosPorCliente = lancamentosRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.clienteId] = (acc[row.clienteId] ?? 0) + Number(row.valorAbatimento);
    return acc;
  }, {});

  const faturasPorCliente = faturasPendentesRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.clienteId] = (acc[row.clienteId] ?? 0) + Number(row.valorTotal);
    return acc;
  }, {});

  const totalPorReceberNet = Object.entries(faturasPorCliente).reduce((sum, [clienteId, total]) => {
    const abatimentos = lancamentosPorCliente[clienteId] ?? 0;
    return sum + Math.max(0, total - abatimentos);
  }, 0);

  const faturasEmAtraso = faturasPendentesRows.filter((row) => {
    if (!row.dataVencimento) return false;
    return startOfDay(row.dataVencimento) < today;
  }).length;

  const byOrigem = pending.reduce<Record<string, number>>((acc, row) => {
    acc[row.origemTipo] = (acc[row.origemTipo] ?? 0) + 1;
    return acc;
  }, {});

  const alertWindow = pending.filter((row) => {
    const due = startOfDay(new Date(row.dataVencimento));
    const alertFrom = addDays(due, -row.diasAntecedenciaAlerta);
    return alertFrom <= today && due >= today;
  });

  return {
    totals: {
      pending: pending.length,
      overdue: overdue.length,
      faturasPendentes,
      faturasEmAtraso,
      totalPorReceber: totalPorReceberNet.toFixed(2),
      thisMonth: thisMonth.length,
      alertWindow: alertWindow.length,
    },
    byOrigem,
    upcoming: pending.slice(0, 20),
    overdue: overdue.slice(0, 20),
  };
}

export async function refreshAdminMgmtVencimentoStatuses(workspaceId: string, tenantId: string) {
  const rows = await prisma.adminMgmtVencimento.findMany({
    where: { workspaceId, tenantId, status: { not: 'resolvido' } },
  });
  for (const row of rows) {
    const next = computeVencimentoStatus(row.dataVencimento, row.status);
    if (next !== row.status) {
      await prisma.adminMgmtVencimento.update({
        where: { id: row.id },
        data: { status: next },
      });
    }
  }
}
