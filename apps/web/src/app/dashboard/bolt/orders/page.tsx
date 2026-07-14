'use client';

import { FormEvent, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { withSearchQuery } from '@/lib/list-search';

interface BoltOrderRow {
  id: string;
  orderReference: string;
  driverName: string | null;
  orderStatus: string | null;
  vehicleModel: string | null;
  ridePrice: string | null;
  orderCreatedTimestamp: string | null;
  stopsCount: number;
  boltCompanyId: number | null;
}

export default function BoltOrdersPage() {
  const { workspaceId } = useWorkspaceContext();
  const [rows, setRows] = useState<BoltOrderRow[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  function load(search = q, statusFilter = status) {
    if (!workspaceId) return;
    const path = withSearchQuery(withWorkspaceQuery(API_PATHS.bolt.orders, workspaceId), search);
    const url = statusFilter ? `${path}${path.includes('?') ? '&' : '?'}status=${encodeURIComponent(statusFilter)}` : path;
    apiFetch<BoltOrderRow[]>(url, {}, getStoredToken()).then((res) => {
      if (res.data) setRows(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [workspaceId]);

  function onFilter(e: FormEvent) {
    e.preventDefault();
    load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onFilter} className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">Buscar</label>
          <input className="input w-full" placeholder="Referência, motorista ou veículo" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="finished">finished</option>
          </select>
        </div>
        <button type="submit" className="btn-primary">Filtrar</button>
        <button type="button" className="btn-secondary" onClick={() => { setQ(''); setStatus(''); load('', ''); }}>Limpar</button>
      </form>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-6 py-3">Empresa</th>
              <th className="px-6 py-3">Motorista</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Veículo</th>
              <th className="px-6 py-3">Preço</th>
              <th className="px-6 py-3">Data</th>
              <th className="px-6 py-3">Paradas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-6 py-3">{row.boltCompanyId ?? '—'}</td>
                <td className="px-6 py-3">{row.driverName ?? '—'}</td>
                <td className="px-6 py-3"><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{row.orderStatus ?? '—'}</span></td>
                <td className="px-6 py-3">{row.vehicleModel ?? '—'}</td>
                <td className="px-6 py-3">{row.ridePrice ? `${Number(row.ridePrice).toFixed(2)}€` : '—'}</td>
                <td className="px-6 py-3 text-slate-500">{row.orderCreatedTimestamp ? new Date(row.orderCreatedTimestamp).toLocaleString('pt-PT') : '—'}</td>
                <td className="px-6 py-3"><span className="rounded bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{row.stopsCount} parada(s)</span></td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">Sem pedidos</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
