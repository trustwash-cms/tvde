'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Trash2, Upload, X } from 'lucide-react';
import {
  VIA_VERDE_PAGE_SIZE,
  currentMonthKey,
  hasMinRole,
  type Role,
  type ViaVerdeDashboardStats,
  type ViaVerdeImportResult,
  type ViaVerdeMovementItem,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { MonthTotalCard } from '@/components/month-total-card';
import { PortalConnectionPanel } from '@/components/portal/portal-connection-panel';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

function formatMoney(value: string | number) {
  const n = Number(value);
  if (Number.isNaN(n)) return '0,00 €';
  return `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-PT');
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pt-PT');
}

export function ViaVerdePanel() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [role, setRole] = useState<Role | null>(null);
  const [dashboard, setDashboard] = useState<ViaVerdeDashboardStats | null>(null);
  const [items, setItems] = useState<ViaVerdeMovementItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filteredTotal, setFilteredTotal] = useState('0');
  const [filteredCount, setFilteredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [importResult, setImportResult] = useState<ViaVerdeImportResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [licensePlate, setLicensePlate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [applied, setApplied] = useState({ licensePlate: '', startDate: '', endDate: '' });
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);

  const canManage = role ? hasMinRole(role, 'superadmin') : false;
  const hasFilters = Boolean(
    applied.licensePlate.trim() || applied.startDate || applied.endDate
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const params = new URLSearchParams();
    if (applied.licensePlate.trim()) params.set('licensePlate', applied.licensePlate.trim());
    if (applied.startDate) params.set('startDate', applied.startDate);
    if (applied.endDate) params.set('endDate', applied.endDate);
    params.set('page', String(page));
    params.set('pageSize', String(VIA_VERDE_PAGE_SIZE));

    const dashParams = new URLSearchParams({ month: selectedMonth });

    const [dashRes, listRes] = await Promise.all([
      apiFetch<ViaVerdeDashboardStats>(
        `${API_PATHS.viaVerde.dashboard}?${dashParams.toString()}`,
        {},
        token
      ),
      apiFetch<{
        items: ViaVerdeMovementItem[];
        totalPages: number;
        filteredTotal?: string;
        filteredCount?: number;
      }>(`${API_PATHS.viaVerde.movements}?${params.toString()}`, {}, token),
    ]);

    setLoading(false);
    if (!dashRes.success) {
      setError(dashRes.error ?? 'Falha ao carregar resumo');
      return;
    }
    if (!listRes.success) {
      setError(listRes.error ?? 'Falha ao carregar movimentos');
      return;
    }

    setDashboard(dashRes.data ?? null);
    setItems(listRes.data?.items ?? []);
    setTotalPages(listRes.data?.totalPages ?? 1);
    setFilteredTotal(listRes.data?.filteredTotal ?? '0');
    setFilteredCount(listRes.data?.filteredCount ?? 0);
  }, [applied, page, selectedMonth]);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.role) setRole(res.data.role);
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, applied]);

  const selectableIds = useMemo(
    () => (canManage ? items.filter((item) => !item.isPaid).map((item) => item.id) : []),
    [canManage, items]
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

  function applyFilters() {
    setPage(1);
    setApplied({
      licensePlate: licensePlate.trim().toUpperCase(),
      startDate,
      endDate,
    });
  }

  function clearFilters() {
    setLicensePlate('');
    setStartDate('');
    setEndDate('');
    setPage(1);
    setApplied({ licensePlate: '', startDate: '', endDate: '' });
  }

  async function handleImport(file: File) {
    setError('');
    setImportResult(null);
    const formData = new FormData();
    formData.append('file', file);

    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.viaVerde.import}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const raw = await res.json();
    if (!res.ok || !raw.success) {
      setError(getApiErrorMessage(raw));
      return;
    }

    setImportResult(raw.data as ViaVerdeImportResult);
    setPage(1);
    await loadData();
  }

  async function markPaid(id: string, isPaid: boolean) {
    setBusyId(id);
    setError('');
    setSuccess('');
    const res = await apiFetch<ViaVerdeMovementItem>(
      API_PATHS.viaVerde.movementPaid(id),
      {
        method: 'PATCH',
        body: JSON.stringify({ isPaid }),
      },
      getStoredToken()
    );
    setBusyId(null);
    if (!res.success) {
      setError(res.error ?? (isPaid ? 'Falha ao marcar como pago' : 'Falha ao desmarcar'));
      return;
    }
    if (isPaid) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    await loadData();
  }

  async function bulkMarkPaid() {
    if (!canManage || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).slice(0, 100);
    const ok = await confirm({
      title: 'Marcar como pago',
      message: `Marcar ${ids.length} movimento(s) como pago(s)?`,
      confirmLabel: 'Marcar como pago',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setBulkBusy(true);
    setError('');
    setSuccess('');
    const res = await apiFetch<{ updated: number; requested: number }>(
      API_PATHS.viaVerde.movementsBulkMarkPaid,
      { method: 'POST', body: JSON.stringify({ ids }) },
      getStoredToken()
    );
    setBulkBusy(false);
    if (!res.success) {
      setError(res.error ?? 'Falha ao marcar como pago');
      return;
    }
    setSuccess(`${res.data?.updated ?? 0} movimento(s) marcado(s) como pago(s)`);
    setSelectedIds(new Set());
    await loadData();
  }

  async function removeMovement(id: string) {
    const ok = await confirm({
      title: 'Eliminar movimento',
      message: 'Eliminar este movimento Via Verde? Esta acção não pode ser anulada.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(id);
    const res = await apiFetch(
      API_PATHS.viaVerde.movementById(id),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusyId(null);
    if (!res.success) {
      setError(res.error ?? 'Falha ao eliminar');
      return;
    }
    await loadData();
  }

  const unpaidTotal = Number(dashboard?.unpaidTotal ?? 0);
  const hasPending = (dashboard?.unpaidCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      {confirmDialog}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={`card ${hasPending ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <p className="text-sm text-slate-600">Total pendente</p>
          <p className={`text-2xl font-bold ${hasPending ? 'text-red-700' : 'text-emerald-700'}`}>
            {formatMoney(unpaidTotal)}
          </p>
          <p className="text-xs text-slate-500">{dashboard?.unpaidCount ?? 0} movimento(s) não pago(s)</p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-500">Movimentos (total)</p>
          <p className="text-2xl font-bold text-slate-900">{dashboard?.totalMovements ?? 0}</p>
        </div>
        <MonthTotalCard
          selectId="via-verde-month-total"
          value={formatMoney(dashboard?.monthTotal ?? 0)}
          monthKey={selectedMonth}
          onMonthChange={setSelectedMonth}
        />
        {canManage ? (
          <div className="card flex flex-col justify-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.txt,.xls,.xlsx"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImport(file);
                if (inputRef.current) inputRef.current.value = '';
              }}
            />
            <button
              type="button"
              className="btn-secondary inline-flex items-center justify-center gap-2"
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={16} />
              Importar XLS/XLSX
            </button>
            {importResult ? (
              <p className="text-xs text-slate-500">
                Inseridos: {importResult.inserted} · Ignorados: {importResult.skipped}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <PortalConnectionPanel
          portal="via_verde"
          onStatusChange={() => {
            void loadData();
          }}
        />      ) : null}

      <div className="card space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block text-sm">
            <span className="text-slate-500">Matrícula</span>
            <input
              className="input mt-1 w-full"
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyFilters();
                }
              }}
              placeholder="AA-00-BB"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">Data início</span>
            <input
              type="date"
              className="input mt-1 w-full"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">Data fim</span>
            <input
              type="date"
              className="input mt-1 w-full"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
            <button type="button" className="btn-primary flex-1" onClick={applyFilters}>
              Filtrar
            </button>
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={clearFilters}
              disabled={!hasFilters && !licensePlate && !startDate && !endDate}
            >
              Limpar
            </button>
          </div>
        </div>

        {hasFilters ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <p className="text-slate-600">
              {applied.licensePlate ? (
                <>
                  Matrícula <span className="font-medium text-slate-900">{applied.licensePlate}</span>
                  {applied.startDate || applied.endDate ? ' · ' : null}
                </>
              ) : null}
              {applied.startDate || applied.endDate ? (
                <>
                  Intervalo{' '}
                  <span className="font-medium text-slate-900">
                    {applied.startDate
                      ? new Date(`${applied.startDate}T12:00:00`).toLocaleDateString('pt-PT')
                      : '…'}
                    {' — '}
                    {applied.endDate
                      ? new Date(`${applied.endDate}T12:00:00`).toLocaleDateString('pt-PT')
                      : '…'}
                  </span>
                </>
              ) : null}
              <span className="text-slate-400"> · {filteredCount} movimento(s)</span>
            </p>
            <p className="text-base font-semibold text-slate-900">
              Total: {formatMoney(filteredTotal)}
            </p>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

        {canManage && selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-sm font-medium text-slate-700">{selectedCount} seleccionada(s)</p>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
              disabled={bulkBusy || loading}
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

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                {canManage ? (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={pageAllSelected}
                      onChange={toggleSelectAllVisible}
                      disabled={selectableIds.length === 0 || bulkBusy}
                      aria-label="Seleccionar movimentos pendentes visíveis"
                    />
                  </th>
                ) : null}
                <th className="px-4 py-3">Matrícula</th>
                <th className="px-4 py-3">Data entrada</th>
                <th className="px-4 py-3">Data cobrança</th>
                <th className="px-4 py-3">Entrada</th>
                <th className="px-4 py-3">Saída</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Pago</th>
                {canManage ? <th className="px-4 py-3">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={`border-t ${item.isPaid ? 'bg-emerald-50/60' : 'bg-red-50/60'}`}
                >
                  {canManage ? (
                    <td className="px-4 py-3">
                      {!item.isPaid ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleRowSelection(item.id)}
                          disabled={bulkBusy}
                          aria-label={`Seleccionar movimento ${item.licensePlate}`}
                        />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  ) : null}
                  <td className="px-4 py-3 font-medium">{item.licensePlate}</td>
                  <td className="px-4 py-3">{formatDateTime(item.entryDate)}</td>
                  <td className="px-4 py-3">{formatDate(item.systemEntryDate)}</td>
                  <td className="px-4 py-3">{item.entryPoint ?? '—'}</td>
                  <td className="px-4 py-3">{item.exitPoint ?? '—'}</td>
                  <td className="px-4 py-3">{formatMoney(item.value)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.isPaid
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {item.isPaid ? 'Sim' : 'Não'}
                    </span>
                  </td>
                  {canManage ? (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {!item.isPaid ? (
                          <button
                            type="button"
                            className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
                            title="Marcar como pago"
                            disabled={busyId === item.id || bulkBusy}
                            onClick={() => void markPaid(item.id, true)}
                          >
                            <Check size={16} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rounded p-1 text-slate-600 hover:bg-slate-100"
                            title="Desmarcar pago"
                            disabled={busyId === item.id || bulkBusy}
                            onClick={() => void markPaid(item.id, false)}
                          >
                            <X size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded p-1 text-red-700 hover:bg-red-100"
                          title="Eliminar"
                          disabled={busyId === item.id || bulkBusy}
                          onClick={() => void removeMovement(item.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!loading && !items.length ? (
                <tr>
                  <td colSpan={canManage ? 9 : 7} className="px-4 py-8 text-center text-slate-400">
                    Sem movimentos — importe um ficheiro CSV Via Verde.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-slate-500">
            Página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Seguinte
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
