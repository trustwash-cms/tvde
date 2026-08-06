'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import {
  OpenInWhmcsLink,
  WhmcsConnectionBanner,
  WhmcsPagination,
} from '@/components/whmcs/whmcs-ui';

type ServiceRow = {
  id: number;
  clientid: number;
  clientName?: string;
  name?: string;
  domain?: string;
  status?: string;
  billingcycle?: string;
  nextduedate?: string;
  amount?: string;
  openInWhmcs: string;
};

const LIMIT = 50;

export function WhmcsServicesPanel() {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    setHint('');
    let q = withWorkspaceQuery(API_PATHS.whmcs.services, workspaceId);
    q += `${q.includes('?') ? '&' : '?'}limit=${LIMIT}&offset=${offset}`;
    apiFetch<{ rows: ServiceRow[]; total: number }>(q, {}, getStoredToken()).then((res) => {
      setLoading(false);
      if (!res.success) {
        setError(getApiErrorMessage(res));
        const d = res.data as { hint?: string } | undefined;
        setHint(d?.hint ?? (res as { hint?: string }).hint ?? '');
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(res.data?.rows ?? []);
      setTotal(res.data?.total ?? 0);
    });
  }, [workspaceId, offset]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Serviços / Produtos de cliente</h2>
          <p className="text-sm text-slate-500">Hosting e serviços activos no WHMCS.</p>
        </div>
        {!wsLoading && workspaces.length > 1 ? (
          <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
        ) : null}
      </div>

      <WhmcsConnectionBanner error={error} hint={hint} />

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2">Domínio</th>
              <th className="px-3 py-2">Ciclo</th>
              <th className="px-3 py-2">Próx. venc.</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acções</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                <td className="px-3 py-2">
                  <Link
                    href={WEB_ROUTES.dashboard.whmcs.cliente(row.clientid)}
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    {row.clientName || `#${row.clientid}`}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.name || '—'}</td>
                <td className="px-3 py-2">{row.domain || '—'}</td>
                <td className="px-3 py-2">{row.billingcycle || '—'}</td>
                <td className="px-3 py-2">{row.nextduedate || '—'}</td>
                <td className="px-3 py-2">{row.status || '—'}</td>
                <td className="px-3 py-2 text-right">
                  <OpenInWhmcsLink href={row.openInWhmcs} />
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  Sem serviços
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <WhmcsPagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} />
    </div>
  );
}
