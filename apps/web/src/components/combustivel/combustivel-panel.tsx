'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Trash2, Upload } from 'lucide-react';
import { COMBUSTIVEL_PAGE_SIZE, currentMonthKey, hasMinRole, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { MonthTotalCard } from '@/components/month-total-card';
import { PortalConnectionPanel } from '@/components/portal/portal-connection-panel';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface Dashboard {
  totalTransactions: number;
  unpaidCount: number;
  unpaidTotal: string;
  monthTotal: string;
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
  const [error, setError] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canManage = role ? hasMinRole(role, 'superadmin') : false;

  const load = useCallback(async () => {
    const token = getStoredToken();
    const [dash, list] = await Promise.all([
      apiFetch<Dashboard>(`${API_PATHS.combustivel.dashboard}?month=${selectedMonth}`, {}, token),
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
  }, [selectedMonth, page]);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.role) setRole(res.data.role);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleImport(file: File) {
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
        <div className="card">
          <p className="text-sm text-slate-500">Abastecimentos</p>
          <p className="text-2xl font-bold text-slate-900">{dashboard?.totalTransactions ?? 0}</p>
        </div>
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

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
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
                          disabled={busyId === item.id}
                          onClick={() => void markPaid(item.id)}
                        >
                          <Check size={16} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded p-1 text-red-700 hover:bg-red-100"
                        title="Eliminar"
                        disabled={busyId === item.id}
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
                <td colSpan={canManage ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
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
