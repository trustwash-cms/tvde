'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { withSearchQuery } from '@/lib/list-search';
import { ListPagination } from '@/components/list-pagination';

interface BoltDriverRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  portalStatus: string | null;
  boltCompanyId: number | null;
  updatedAt: string;
}

interface DriversResponse {
  items: BoltDriverRow[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 50;

export default function BoltDriversPage() {
  const { workspaceId } = useWorkspaceContext();
  const [rows, setRows] = useState<BoltDriverRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');

  const load = useCallback(
    async (search: string, pageIndex: number) => {
      if (!workspaceId) return;
      const base = withSearchQuery(withWorkspaceQuery(API_PATHS.bolt.drivers, workspaceId), search);
      const url = `${base}${base.includes('?') ? '&' : '?'}page=${pageIndex}&limit=${PAGE_SIZE}`;
      const res = await apiFetch<DriversResponse>(url, {}, getStoredToken());
      if (res.data) {
        setRows(res.data.items ?? []);
        setTotal(res.data.total ?? 0);
        setPage(res.data.page ?? pageIndex);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    setPage(0);
    setAppliedQ('');
    setQ('');
  }, [workspaceId]);

  useEffect(() => {
    void load(appliedQ, page);
  }, [workspaceId, page, appliedQ, load]);

  function onFilter(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(q.trim());
    setPage(0);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onFilter} className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <input
            className="input w-full"
            placeholder="Nome, telefone ou email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary">
          Filtrar
        </button>
      </form>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-6 py-3">Nome</th>
              <th className="px-6 py-3">Telefone</th>
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Empresa</th>
              <th className="px-6 py-3">Última actualização</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-6 py-3">{row.name ?? '—'}</td>
                <td className="px-6 py-3">{row.phone ?? '—'}</td>
                <td className="px-6 py-3">{row.email ?? '—'}</td>
                <td className="px-6 py-3">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                    {row.portalStatus ?? '—'}
                  </span>
                </td>
                <td className="px-6 py-3">{row.boltCompanyId ?? '—'}</td>
                <td className="px-6 py-3 text-slate-500">
                  {new Date(row.updatedAt).toLocaleString('pt-PT')}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                  Sem motoristas
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="border-t px-6 pb-4">
          <ListPagination
            page={page}
            limit={PAGE_SIZE}
            total={total}
            limits={[50]}
            onPageChange={setPage}
            onLimitChange={() => undefined}
          />
        </div>
      </div>
    </div>
  );
}
