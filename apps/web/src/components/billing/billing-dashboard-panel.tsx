'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WEB_ROUTES, formatAdminMgmtMoney, getDocumentTypeLabel, type MoloniDocumentType } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';

interface DashboardData {
  totals: {
    pending: number;
    overdue: number;
    overdueAmount: string;
    faturasPendentes: number;
    faturasEmAtraso: number;
    totalPorReceber: string;
    thisMonth: number;
  };
  upcoming: Array<{
    id: string;
    number: string;
    descricao: string;
    dataVencimento: string | null;
    valorTotal: string;
    documentType: string;
    paymentStatus: string;
    partyName: string;
  }>;
  overdue: Array<{
    id: string;
    number: string;
    descricao: string;
    dataVencimento: string | null;
    valorTotal: string;
    documentType: string;
    paymentStatus: string;
    partyName: string;
  }>;
}

const cardLinkClass =
  'card block transition hover:border-[var(--color-primary)] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]';

const pendentesHref = `${WEB_ROUTES.dashboard.billing.documentos}?paymentStatus=pendente`;

export function BillingDashboardPanel() {
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspaceContext();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    setError('');
    setData(null);
    apiFetch<DashboardData>(
      withWorkspaceQuery(API_PATHS.billing.dashboard, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setData(res.data);
      else setError(getApiErrorMessage(res));
    });
  }, [workspaceId]);

  return (
    <div className="space-y-6">
      <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />

      {!workspaceId && (
        <p className="text-sm text-slate-500">Seleccione um workspace.</p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {workspaceId && !error && !data && (
        <p className="text-sm text-slate-500">A carregar dashboard…</p>
      )}

      {data && (
        <>
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
                subtitle: formatAdminMgmtMoney(data.totals.totalPorReceber)
                  ? `${formatAdminMgmtMoney(data.totals.totalPorReceber)} por receber`
                  : null,
                tone: 'text-amber-700',
                href: pendentesHref,
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
                value: data.totals.overdue,
                subtitle:
                  data.totals.faturasEmAtraso > 0
                    ? `${formatAdminMgmtMoney(data.totals.overdueAmount) ?? ''} em dívida`.trim()
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
                <p className="text-2xl font-semibold text-amber-800">
                  {formatAdminMgmtMoney(data.totals.totalPorReceber)}
                </p>
              </div>
              <Link href={pendentesHref} className="btn-primary text-sm">
                Ver faturas pendentes
              </Link>
            </div>
          )}

          <div id="proximos-vencimentos" className="card space-y-3 scroll-mt-4">
            <h2 className="text-sm font-semibold text-slate-800">Próximos vencimentos</h2>
            {data.upcoming.length === 0 ? (
              <p className="text-sm text-slate-500">Sem vencimentos pendentes.</p>
            ) : (
              <div className="space-y-2">
                {data.upcoming.map((item) => (
                  <Link
                    key={item.id}
                    href={pendentesHref}
                    className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm transition hover:border-[var(--color-primary)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{item.descricao}</p>
                        <p className="text-xs text-slate-500">
                          {getDocumentTypeLabel(item.documentType as MoloniDocumentType)}
                          {item.dataVencimento
                            ? ` · ${new Date(item.dataVencimento).toLocaleDateString('pt-PT')}`
                            : ''}
                        </p>
                      </div>
                      <span className="font-mono text-sm">
                        {Number(item.valorTotal).toFixed(2)} €
                      </span>
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
                    href={pendentesHref}
                    className="block rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 transition hover:bg-red-100"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{item.descricao}</p>
                        <p className="text-xs">
                          {getDocumentTypeLabel(item.documentType as MoloniDocumentType)}
                          {item.dataVencimento
                            ? ` · ${new Date(item.dataVencimento).toLocaleDateString('pt-PT')}`
                            : ''}
                        </p>
                      </div>
                      <span className="font-mono text-sm">
                        {Number(item.valorTotal).toFixed(2)} €
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
