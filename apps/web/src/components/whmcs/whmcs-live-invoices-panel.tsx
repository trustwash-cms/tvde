'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import {
  OpenInWhmcsLink,
  WhmcsConnectionBanner,
  WhmcsPagination,
} from '@/components/whmcs/whmcs-ui';

type InvoiceRow = {
  id: number;
  invoicenum: string;
  userid: number;
  clientName?: string;
  date: string;
  duedate: string;
  datepaid: string;
  status: string;
  total: string;
  paymentmethod?: string;
  openInWhmcs: string;
};

type BulkResult = {
  succeeded: number;
  failed: number;
  total: number;
  results: Array<{ invoiceId: number; ok: boolean; error?: string }>;
};

const LIMIT = 50;

export function WhmcsLiveInvoicesPanel() {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('All');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState('');

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    setHint('');
    let q = withWorkspaceQuery(API_PATHS.whmcs.invoicesLive, workspaceId);
    q += `${q.includes('?') ? '&' : '?'}limit=${LIMIT}&offset=${offset}`;
    if (status && status !== 'All') q += `&status=${encodeURIComponent(status)}`;

    apiFetch<{ rows: InvoiceRow[]; total: number }>(q, {}, getStoredToken()).then((res) => {
      setLoading(false);
      if (!res.success) {
        setError(getApiErrorMessage(res));
        const d = res.data as { hint?: string } | undefined;
        setHint(d?.hint ?? (res as { hint?: string }).hint ?? '');
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(res.data?.rows ?? []);
      setTotal(res.data?.total ?? 0);
      setSelected(new Set());
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, status, offset]);

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(rows.map((r) => r.id)));
  }

  function toggleOne(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function runBulk(action: 'mark-paid' | 'mark-unpaid' | 'cancel' | 'delete') {
    if (!workspaceId || selected.size === 0) return;
    const labels: Record<typeof action, string> = {
      'mark-paid': 'marcar como pagas',
      'mark-unpaid': 'marcar como não pagas',
      cancel: 'cancelar',
      delete: 'apagar (ou cancelar se DeleteInvoice indisponível)',
    };
    if (!window.confirm(`${labels[action]} ${selected.size} fatura(s)?`)) return;
    setBusy(action);
    setError('');
    setSuccess('');
    const res = await apiFetch<BulkResult>(
      API_PATHS.whmcs.invoicesLiveBulk,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          action,
          invoiceIds: Array.from(selected),
          sendEmail: true,
        }),
      },
      getStoredToken()
    );
    setBusy('');
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    const d = res.data;
    setSuccess(
      d
        ? `${res.message || 'OK'} — sucesso ${d.succeeded}, falhas ${d.failed}`
        : res.message || 'OK'
    );
    load();
  }

  async function deleteOne(id: number) {
    if (!workspaceId) return;
    if (!window.confirm(`Apagar fatura #${id} no WHMCS?`)) return;
    setBusy(`del-${id}`);
    setError('');
    setSuccess('');
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.whmcs.invoiceLiveById(id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy('');
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    setSuccess(res.message || 'Apagada');
    load();
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Faturas WHMCS</h2>
          <p className="text-sm text-slate-500">
            Ver, editar e apagar faturas (live). Emissão Moloni: secção Mapa Moloni.
          </p>
        </div>
        {!wsLoading && workspaces.length > 1 ? (
          <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
        ) : null}
      </div>

      <WhmcsConnectionBanner error={error} hint={hint} />
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600 w-fit">
          Estado
          <select
            className="input"
            value={status}
            onChange={(e) => {
              setOffset(0);
              setStatus(e.target.value);
            }}
          >
            <option value="All">Todos</option>
            <option value="Paid">Paid</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Refunded">Refunded</option>
            <option value="Draft">Draft</option>
          </select>
        </label>

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs text-slate-600">{selected.size} seleccionada(s)</span>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={Boolean(busy)}
              onClick={() => void runBulk('mark-paid')}
            >
              {busy === 'mark-paid' ? '…' : 'Marcar paga'}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={Boolean(busy)}
              onClick={() => void runBulk('mark-unpaid')}
            >
              {busy === 'mark-unpaid' ? '…' : 'Marcar não paga'}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs text-amber-800"
              disabled={Boolean(busy)}
              onClick={() => void runBulk('cancel')}
            >
              {busy === 'cancel' ? '…' : 'Cancelar'}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs text-red-700"
              disabled={Boolean(busy)}
              onClick={() => void runBulk('delete')}
            >
              {busy === 'delete' ? '…' : 'Apagar'}
            </button>
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="Seleccionar todas"
                />
              </th>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Vencimento</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acções</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={(e) => toggleOne(row.id, e.target.checked)}
                    aria-label={`Seleccionar fatura ${row.id}`}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.invoicenum || row.id}</td>
                <td className="px-3 py-2">
                  <Link
                    href={WEB_ROUTES.dashboard.whmcs.cliente(row.userid)}
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    {row.clientName || `#${row.userid}`}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.date || '—'}</td>
                <td className="px-3 py-2">{row.duedate || '—'}</td>
                <td className="px-3 py-2">{row.total}</td>
                <td className="px-3 py-2">{row.status}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Link
                      href={WEB_ROUTES.dashboard.whmcs.faturaWhmcs(row.id)}
                      className="inline-flex rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      Ver
                    </Link>
                    <Link
                      href={`${WEB_ROUTES.dashboard.whmcs.faturaWhmcs(row.id)}?edit=1`}
                      className="inline-flex rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Editar
                    </Link>
                    <button
                      type="button"
                      className="inline-flex rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      disabled={busy === `del-${row.id}`}
                      onClick={() => void deleteOne(row.id)}
                    >
                      {busy === `del-${row.id}` ? '…' : 'Apagar'}
                    </button>
                    <OpenInWhmcsLink href={row.openInWhmcs} />
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  Sem faturas
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <WhmcsPagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} />
    </div>
  );
}
