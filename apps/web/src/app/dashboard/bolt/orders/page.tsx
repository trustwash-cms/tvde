'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { hasMinRole, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { withSearchQuery } from '@/lib/list-search';
import { ListPagination } from '@/components/list-pagination';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface BoltOrderRow {
  id: string;
  orderReference: string;
  driverName: string | null;
  orderStatus: string | null;
  vehicleModel: string | null;
  ridePrice: string | null;
  payoutAmount?: string | null;
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
  filteredTotal?: string;
}

const PAGE_SIZE = 50;

export default function BoltOrdersPage() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const { workspaceId } = useWorkspaceContext();
  const [role, setRole] = useState<Role | null>(null);
  const [rows, setRows] = useState<BoltOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState('0');
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const canManage = role ? hasMinRole(role, 'superadmin') : false;

  const load = useCallback(
    async (
      search: string,
      pageIndex: number,
      from: string,
      to: string
    ) => {
      if (!workspaceId) return;
      const base = withSearchQuery(withWorkspaceQuery(API_PATHS.bolt.orders, workspaceId), search);
      const params = new URLSearchParams();
      params.set('page', String(pageIndex));
      params.set('limit', String(PAGE_SIZE));
      if (from) params.set('startDate', from);
      if (to) params.set('endDate', to);
      const url = `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`;
      const res = await apiFetch<OrdersResponse>(url, {}, getStoredToken());
      if (res.data) {
        setRows(res.data.items);
        setTotal(res.data.total);
        setPage(res.data.page);
        setFilteredTotal(res.data.filteredTotal ?? '0');
      } else if (res.error) {
        setError(res.error);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.role) setRole(res.data.role);
    });
  }, []);

  useEffect(() => {
    setPage(0);
    setAppliedQ('');
    setQ('');
    setStartDate('');
    setEndDate('');
    setAppliedStartDate('');
    setAppliedEndDate('');
    setSelectedIds(new Set());
  }, [workspaceId]);

  useEffect(() => {
    void load(appliedQ, page, appliedStartDate, appliedEndDate);
  }, [workspaceId, page, appliedQ, appliedStartDate, appliedEndDate, load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, appliedQ, appliedStartDate, appliedEndDate]);

  const selectableIds = useMemo(
    () => (canManage ? rows.filter((row) => !row.isPaid).map((row) => row.id) : []),
    [canManage, rows]
  );
  const selectedCount = selectedIds.size;
  const pageAllSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleRowSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (pageAllSelected) {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function onFilter(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(q.trim());
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setPage(0);
  }

  function onClear() {
    setQ('');
    setAppliedQ('');
    setStartDate('');
    setEndDate('');
    setAppliedStartDate('');
    setAppliedEndDate('');
    setPage(0);
  }

  async function markPaid(id: string) {
    if (!workspaceId) return;
    setBusyId(id);
    setError('');
    setSuccess('');
    const res = await apiFetch(
      API_PATHS.bolt.orderPaid(id),
      { method: 'PATCH', body: JSON.stringify({ workspaceId }) },
      getStoredToken()
    );
    setBusyId(null);
    if (!res.success) {
      setError(res.error ?? 'Falha ao marcar como pago');
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await load(appliedQ, page, appliedStartDate, appliedEndDate);
  }

  async function bulkMarkPaid() {
    if (!canManage || !workspaceId || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).slice(0, 100);
    const ok = await confirm({
      title: 'Marcar como pago',
      message: `Marcar ${ids.length} pedido(s) como pago(s)?`,
      confirmLabel: 'Marcar como pago',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setBulkBusy(true);
    setError('');
    setSuccess('');
    const res = await apiFetch<{ updated: number; requested: number }>(
      API_PATHS.bolt.ordersBulkMarkPaid,
      { method: 'POST', body: JSON.stringify({ workspaceId, ids }) },
      getStoredToken()
    );
    setBulkBusy(false);
    if (!res.success) {
      setError(res.error ?? 'Falha ao marcar como pago');
      return;
    }
    setSuccess(`${res.data?.updated ?? 0} pedido(s) marcado(s) como pago(s)`);
    setSelectedIds(new Set());
    await load(appliedQ, page, appliedStartDate, appliedEndDate);
  }

  return (
    <div className="space-y-6">
      {confirmDialog}
      <p className="text-sm text-slate-500">
        Corridas com valor a pagar. Coluna «Preço» ={' '}
        <strong>líquido</strong> Fleet (<code className="text-xs">net_earnings + tip + portagem</code>
        ) — o que o motorista recebe, não o bruto da corrida.
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
        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">Data início</label>
          <input
            type="date"
            className="input w-full"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">Data fim</label>
          <input
            type="date"
            className="input w-full"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary">
          Filtrar
        </button>
        <button type="button" className="btn-secondary" onClick={onClear}>
          Limpar
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-sm text-slate-600">
          {appliedQ || appliedStartDate || appliedEndDate ? (
            <>
              Filtro activo · <span className="font-medium text-slate-800">{total}</span> registo(s)
            </>
          ) : (
            <>
              Todos os registos · <span className="font-medium text-slate-800">{total}</span>
            </>
          )}
        </p>
        <p className="text-sm font-semibold text-emerald-800">
          Montante líquido:{' '}
          {Number(filteredTotal).toLocaleString('pt-PT', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{' '}
          €
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      {canManage && selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-sm font-medium text-slate-700">{selectedCount} seleccionada(s)</p>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 text-xs"
            disabled={bulkBusy}
            onClick={() => void bulkMarkPaid()}
          >
            <Check size={13} />
            Marcar como pago
          </button>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-700"
            disabled={bulkBusy}
            onClick={() => setSelectedIds(new Set())}
          >
            Limpar selecção
          </button>
        </div>
      ) : null}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              {canManage ? (
                <th className="w-10 px-6 py-3">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    onChange={toggleSelectAllVisible}
                    disabled={selectableIds.length === 0 || bulkBusy}
                    aria-label="Seleccionar pedidos pendentes visíveis"
                  />
                </th>
              ) : null}
              <th className="px-6 py-3">Empresa</th>
              <th className="px-6 py-3">Motorista</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Veículo</th>
              <th className="px-6 py-3">Preço</th>
              <th className="px-6 py-3">Pago</th>
              <th className="px-6 py-3">Data</th>
              <th className="px-6 py-3">Paradas</th>
              {canManage ? <th className="px-6 py-3">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-t ${row.isPaid ? 'bg-emerald-50/60' : 'bg-red-50/40'}`}
              >
                {canManage ? (
                  <td className="px-6 py-3">
                    {!row.isPaid ? (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleRowSelection(row.id)}
                        disabled={bulkBusy}
                        aria-label={`Seleccionar pedido ${row.orderReference}`}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                ) : null}
                <td className="px-6 py-3">{row.boltCompanyId ?? '—'}</td>
                <td className="px-6 py-3">{row.driverName ?? '—'}</td>
                <td className="px-6 py-3">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                    {row.orderStatus ?? '—'}
                  </span>
                </td>
                <td className="px-6 py-3">{row.vehicleModel ?? '—'}</td>
                <td className="px-6 py-3">
                  {(() => {
                    const v = row.payoutAmount ?? row.ridePrice;
                    return v ? `${Number(v).toFixed(2)}€` : '—';
                  })()}
                </td>
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
                {canManage ? (
                  <td className="px-6 py-3">
                    {!row.isPaid ? (
                      <button
                        type="button"
                        className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
                        title="Marcar como pago"
                        disabled={busyId === row.id || bulkBusy}
                        onClick={() => void markPaid(row.id)}
                      >
                        <Check size={16} />
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={canManage ? 10 : 8} className="px-6 py-8 text-center text-slate-400">
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
