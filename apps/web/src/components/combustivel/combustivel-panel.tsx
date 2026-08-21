'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Trash2, Upload } from 'lucide-react';
import {
  COMBUSTIVEL_PAGE_SIZE,
  currentMonthKey,
  getCurrentWeek,
  hasMinRole,
  isDriverRole,
  shiftWeek,
  type Role,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { MonthTotalCard } from '@/components/month-total-card';
import { WeekTotalCard } from '@/components/week-total-card';
import { PortalConnectionPanel } from '@/components/portal/portal-connection-panel';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface Dashboard {
  totalTransactions: number;
  unpaidCount: number;
  unpaidTotal: string;
  monthTotal: string;
  weekNumber?: number;
  weekYear?: number;
  weekTotal?: string;
  weekStart?: string;
  weekEnd?: string;
}

interface Item {
  id: string;
  chargeDate: string;
  station: string | null;
  cardNumber: string | null;
  fuelType: string | null;
  liters: string | null;
  totalWithVat: string;
  isPaid: boolean;
}

function formatMoney(value: string | number) {
  const n = Number(value);
  if (Number.isNaN(n)) return '0,00 €';
  return `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** dd/mm/aaaa, HH:mm (sem segundos) */
function formatDateTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CombustivelPanel() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [role, setRole] = useState<Role | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeek);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canManage = role ? hasMinRole(role, 'superadmin') : false;
  const driverMode = role != null && isDriverRole(role);

  const load = useCallback(async () => {
    const token = getStoredToken();
    const dashQs = new URLSearchParams({ month: selectedMonth });
    if (driverMode) {
      dashQs.set('weekYear', String(selectedWeek.year));
      dashQs.set('week', String(selectedWeek.week));
    }
    const [dash, list] = await Promise.all([
      apiFetch<Dashboard>(`${API_PATHS.combustivel.dashboard}?${dashQs.toString()}`, {}, token),
      apiFetch<{ items: Item[]; total: number; totalPages: number }>(
        `${API_PATHS.combustivel.transactions}?page=${page}`,
        {},
        token
      ),
    ]);
    if (dash.data) setDashboard(dash.data);
    if (list.data) {
      setItems(list.data.items);
      setTotal(list.data.total ?? list.data.items.length);
      setTotalPages(list.data.totalPages ?? 1);
    }
    if (!dash.success) setError(dash.error ?? 'Erro');
    else if (!list.success) setError(list.error ?? 'Erro');
  }, [selectedMonth, page, driverMode, selectedWeek]);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.role) setRole(res.data.role);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page]);

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

  async function handleImport(file: File) {
    setError('');
    setSuccess('');
    const form = new FormData();
    form.append('file', file);
    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.combustivel.import}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const raw = await res.json();
    if (!res.ok || !raw.success) {
      setError(getApiErrorMessage(raw));
      return;
    }
    setImportMsg(`Inseridos: ${raw.data.inserted} · Ignorados: ${raw.data.skipped}`);
    setPage(1);
    await load();
  }

  async function markPaid(id: string) {
    setBusyId(id);
    setError('');
    setSuccess('');
    const res = await apiFetch<Item>(
      API_PATHS.combustivel.transactionPaid(id),
      { method: 'PATCH' },
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
    await load();
  }

  async function bulkMarkPaid() {
    if (!canManage || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).slice(0, 100);
    const ok = await confirm({
      title: 'Marcar como pago',
      message: `Marcar ${ids.length} abastecimento(s) como pago(s)?`,
      confirmLabel: 'Marcar como pago',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setBulkBusy(true);
    setError('');
    setSuccess('');
    const res = await apiFetch<{ updated: number; requested: number }>(
      API_PATHS.combustivel.transactionsBulkMarkPaid,
      { method: 'POST', body: JSON.stringify({ ids }) },
      getStoredToken()
    );
    setBulkBusy(false);
    if (!res.success) {
      setError(res.error ?? 'Falha ao marcar como pago');
      return;
    }
    setSuccess(`${res.data?.updated ?? 0} abastecimento(s) marcado(s) como pago(s)`);
    setSelectedIds(new Set());
    await load();
  }

  async function removeTransaction(id: string) {
    const ok = await confirm({
      title: 'Eliminar abastecimento',
      message: 'Eliminar este abastecimento de combustível? Esta acção não pode ser anulada.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(id);
    setError('');
    const res = await apiFetch(
      API_PATHS.combustivel.transactionById(id),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusyId(null);
    if (!res.success) {
      setError(res.error ?? 'Falha ao eliminar');
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await load();
  }

  const hasPending = (dashboard?.unpaidCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      {confirmDialog}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={`card ${hasPending ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <p className="text-sm text-slate-600">Total pendente</p>
          <p className={`text-2xl font-bold ${hasPending ? 'text-red-700' : 'text-emerald-700'}`}>
            {formatMoney(dashboard?.unpaidTotal ?? 0)}
          </p>
          <p className="text-xs text-slate-500">{dashboard?.unpaidCount ?? 0} abastecimento(s) não pago(s)</p>
        </div>
        {driverMode ? (
          <WeekTotalCard
            weekNumber={dashboard?.weekNumber ?? selectedWeek.week}
            weekYear={dashboard?.weekYear ?? selectedWeek.year}
            value={formatMoney(dashboard?.weekTotal ?? 0)}
            weekStart={dashboard?.weekStart}
            weekEnd={dashboard?.weekEnd}
            onPrevWeek={() => setSelectedWeek((w) => shiftWeek(w.year, w.week, -1))}
            onNextWeek={() => setSelectedWeek((w) => shiftWeek(w.year, w.week, 1))}
          />
        ) : (
          <div className="card">
            <p className="text-sm text-slate-500">Abastecimentos</p>
            <p className="text-2xl font-bold text-slate-900">{dashboard?.totalTransactions ?? 0}</p>
          </div>
        )}
        <MonthTotalCard
          selectId="combustivel-month"
          value={formatMoney(dashboard?.monthTotal ?? 0)}
          monthKey={selectedMonth}
          onMonthChange={(m) => {
            setSelectedMonth(m);
            setPage(1);
          }}
        />
        {canManage ? (
          <div className="card flex flex-col justify-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".xls,.xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f);
                if (inputRef.current) inputRef.current.value = '';
              }}
            />
            <button
              type="button"
              className="btn-secondary inline-flex items-center justify-center gap-2"
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={16} /> Importar XLSX PRIO
            </button>
            {importMsg ? <p className="text-xs text-slate-500">{importMsg}</p> : null}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <PortalConnectionPanel
          portal="myprio"
          syncScope="fleet"
          onStatusChange={() => {
            void load();
          }}
        />
      ) : null}
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

      <div className="card overflow-x-auto p-0">
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
                    aria-label="Seleccionar abastecimentos pendentes visíveis"
                  />
                </th>
              ) : null}
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Posto</th>
              <th className="px-4 py-3">Cartão</th>
              <th className="px-4 py-3">Combustível</th>
              <th className="px-4 py-3">Litros</th>
              <th className="px-4 py-3">Total</th>
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
                        aria-label={`Seleccionar abastecimento ${item.cardNumber ?? item.id}`}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                ) : null}
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(item.chargeDate)}</td>
                <td className="px-4 py-3">{item.station ?? '—'}</td>
                <td className="px-4 py-3">{item.cardNumber ?? '—'}</td>
                <td className="px-4 py-3">{item.fuelType ?? '—'}</td>
                <td className="px-4 py-3">{item.liters ?? '—'}</td>
                <td className="px-4 py-3">{formatMoney(item.totalWithVat)}</td>
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
                          onClick={() => void markPaid(item.id)}
                        >
                          <Check size={16} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded p-1 text-red-700 hover:bg-red-100"
                        title="Eliminar"
                        disabled={busyId === item.id || bulkBusy}
                        onClick={() => void removeTransaction(item.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={canManage ? 9 : 7} className="px-4 py-8 text-center text-slate-400">
                  Sem abastecimentos — importe XLSX frota PRIO ou sincronize a conta MyPRIO.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-sm text-slate-500">
            Página {page} de {totalPages}
            {total ? ` · ${total} registo(s)` : ''} · {COMBUSTIVEL_PAGE_SIZE}/página
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              «
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={page >= totalPages}
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
