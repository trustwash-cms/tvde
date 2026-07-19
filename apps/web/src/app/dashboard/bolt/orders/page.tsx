'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { withSearchQuery } from '@/lib/list-search';
import { ListPagination } from '@/components/list-pagination';

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
  isPaid: boolean;
}

interface OrdersResponse {
  items: BoltOrderRow[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 50;

export default function BoltOrdersPage() {
  const { workspaceId } = useWorkspaceContext();
  const [rows, setRows] = useState<BoltOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');

  const load = useCallback(
    async (search: string, pageIndex: number) => {
      if (!workspaceId) return;
      const base = withSearchQuery(withWorkspaceQuery(API_PATHS.bolt.orders, workspaceId), search);
      const url = `${base}${base.includes('?') ? '&' : '?'}page=${pageIndex}&limit=${PAGE_SIZE}`;
      const res = await apiFetch<OrdersResponse>(url, {}, getStoredToken());
      if (res.data) {
        setRows(res.data.items);
        setTotal(res.data.total);
        setPage(res.data.page);
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

  function onClear() {
    setQ('');
    setAppliedQ('');
    setPage(0);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Corridas <strong>finished</strong> com valor. Coluna «Preço» ={' '}
        <code className="text-xs">ride_price</code> da Fleet API (valor da corrida para a
        frota/motorista — não o total bruto ao passageiro com comissão Bolt).
      </p>

      <form onSubmit={onFilter} className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">Buscar</label>
          <input
            className="input w-full"
            placeholder="Referência, motorista ou veículo"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary">
          Filtrar
        </button>
        <button type="button" className="btn-secondary" onClick={onClear}>
          Limpar
        </button>
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
              <th className="px-6 py-3">Pago</th>
              <th className="px-6 py-3">Data</th>
              <th className="px-6 py-3">Paradas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-t ${row.isPaid ? 'bg-emerald-50/60' : 'bg-red-50/40'}`}
              >
                <td className="px-6 py-3">{row.boltCompanyId ?? '—'}</td>
                <td className="px-6 py-3">{row.driverName ?? '—'}</td>
                <td className="px-6 py-3">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                    {row.orderStatus ?? '—'}
                  </span>
                </td>
                <td className="px-6 py-3">{row.vehicleModel ?? '—'}</td>
                <td className="px-6 py-3">{row.ridePrice ? `${Number(row.ridePrice).toFixed(2)}€` : '—'}</td>
                <td className="px-6 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.isPaid
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {row.isPaid ? 'Sim' : 'Não'}
                  </span>
                </td>
                <td className="px-6 py-3 text-slate-500">
                  {row.orderCreatedTimestamp ? new Date(row.orderCreatedTimestamp).toLocaleString('pt-PT') : '—'}
                </td>
                <td className="px-6 py-3">
                  <span className="rounded bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                    {row.stopsCount} parada(s)
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-slate-400">
                  Sem corridas concluídas com valor
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
