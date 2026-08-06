'use client';

import { useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { OpenInWhmcsLink, WhmcsConnectionBanner } from '@/components/whmcs/whmcs-ui';

type ProductRow = {
  pid: number;
  gid?: number;
  type?: string;
  name: string;
  description?: string;
  module?: string;
  paytype?: string;
  openInWhmcs: string;
};

export function WhmcsProductsPanel() {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    setHint('');
    const q = withWorkspaceQuery(API_PATHS.whmcs.products, workspaceId);
    apiFetch<{ rows: ProductRow[]; total: number }>(q, {}, getStoredToken()).then((res) => {
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
  }, [workspaceId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Produtos (catálogo)</h2>
          <p className="text-sm text-slate-500">
            {total} produto{total === 1 ? '' : 's'} no WHMCS.
          </p>
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
              <th className="px-3 py-2">PID</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Módulo</th>
              <th className="px-3 py-2">Pagamento</th>
              <th className="px-3 py-2 text-right">Acções</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.pid} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{row.pid}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">{row.type || '—'}</td>
                <td className="px-3 py-2">{row.module || '—'}</td>
                <td className="px-3 py-2">{row.paytype || '—'}</td>
                <td className="px-3 py-2 text-right">
                  <OpenInWhmcsLink href={row.openInWhmcs} />
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  Sem produtos
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
