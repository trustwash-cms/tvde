'use client';

import { FormEvent, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { withSearchQuery } from '@/lib/list-search';

interface BoltVehicleRow {
  id: string;
  model: string | null;
  year: number | null;
  regNumber: string | null;
  vin: string | null;
  portalStatus: string | null;
  boltCompanyId: number | null;
  updatedAt: string;
}

export default function BoltVehiclesPage() {
  const { workspaceId } = useWorkspaceContext();
  const [rows, setRows] = useState<BoltVehicleRow[]>([]);
  const [q, setQ] = useState('');

  function load(search = q) {
    if (!workspaceId) return;
    apiFetch<BoltVehicleRow[]>(
      withSearchQuery(withWorkspaceQuery(API_PATHS.bolt.vehicles, workspaceId), search),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setRows(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [workspaceId]);

  return (
    <div className="space-y-6">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); load(); }} className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <input className="input w-full" placeholder="Modelo, placa ou VIN" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary">Filtrar</button>
      </form>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-6 py-3">Modelo</th>
              <th className="px-6 py-3">Ano</th>
              <th className="px-6 py-3">Placa</th>
              <th className="px-6 py-3">VIN</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Empresa</th>
              <th className="px-6 py-3">Última actualização</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-6 py-3">{row.model ?? '—'}</td>
                <td className="px-6 py-3">{row.year ?? '—'}</td>
                <td className="px-6 py-3">{row.regNumber ?? '—'}</td>
                <td className="px-6 py-3 font-mono text-xs">{row.vin ?? '—'}</td>
                <td className="px-6 py-3"><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{row.portalStatus ?? '—'}</span></td>
                <td className="px-6 py-3">{row.boltCompanyId ?? '—'}</td>
                <td className="px-6 py-3 text-slate-500">{new Date(row.updatedAt).toLocaleString('pt-PT')}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">Sem veículos</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
