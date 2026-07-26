import type { PrismaClient } from '@tvde/database';
import { defaultPaymentWeekRange, type Role, WEB_ROUTES } from '@tvde/shared';
import { getUberDashboard } from './uber.service';
import { getViaVerdeDashboard } from './via-verde.service';
import { getElectricityDashboard } from './electricity.service';
import { getCombustivelDashboard } from './combustivel.service';
import { getDriverFleetScope } from './user-vehicle-matching.service';
import { getBoltDashboardStats } from './bolt-sync.service';
import { listPaymentReports } from './payment-report.service';

export interface DriverSummaryCard {
  id: string;
  label: string;
  total: string;
  href: string;
  periodLabel: string;
}

export interface DriverSummaryResult {
  displayName: string;
  weekStart: string;
  weekEnd: string;
  cards: DriverSummaryCard[];
  latestPayment: {
    id: string;
    periodStart: string;
    periodEnd: string;
    resultadoFinal: string;
    isPaid: boolean;
  } | null;
}

function money(value: string | number): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

export async function getDriverSummary(
  db: PrismaClient,
  input: {
    tenantId: string;
    userId: string;
    role: Role;
    workspaceId: string | null;
    fullName: string | null;
    username: string | null;
    email: string;
    activeModules: string[];
  }
): Promise<DriverSummaryResult> {
  const week = defaultPaymentWeekRange();
  const displayName =
    input.fullName?.trim() || input.username?.trim() || input.email.split('@')[0] || input.email;
  const active = new Set(input.activeModules);

  const cards: DriverSummaryCard[] = [];

  if (active.has('uber')) {
    const uber = await getUberDashboard(db, input.tenantId, input.userId, input.role);
    cards.push({
      id: 'uber',
      label: 'Uber',
      total: money(uber.monthTotal),
      href: WEB_ROUTES.dashboard.uber.root,
      periodLabel: `Mês ${uber.selectedMonth}`,
    });
  }

  if (active.has('bolt') && input.workspaceId) {
    const scope = await getDriverFleetScope(db, input.tenantId, input.userId, input.role);
    const bolt = await getBoltDashboardStats(input.workspaceId, {
      driverUuids: scope ? scope.uuidBolt : undefined,
    });
    cards.push({
      id: 'bolt',
      label: 'Bolt',
      total: money(bolt.totalRevenue),
      href: WEB_ROUTES.dashboard.bolt.root,
      periodLabel: 'Total (próprias corridas)',
    });
  }

  if (active.has('via_verde')) {
    const vv = await getViaVerdeDashboard(db, input.tenantId, input.userId, input.role);
    cards.push({
      id: 'via_verde',
      label: 'Via Verde',
      total: money(vv.monthTotal),
      href: WEB_ROUTES.dashboard.viaVerde.root,
      periodLabel: `Mês ${vv.selectedMonth}`,
    });
  }

  if (active.has('eletricidade')) {
    const elec = await getElectricityDashboard(db, input.tenantId, input.userId, input.role);
    cards.push({
      id: 'eletricidade',
      label: 'Eletricidade',
      total: money(elec.monthTotal),
      href: WEB_ROUTES.dashboard.eletricidade.root,
      periodLabel: `Mês ${elec.selectedMonth}`,
    });
  }

  if (active.has('combustivel')) {
    const fuel = await getCombustivelDashboard(db, input.tenantId, input.userId, input.role);
    cards.push({
      id: 'combustivel',
      label: 'Combustível',
      total: money(fuel.monthTotal),
      href: WEB_ROUTES.dashboard.combustivel.root,
      periodLabel: `Mês ${fuel.selectedMonth}`,
    });
  }

  let latestPayment: DriverSummaryResult['latestPayment'] = null;
  if (active.has('pagamentos')) {
    const reports = await listPaymentReports(db, input.tenantId, {
      userId: input.userId,
      page: 1,
      perPage: 1,
    });
    const first = reports.items[0];
    if (first) {
      latestPayment = {
        id: first.id,
        periodStart: first.periodStart,
        periodEnd: first.periodEnd,
        resultadoFinal: first.resultadoFinal,
        isPaid: first.isPaid,
      };
    }
  }

  return {
    displayName,
    weekStart: week.periodStart,
    weekEnd: week.periodEnd,
    cards,
    latestPayment,
  };
}
