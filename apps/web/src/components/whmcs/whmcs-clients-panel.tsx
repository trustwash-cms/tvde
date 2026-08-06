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

type ClientRow = {
  id: number;
  firstname: string;
  lastname: string;
  companyname: string;
  email: string;
  status: string;
  datecreated?: string;
  openInWhmcs: string;
};

const LIMIT = 50;

export function WhmcsClientsPanel() {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [status, setStatus] = useState('All');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    setHint('');
    let q = withWorkspaceQuery(API_PATHS.whmcs.clients, workspaceId);
    q += `${q.includes('?') ? '&' : '?'}limit=${LIMIT}&offset=${offset}`;
    if (searchApplied) q += `&search=${encodeURIComponent(searchApplied)}`;
    if (status && status !== 'All') q += `&status=${encodeURIComponent(status)}`;

    apiFetch<{ rows: ClientRow[]; total: number }>(q, {}, getStoredToken()).then((res) => {
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
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, searchApplied, status, offset]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Clientes</h2>
          <p className="text-sm text-slate-500">Lista live do WHMCS (só leitura).</p>
        </div>
        {!wsLoading && workspaces.length > 1 ? (
          <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
        ) : null}
      </div>

      <WhmcsConnectionBanner error={error} hint={hint} />

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setSearchApplied(search.trim());
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Pesquisa
          <input
            className="input min-w-[200px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome, email, empresa…"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Estado
          <select className="input" value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
            <option value="All">Todos</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Closed">Closed</option>
          </select>
        </label>
        <button type="submit" className="btn-primary text-sm" disabled={loading}>
          Filtrar
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acções</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                <td className="px-3 py-2">
                  {[row.firstname, row.lastname].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-3 py-2 text-slate-600">{row.companyname || '—'}</td>
                <td className="px-3 py-2">{row.email || '—'}</td>
                <td className="px-3 py-2">{row.status || '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Link
                      href={WEB_ROUTES.dashboard.whmcs.cliente(row.id)}
                      className="inline-flex rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      Ver
                    </Link>
                    <OpenInWhmcsLink href={row.openInWhmcs} />
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  Sem clientes
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
