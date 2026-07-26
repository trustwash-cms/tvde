'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Wallet } from 'lucide-react';
import { API_PATHS, WEB_ROUTES } from '@tvde/shared';
import { apiFetch, getStoredToken } from '@/lib/api';
import { DashboardUpcomingPanel } from '@/components/dashboard-upcoming-panel';
import { hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';
import type { Role } from '@tvde/shared';

interface DriverSummaryCard {
  id: string;
  label: string;
  total: string;
  href: string;
  periodLabel: string;
}

interface DriverSummary {
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

function formatMoney(value: string) {
  const n = Number(value);
  if (Number.isNaN(n)) return '€ 0,00';
  return `€ ${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function DriverDashboard({
  role,
  capabilities,
}: {
  role: Role;
  capabilities?: ModuleCapabilities;
}) {
  const [summary, setSummary] = useState<DriverSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const calendarActive = hasActiveModule(role, capabilities, 'calendar');

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    apiFetch<DriverSummary>(API_PATHS.dashboardApi.driverSummary, {}, token).then((res) => {
      setLoading(false);
      if (res.data) setSummary(res.data);
    });
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar o seu resumo…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Bem-vindo{summary?.displayName ? `, ${summary.displayName}` : ''}
        </h1>
        <p className="mt-1 text-slate-500">Resumo da sua actividade nesta frota.</p>
      </div>

      {summary?.cards.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.cards.map((card) => (
            <Link
              key={card.id}
              href={card.href}
              className="card group flex flex-col gap-2 !p-4 transition hover:border-[var(--color-primary)] hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{card.label}</p>
                  <p className="text-xs text-slate-500">{card.periodLabel}</p>
                </div>
                <ChevronRight
                  size={16}
                  className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]"
                />
              </div>
              <p className="text-2xl font-bold tabular-nums text-slate-900">
                {formatMoney(card.total)}
              </p>
              <span className="text-xs font-medium text-[var(--color-primary)]">Ver detalhes</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Ainda não há módulos activos com dados para si. Fale com o gestor de frota.
        </p>
      )}

      {summary?.latestPayment ? (
        <Link
          href={WEB_ROUTES.dashboard.meusPagamentos.root}
          className="card flex items-center gap-3 !p-4 transition hover:border-[var(--color-primary)]"
        >
          <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700">
            <Wallet size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">Último pagamento</p>
            <p className="text-xs text-slate-500">
              {summary.latestPayment.periodStart} → {summary.latestPayment.periodEnd}
              {summary.latestPayment.isPaid ? ' · Pago' : ' · Pendente'}
            </p>
          </div>
          <p className="text-lg font-bold tabular-nums text-slate-900">
            {formatMoney(summary.latestPayment.resultadoFinal)}
          </p>
        </Link>
      ) : null}

      {calendarActive ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Próximos eventos
          </h2>
          <DashboardUpcomingPanel calendarActive adminMgmtActive={false} />
        </section>
      ) : null}
    </div>
  );
}
