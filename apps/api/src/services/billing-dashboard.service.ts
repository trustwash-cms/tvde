import { prisma } from '@tvde/database';
import { openPaymentWhere } from './billing-payment.service';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function mapUpcoming(row: {
  id: string;
  number: string;
  total: { toString(): string } | number;
  dueDate: Date | null;
  issuedAt: Date | null;
  documentType: string;
  paymentStatus: string;
  billingEntity: { name: string } | null;
  client: { name: string } | null;
}) {
  const party = row.billingEntity?.name ?? row.client?.name ?? '—';
  return {
    id: row.id,
    number: row.number,
    descricao: `${row.number} — ${party}`,
    dataVencimento: row.dueDate?.toISOString().slice(0, 10) ?? null,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    valorTotal: Number(row.total).toFixed(2),
    documentType: row.documentType,
    paymentStatus: row.paymentStatus,
    partyName: party,
  };
}

export async function getBillingDashboard(workspaceId: string, tenantId: string) {
  const today = startOfDay(new Date());
  const monthEnd = addDays(today, 30);

  const openWhere = {
    workspaceId,
    tenantId,
    ...openPaymentWhere,
  };

  const openRows = await prisma.invoice.findMany({
    where: openWhere,
    select: {
      id: true,
      number: true,
      total: true,
      dueDate: true,
      issuedAt: true,
      documentType: true,
      paymentStatus: true,
      billingEntity: { select: { name: true } },
      client: { select: { name: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { issuedAt: 'desc' }],
  });

  const pending = openRows.length;
  const totalPorReceber = openRows.reduce((sum, row) => sum + Number(row.total), 0);

  const overdueRows = openRows.filter((row) => {
    if (!row.dueDate) return false;
    return startOfDay(row.dueDate) < today;
  });
  const overdueAmount = overdueRows.reduce((sum, row) => sum + Number(row.total), 0);

  const thisMonthRows = openRows.filter((row) => {
    if (!row.dueDate) return false;
    const due = startOfDay(row.dueDate);
    return due >= today && due <= monthEnd;
  });

  const upcoming = openRows
    .filter((row) => row.dueDate && startOfDay(row.dueDate) >= today)
    .slice(0, 20)
    .map(mapUpcoming);

  const overdue = overdueRows.slice(0, 20).map(mapUpcoming);

  return {
    totals: {
      pending,
      overdue: overdueRows.length,
      overdueAmount: overdueAmount.toFixed(2),
      faturasPendentes: pending,
      faturasEmAtraso: overdueRows.length,
      totalPorReceber: totalPorReceber.toFixed(2),
      thisMonth: thisMonthRows.length,
    },
    upcoming,
    overdue,
  };
}
