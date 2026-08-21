'use client';

import { useCallback, useEffect, useState } from 'react';
import { Car, Euro, Loader2, RefreshCw, ShoppingCart, Smartphone } from 'lucide-react';
import { hasMinRole, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { withWorkspaceQuery } from '@/lib/workspace-query';

interface DashboardData {
  ordersCount: number;
  driversCount: number;
  vehiclesCount: number;
  totalRevenue: string;
  recentOrders: Array<{
    id: string;
    orderReference: string;
    driverName: string | null;
    orderStatus: string | null;
    vehicleModel: string | null;
    ridePrice: string | null;
    orderCreatedTimestamp: string | null;
    stopsCount: number;
  }>;
}

function formatMoney(value: string) {
  const n = Number(value);
  if (Number.isNaN(n)) return '0,00€';
  return `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;
}

export default function BoltDashboardPage() {
  const { workspaceId } = useWorkspaceContext();
  const [role, setRole] = useState<Role | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncSuccess, setSyncSuccess] = useState('');

  const canManage = role ? hasMinRole(role, 'superadmin') : false;

  const loadDashboard = useCallback(() => {
    if (!workspaceId) return;
    apiFetch<DashboardData>(
      withWorkspaceQuery(API_PATHS.bolt.dashboard, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setData(res.data);
    });
  }, [workspaceId]);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.role) setRole(res.data.role);
    });
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleSync() {
    if (!workspaceId || !canManage) return;
    setSyncing(true);
    setSyncError('');
    setSyncSuccess('');
    const res = await apiFetch(
      API_PATHS.bolt.sync,
      {
        method: 'POST',
        body: JSON.stringify({ workspaceId, type: 'all' }),
      },
      getStoredToken()
    );
    setSyncing(false);
    if (res.success) {
      setSyncSuccess('Sincronização concluída');
      loadDashboard();
    } else {
      setSyncError(getApiErrorMessage(res));
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Corridas concluídas', value: data?.ordersCount ?? 0, icon: ShoppingCart },
          { label: 'Motoristas', value: data?.driversCount ?? 0, icon: Smartphone },
          { label: 'Veículos na frota', value: data?.vehiclesCount ?? 0, icon: Car },
          { label: 'Receita total', value: formatMoney(data?.totalRevenue ?? '0'), icon: Euro },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-slate-900">{card.value}</p>
                  <p className="text-sm text-slate-500">{card.label}</p>
                </div>
                <Icon className="text-slate-300" size={28} />
              </div>
            </div>
          );
        })}
      </div>

      {syncError ? <p className="text-sm text-red-600">{syncError}</p> : null}
      {syncSuccess ? <p className="text-sm text-emerald-700">{syncSuccess}</p> : null}

      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
          <h2 className="font-semibold text-slate-900">Corridas recentes (finished)</h2>
          {canManage ? (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-sm"
              disabled={syncing || !workspaceId}
              onClick={() => void handleSync()}
            >
              {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {syncing ? 'A sincronizar…' : 'Sync'}
            </button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-6 py-3">Referência</th>
                <th className="px-6 py-3">Motorista</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Veículo</th>
                <th className="px-6 py-3">Preço</th>
                <th className="px-6 py-3">Data</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentOrders ?? []).map((order) => (
                <tr key={order.id} className="border-t">
                  <td className="px-6 py-3 font-mono text-xs">{order.orderReference.slice(0, 16)}…</td>
                  <td className="px-6 py-3">{order.driverName ?? '—'}</td>
                  <td className="px-6 py-3">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {order.orderStatus ?? '—'}
                    </span>
                  </td>
                  <td className="px-6 py-3">{order.vehicleModel ?? '—'}</td>
                  <td className="px-6 py-3">{order.ridePrice ? formatMoney(order.ridePrice) : '—'}</td>
                  <td className="px-6 py-3 text-slate-500">
                    {order.orderCreatedTimestamp
                      ? new Date(order.orderCreatedTimestamp).toLocaleString('pt-PT')
                      : '—'}
                  </td>
                </tr>
              ))}
              {!data?.recentOrders?.length && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                    Sem pedidos — configure a API Bolt em Configurações e sincronize.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
