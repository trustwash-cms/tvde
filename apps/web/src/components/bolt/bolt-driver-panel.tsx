'use client';

import { useCallback, useEffect, useState } from 'react';
import { currentMonthKey } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { MonthTotalCard } from '@/components/month-total-card';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { withWorkspaceQuery } from '@/lib/workspace-query';

interface Dashboard {
  ordersCount: number;
  monthTotal: string;
  totalRevenue: string;
}

interface OrderItem {
  id: string;
  orderReference: string;
  driverName: string | null;
  orderStatus: string | null;
  vehicleModel: string | null;
  ridePrice: string | null;
  orderCreatedTimestamp: string | null;
  isPaid: boolean;
  stopsCount: number;
}

interface OrdersResponse {
  items: OrderItem[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 50;

function formatMoney(value: string | number) {
  const n = Number(value);
  if (Number.isNaN(n)) return '0,00 €';
  return `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function BoltDriverPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const token = getStoredToken();
    const dashUrl = withWorkspaceQuery(
      `${API_PATHS.bolt.dashboard}?month=${encodeURIComponent(selectedMonth)}`,
      workspaceId
    );
    const ordersBase = withWorkspaceQuery(API_PATHS.bolt.orders, workspaceId);
    const ordersUrl = `${ordersBase}${ordersBase.includes('?') ? '&' : '?'}page=${page}&limit=${PAGE_SIZE}`;

    const [dash, list] = await Promise.all([
      apiFetch<Dashboard>(dashUrl, {}, token),
      apiFetch<OrdersResponse>(ordersUrl, {}, token),
    ]);

    if (dash.data) setDashboard(dash.data);
    if (list.data) {
      setItems(list.data.items);
      setTotal(list.data.total);
      setTotalPages(Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)));
    }
    if (!dash.success) setError(dash.error ?? 'Erro ao carregar Bolt');
    else setError('');
  }, [workspaceId, selectedMonth, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="card">
          <p className="text-sm text-slate-500">Corridas (total)</p>
          <p className="text-2xl font-bold">{dashboard?.ordersCount ?? 0}</p>
        </div>
        <MonthTotalCard
          selectId="bolt-month"
          label="Valor do mês (Pago a si)"
          value={formatMoney(dashboard?.monthTotal ?? 0)}
          monthKey={selectedMonth}
          onMonthChange={(m) => {
            setSelectedMonth(m);
            setPage(0);
          }}
        />
        <div className="card">
          <p className="text-sm text-slate-500">Receita total</p>
          <p className="text-2xl font-bold">{formatMoney(dashboard?.totalRevenue ?? 0)}</p>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Referência</th>
              <th className="px-4 py-3">Veículo</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Pago</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={`border-t ${item.isPaid ? 'bg-emerald-50/60' : 'bg-red-50/40'}`}
              >
                <td className="px-4 py-3 text-slate-600">
                  {item.orderCreatedTimestamp
                    ? new Date(item.orderCreatedTimestamp).toLocaleString('pt-PT')
                    : '—'}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {item.orderReference.slice(0, 16)}…
                </td>
                <td className="px-4 py-3">{item.vehicleModel ?? '—'}</td>
                <td className="px-4 py-3">
                  {item.ridePrice != null ? formatMoney(item.ridePrice) : '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.isPaid
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {item.isPaid ? 'Sim' : 'Não'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                    {item.orderStatus ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Sem corridas — quando a frota sincronizar a API Bolt, as suas corridas aparecem
                  aqui.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-sm text-slate-500">
            Página {page + 1} de {totalPages}
            {total ? ` · ${total} registo(s)` : ''} · {PAGE_SIZE}/página
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              «
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              »
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
