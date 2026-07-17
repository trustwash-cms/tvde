'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { currentMonthKey, hasMinRole, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { MonthTotalCard } from '@/components/month-total-card';
import { PortalConnectionPanel } from '@/components/portal/portal-connection-panel';

interface Dashboard {
  totalPayments: number;
  monthTotal: string;
}

interface Item {
  id: string;
  driverUuid: string;
  firstName: string | null;
  lastName: string | null;
  reportDate: string;
  amount: string;
  description: string | null;
}

function formatMoney(value: string | number) {
  const n = Number(value);
  if (Number.isNaN(n)) return '0,00 €';
  return `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function UberPanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [error, setError] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canManage = role ? hasMinRole(role, 'superadmin') : false;

  const load = useCallback(async () => {
    const token = getStoredToken();
    const [dash, list] = await Promise.all([
      apiFetch<Dashboard>(`${API_PATHS.uber.dashboard}?month=${selectedMonth}`, {}, token),
      apiFetch<{ items: Item[] }>(API_PATHS.uber.payments, {}, token),
    ]);
    if (dash.data) setDashboard(dash.data);
    if (list.data) setItems(list.data.items);
    if (!dash.success) setError(dash.error ?? 'Erro');
  }, [selectedMonth]);

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
    const res = await fetch(`${getApiUrl()}${API_PATHS.uber.import}`, {
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
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="card">
          <p className="text-sm text-slate-500">Pagamentos (total)</p>
          <p className="text-2xl font-bold">{dashboard?.totalPayments ?? 0}</p>
        </div>
        <MonthTotalCard
          selectId="uber-month"
          label="Valor do mês (Pago a si)"
          value={formatMoney(dashboard?.monthTotal ?? 0)}
          monthKey={selectedMonth}
          onMonthChange={setSelectedMonth}
        />
        {canManage ? (
          <div className="card flex flex-col justify-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f);
              }}
            />
            <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2" onClick={() => inputRef.current?.click()}>
              <Upload size={16} /> Importar CSV Uber
            </button>
            {importMsg ? <p className="text-xs text-slate-500">{importMsg}</p> : null}
          </div>
        ) : null}
      </div>

      {canManage ? (
        <PortalConnectionPanel
          portal="uber"
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
              <th className="px-4 py-3">UUID</th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Apelido</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Descrição</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-4 py-3">{new Date(item.reportDate).toLocaleString('pt-PT')}</td>
                <td className="px-4 py-3 font-mono text-xs">{item.driverUuid.slice(0, 8)}…</td>
                <td className="px-4 py-3">{item.firstName ?? '—'}</td>
                <td className="px-4 py-3">{item.lastName ?? '—'}</td>
                <td className="px-4 py-3">{formatMoney(item.amount)}</td>
                <td className="px-4 py-3">{item.description ?? '—'}</td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Sem pagamentos — importe CSV (UUID, Nome, Apelido, Data, Valor) ou sincronize a conta Uber.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
