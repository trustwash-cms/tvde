'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';

type MapRow = {
  id: string;
  whmcsInvoiceId: number;
  whmcsInvoiceNum: string | null;
  status: string;
  amountTotal: string | number | null;
  paidAt: string | null;
  lastError: string | null;
  processedAt: string | null;
  billingInvoice: {
    id: string;
    number: string;
    status: string;
    total: string | number;
    externalId: string | null;
  } | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  processing: 'A processar',
  issued: 'Emitida Moloni',
  failed: 'Falhou',
  skipped: 'Ignorada',
};

export function WhmcsInvoicesPanel() {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [rows, setRows] = useState<MapRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    if (!workspaceId) return;
    const q = withWorkspaceQuery(API_PATHS.whmcs.invoices, workspaceId);
    const url = statusFilter ? `${q}${q.includes('?') ? '&' : '?'}status=${encodeURIComponent(statusFilter)}` : q;
    apiFetch<{ rows: MapRow[]; total: number }>(url, {}, getStoredToken()).then((res) => {
      if (!res.success) {
        setError(getApiErrorMessage(res));
        return;
      }
      setRows(res.data?.rows ?? []);
      setTotal(res.data?.total ?? 0);
    });
  }

  useEffect(() => {
    load();
  }, [workspaceId, statusFilter]);

  async function reprocess(id: string) {
    if (!workspaceId) return;
    setBusyId(id);
    setError('');
    const res = await apiFetch(
      API_PATHS.whmcs.reprocess(id),
      { method: 'POST', body: JSON.stringify({ workspaceId }) },
      getStoredToken()
    );
    setBusyId(null);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      load();
      return;
    }
    setSuccess('Fatura reprocessada');
    load();
  }

  async function syncNow() {
    if (!workspaceId) return;
    setBusyId('sync');
    setError('');
    const res = await apiFetch(
      API_PATHS.whmcs.syncPaid,
      { method: 'POST', body: JSON.stringify({ workspaceId }) },
      getStoredToken()
    );
    setBusyId(null);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    setSuccess('Sincronização concluída');
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--brand-ink)]">Mapa Moloni</h2>
          <p className="text-sm text-[var(--brand-muted)]">
            Faturas pagas sincronizadas → Moloni. Desactive o plugin Moloni no WHMCS para evitar duplicados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={WEB_ROUTES.dashboard.settings.whmcs} className="btn-secondary text-sm">
            Configurações
          </Link>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busyId === 'sync' || !workspaceId}
            onClick={() => void syncNow()}
          >
            {busyId === 'sync' ? 'A sincronizar…' : 'Sincronizar agora'}
          </button>
        </div>
      </div>

      <WorkspaceSelector
        workspaces={workspaces}
        workspaceId={workspaceId}
        onChange={setWorkspaceId}
      />

      <div className="flex flex-wrap gap-2">
        {['', 'issued', 'failed', 'pending', 'processing'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            className={statusFilter === s ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
            onClick={() => setStatusFilter(s)}
          >
            {s ? STATUS_LABEL[s] ?? s : 'Todas'}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--brand-border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--brand-surface-2)] text-[var(--brand-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">WHMCS #</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Paga em</th>
              <th className="px-3 py-2 font-medium">Moloni</th>
              <th className="px-3 py-2 font-medium">Erro</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[var(--brand-muted)]">
                  Sem registos — configure WHMCS e sincronize faturas pagas.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--brand-border)]">
                  <td className="px-3 py-2">
                    {row.whmcsInvoiceNum || row.whmcsInvoiceId}
                    <span className="block text-xs text-[var(--brand-muted)]">id {row.whmcsInvoiceId}</span>
                  </td>
                  <td className="px-3 py-2">{STATUS_LABEL[row.status] ?? row.status}</td>
                  <td className="px-3 py-2">
                    {row.amountTotal != null ? `${Number(row.amountTotal).toFixed(2)} €` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {row.paidAt ? new Date(row.paidAt).toLocaleString('pt-PT') : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {row.billingInvoice ? (
                      <Link
                        href={`${WEB_ROUTES.dashboard.billing.faturasRecibo}?q=${encodeURIComponent(row.billingInvoice.number)}`}
                        className="text-[var(--brand-accent)] underline"
                      >
                        {row.billingInvoice.number}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-xs text-red-700" title={row.lastError ?? ''}>
                    {row.lastError || '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(row.status === 'failed' || row.status === 'pending') && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={busyId === row.id}
                        onClick={() => void reprocess(row.id)}
                      >
                        {busyId === row.id ? '…' : 'Reprocessar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--brand-muted)]">{total} registo(s)</p>
    </div>
  );
}
