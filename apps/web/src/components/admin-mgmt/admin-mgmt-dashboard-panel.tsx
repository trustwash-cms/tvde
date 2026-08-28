'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  WEB_ROUTES,
  formatAdminMgmtMoney,
  getAdminMgmtVencimentoHref,
  getAdminMgmtVencimentoOrigemLabel,
  getAdminMgmtVencimentoStatusLabel,
  vencimentoUrgencyClass,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';

interface DashboardData {
  totals: {
    pending: number;
    overdue: number;
    faturasPendentes: number;
    faturasEmAtraso: number;
    totalPorReceber: string;
    thisMonth: number;
    alertWindow: number;
  };
  byOrigem: Record<string, number>;
  upcoming: Array<{
    id: string;
    origemTipo: string;
    origemId: string;
    descricao: string;
    dataVencimento: string;
    valorAssociado: string | null;
    status: string;
  }>;
  overdue: Array<{
    id: string;
    origemTipo: string;
    origemId: string;
    descricao: string;
    dataVencimento: string;
    valorAssociado: string | null;
    status: string;
  }>;
}

const cardLinkClass =
  'card block transition hover:border-[var(--color-primary)] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]';

export function AdminMgmtDashboardPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    apiFetch<DashboardData>(
      withWorkspaceQuery(API_PATHS.adminMgmt.dashboard, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setData(res.data);
      else setError(getApiErrorMessage(res));
    });
  }, [workspaceId]);

  if (!workspaceId) {
    return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!data) {
    return <p className="text-sm text-slate-500">A carregar dashboard…</p>;
  }

  const faturasHref = `${WEB_ROUTES.dashboard.adminMgmt.faturas}?estado=pendente`;
  const totalPorReceber = formatAdminMgmtMoney(data.totals.totalPorReceber);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Pendentes',
            value: data.totals.pending,
            subtitle: null as string | null,
            tone: 'text-slate-800',
            href: '#proximos-vencimentos',
          },
          {
            label: 'Faturas',
            value: data.totals.faturasPendentes,
            subtitle: totalPorReceber ? `${totalPorReceber} por receber` : null,
            tone: 'text-amber-700',
            href: faturasHref,
          },
          {
            label: 'Este mês',
            value: data.totals.thisMonth,
            subtitle: null,
            tone: 'text-blue-700',
            href: '#proximos-vencimentos',
          },
          {
            label: 'Em atraso',
            value: data.totals.overdue + data.totals.faturasEmAtraso,
            subtitle:
              data.totals.faturasEmAtraso > 0
                ? `${data.totals.faturasEmAtraso} fatura(s) em dívida`
                : null,
            tone: 'text-red-700',
            href: '#em-atraso',
          },
        ].map((card) => {
          const inner = (
            <>
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${card.tone}`}>{card.value}</p>
              {card.subtitle && <p className="mt-1 text-xs text-slate-500">{card.subtitle}</p>}
            </>
          );
          return card.href.startsWith('#') ? (
            <a key={card.label} href={card.href} className={cardLinkClass}>
              {inner}
            </a>
          ) : (
            <Link key={card.label} href={card.href} className={cardLinkClass}>
              {inner}
            </Link>
          );
        })}
      </div>

      {Number(data.totals.totalPorReceber) > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50">
          <div>
            <p className="text-sm font-medium text-amber-900">Total por receber</p>
            <p className="text-2xl font-semibold text-amber-800">{totalPorReceber}</p>
          </div>
          <Link href={faturasHref} className="btn-primary text-sm">
            Ver faturas pendentes
          </Link>
        </div>
      )}

      <div id="proximos-vencimentos" className="card space-y-3 scroll-mt-4">
        <h2 className="text-sm font-semibold text-slate-800">Próximos vencimentos</h2>
        {data.upcoming.length === 0 ? (
          <p className="text-sm text-slate-500">Sem vencimentos próximos.</p>
        ) : (
          <div className="space-y-2">
            {data.upcoming.map((item) => (
              <Link
                key={item.id}
                href={getAdminMgmtVencimentoHref(item.origemTipo)}
                className={`block rounded-lg border px-3 py-2 text-sm transition hover:opacity-90 ${vencimentoUrgencyClass(item.dataVencimento, item.status)}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{item.descricao}</p>
                    <p className="text-xs opacity-80">
                      {getAdminMgmtVencimentoOrigemLabel(item.origemTipo)} ·{' '}
                      {new Date(item.dataVencimento).toLocaleDateString('pt-PT')} ·{' '}
                      {getAdminMgmtVencimentoStatusLabel(item.status)}
                    </p>
                  </div>
                  {item.valorAssociado && (
                    <span className="font-mono text-sm">{Number(item.valorAssociado).toFixed(2)} €</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {data.overdue.length > 0 && (
        <div id="em-atraso" className="card space-y-3 scroll-mt-4">
          <h2 className="text-sm font-semibold text-red-800">Em atraso</h2>
          <div className="space-y-2">
            {data.overdue.map((item) => (
              <Link
                key={item.id}
                href={getAdminMgmtVencimentoHref(item.origemTipo)}
                className="block rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 transition hover:bg-red-100"
              >
                <p className="font-medium">{item.descricao}</p>
                <p className="text-xs">
                  {getAdminMgmtVencimentoOrigemLabel(item.origemTipo)} ·{' '}
                  {new Date(item.dataVencimento).toLocaleDateString('pt-PT')}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
