'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { OpenInWhmcsLink, WhmcsConnectionBanner } from '@/components/whmcs/whmcs-ui';

type InvoiceLine = { id: number; description: string; amount: string; taxed: number };

type InvoiceDetail = {
  invoice: Record<string, unknown> & {
    id: number;
    userid: number;
    invoicenum?: string;
    status?: string;
    total?: string;
    subtotal?: string;
    tax?: string;
    date?: string;
    duedate?: string;
    datepaid?: string;
    paymentmethod?: string;
    notes?: string;
  };
  lines: InvoiceLine[];
  clientName?: string;
  openInWhmcs: string;
  openClientInWhmcs: string;
};

type PayMethod = { module: string; displayname: string };

type EditLine = {
  id: number;
  description: string;
  amount: string;
  taxed: boolean;
  remove?: boolean;
};

type NewLine = { description: string; amount: string; taxed: boolean };

const STATUSES = ['Draft', 'Unpaid', 'Paid', 'Cancelled', 'Refunded', 'Collections'] as const;

export function WhmcsLiveInvoiceDetailPanel({
  invoiceId,
  initialEdit = false,
}: {
  invoiceId: number;
  initialEdit?: boolean;
}) {
  const router = useRouter();
  const { workspaceId } = useWorkspaceContext();
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  const [methods, setMethods] = useState<PayMethod[]>([]);
  const [gateway, setGateway] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [editing, setEditing] = useState(initialEdit);

  const [status, setStatus] = useState('');
  const [paymentmethod, setPaymentmethod] = useState('');
  const [date, setDate] = useState('');
  const [duedate, setDuedate] = useState('');
  const [datepaid, setDatepaid] = useState('');
  const [notes, setNotes] = useState('');
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [newLines, setNewLines] = useState<NewLine[]>([]);

  const load = useCallback(() => {
    if (!workspaceId) return;
    setError('');
    setHint('');
    const q = withWorkspaceQuery(API_PATHS.whmcs.invoiceLiveById(invoiceId), workspaceId);
    apiFetch<InvoiceDetail>(q, {}, getStoredToken()).then((res) => {
      if (!res.success) {
        setError(getApiErrorMessage(res));
        const d = res.data as { hint?: string } | undefined;
        setHint(d?.hint ?? (res as { hint?: string }).hint ?? '');
        setData(null);
        return;
      }
      setData(res.data ?? null);
      const inv = res.data?.invoice;
      const pm = inv?.paymentmethod;
      if (pm && typeof pm === 'string') setGateway(pm);
      if (inv) {
        setStatus(String(inv.status || ''));
        setPaymentmethod(String(inv.paymentmethod || ''));
        setDate(String(inv.date || ''));
        setDuedate(String(inv.duedate || ''));
        setDatepaid(String(inv.datepaid || '').slice(0, 10));
        setNotes(String(inv.notes || ''));
        setEditLines(
          (res.data?.lines ?? []).map((l) => ({
            id: l.id,
            description: l.description,
            amount: String(l.amount),
            taxed: Boolean(l.taxed),
          }))
        );
        setNewLines([]);
      }
    });
  }, [workspaceId, invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!workspaceId) return;
    const q = withWorkspaceQuery(API_PATHS.whmcs.paymentMethods, workspaceId);
    apiFetch<{ methods: PayMethod[] }>(q, {}, getStoredToken()).then((res) => {
      if (res.success && res.data?.methods?.length) {
        setMethods(res.data.methods);
        setGateway((g) => g || res.data!.methods[0]!.module);
      }
    });
  }, [workspaceId]);

  async function runAction(
    key: string,
    path: string,
    body: Record<string, unknown>,
    confirmMsg?: string,
    method: 'POST' | 'PUT' | 'DELETE' = 'POST'
  ) {
    if (!workspaceId) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(key);
    setError('');
    setSuccess('');
    const res = await apiFetch<InvoiceDetail | { deleted?: boolean; fallbackCancelled?: boolean }>(
      method === 'DELETE' ? withWorkspaceQuery(path, workspaceId) : path,
      {
        method,
        body: method === 'DELETE' ? undefined : JSON.stringify({ workspaceId, ...body }),
      },
      getStoredToken()
    );
    setBusy('');
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    setSuccess(res.message || 'OK');
    if (key === 'delete') {
      const d = res.data as { deleted?: boolean; fallbackCancelled?: boolean } | undefined;
      if (d?.deleted) {
        router.push(WEB_ROUTES.dashboard.whmcs.faturasWhmcs);
        return;
      }
      load();
      setPayOpen(false);
      setEditing(false);
      return;
    }
    if (res.data && 'invoice' in (res.data as object)) {
      setData(res.data as InvoiceDetail);
      setEditing(false);
    } else {
      load();
    }
    setPayOpen(false);
  }

  async function saveEdit() {
    if (!workspaceId) return;
    setBusy('save');
    setError('');
    setSuccess('');
    const lines = editLines
      .filter((l) => !l.remove)
      .map((l) => ({
        id: l.id,
        description: l.description,
        amount: l.amount,
        taxed: l.taxed,
      }));
    const deleteLineIds = editLines.filter((l) => l.remove).map((l) => l.id);
    const res = await apiFetch<InvoiceDetail>(
      API_PATHS.whmcs.invoiceLiveById(invoiceId),
      {
        method: 'PUT',
        body: JSON.stringify({
          workspaceId,
          status: status || undefined,
          paymentmethod: paymentmethod || undefined,
          date: date || undefined,
          duedate: duedate || undefined,
          datepaid: datepaid || undefined,
          notes,
          lines,
          newLines: newLines.filter((l) => l.description.trim()),
          deleteLineIds: deleteLineIds.length ? deleteLineIds : undefined,
        }),
      },
      getStoredToken()
    );
    setBusy('');
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    setSuccess(res.message || 'Guardado');
    if (res.data) setData(res.data);
    else load();
    setEditing(false);
  }

  const inv = data?.invoice;
  const statusLc = String(inv?.status || '').toLowerCase();
  const canPay = statusLc === 'unpaid' || statusLc === 'draft' || statusLc === 'collections';
  const canCancel = statusLc !== 'paid' && statusLc !== 'cancelled' && statusLc !== '';
  const canUnpaid = statusLc === 'paid' || statusLc === 'collections';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={WEB_ROUTES.dashboard.whmcs.faturasWhmcs}
            className="text-xs text-slate-500 hover:underline"
          >
            ← Faturas
          </Link>
          <h2 className="mt-1 text-lg font-semibold">
            Fatura {inv?.invoicenum || `#${invoiceId}`}
          </h2>
          {data?.clientName ? (
            <p className="text-sm text-slate-500">{data.clientName}</p>
          ) : null}
        </div>
        {data ? (
          <div className="flex flex-wrap gap-2">
            {!editing ? (
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setEditing(true)}
              >
                Editar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={busy === 'save'}
                  onClick={() => void saveEdit()}
                >
                  {busy === 'save' ? 'A guardar…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    setEditing(false);
                    load();
                  }}
                >
                  Cancelar edição
                </button>
              </>
            )}
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busy === 'email'}
              onClick={() =>
                void runAction('email', API_PATHS.whmcs.invoiceSendEmail(invoiceId), {})
              }
            >
              {busy === 'email' ? 'A enviar…' : 'Enviar email'}
            </button>
            {canPay ? (
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => setPayOpen((v) => !v)}
              >
                Marcar paga
              </button>
            ) : null}
            {canUnpaid ? (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={busy === 'unpaid'}
                onClick={() =>
                  void runAction(
                    'unpaid',
                    API_PATHS.whmcs.invoiceMarkUnpaid(invoiceId),
                    {},
                    'Marcar esta fatura como Unpaid no WHMCS?'
                  )
                }
              >
                {busy === 'unpaid' ? '…' : 'Marcar não paga'}
              </button>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="btn-secondary text-xs text-amber-800"
                disabled={busy === 'cancel'}
                onClick={() =>
                  void runAction(
                    'cancel',
                    API_PATHS.whmcs.invoiceCancel(invoiceId),
                    {},
                    'Cancelar esta fatura no WHMCS?'
                  )
                }
              >
                {busy === 'cancel' ? '…' : 'Cancelar'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary text-xs text-red-700"
              disabled={busy === 'delete'}
              onClick={() =>
                void runAction(
                  'delete',
                  API_PATHS.whmcs.invoiceLiveById(invoiceId),
                  {},
                  'Apagar esta fatura no WHMCS? Se a API não permitir, será cancelada.',
                  'DELETE'
                )
              }
            >
              {busy === 'delete' ? '…' : 'Apagar'}
            </button>
            <OpenInWhmcsLink href={data.openInWhmcs} />
            <Link
              href={WEB_ROUTES.dashboard.whmcs.cliente(inv!.userid)}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Ver cliente
            </Link>
          </div>
        ) : null}
      </div>

      <WhmcsConnectionBanner error={error} hint={hint} />
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      {payOpen ? (
        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold">Marcar fatura como paga</h3>
          <label className="flex flex-col gap-1 text-xs text-slate-600 max-w-xs">
            Gateway
            <select className="input" value={gateway} onChange={(e) => setGateway(e.target.value)}>
              {methods.length === 0 ? (
                <option value={gateway || 'mailin'}>{gateway || 'mailin'}</option>
              ) : (
                methods.map((m) => (
                  <option key={m.module} value={m.module}>
                    {m.displayname} ({m.module})
                  </option>
                ))
              )}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={busy === 'pay' || !gateway}
              onClick={() =>
                void runAction('pay', API_PATHS.whmcs.invoiceMarkPaid(invoiceId), {
                  gateway,
                  sendEmail: true,
                })
              }
            >
              {busy === 'pay' ? 'A processar…' : 'Confirmar pagamento'}
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setPayOpen(false)}>
              Fechar
            </button>
          </div>
        </div>
      ) : null}

      {inv && editing ? (
        <div className="space-y-4 rounded-lg border border-slate-200 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              Estado
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              Método pagamento
              <select
                className="input"
                value={paymentmethod}
                onChange={(e) => setPaymentmethod(e.target.value)}
              >
                <option value="">—</option>
                {methods.map((m) => (
                  <option key={m.module} value={m.module}>
                    {m.displayname}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              Data
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              Vencimento
              <input
                className="input"
                type="date"
                value={duedate}
                onChange={(e) => setDuedate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              Pago em
              <input
                className="input"
                type="date"
                value={datepaid}
                onChange={(e) => setDatepaid(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Notas
            <textarea
              className="input min-h-[80px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Descrição</th>
                  <th className="px-2 py-2 w-28">Valor</th>
                  <th className="px-2 py-2 w-20">IVA</th>
                  <th className="px-2 py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {editLines.map((line, idx) => (
                  <tr
                    key={line.id}
                    className={`border-t border-slate-100 ${line.remove ? 'opacity-40 line-through' : ''}`}
                  >
                    <td className="px-2 py-1">
                      <input
                        className="input text-sm"
                        value={line.description}
                        disabled={line.remove}
                        onChange={(e) => {
                          const next = [...editLines];
                          next[idx] = { ...line, description: e.target.value };
                          setEditLines(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="input text-sm"
                        value={line.amount}
                        disabled={line.remove}
                        onChange={(e) => {
                          const next = [...editLines];
                          next[idx] = { ...line, amount: e.target.value };
                          setEditLines(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={line.taxed}
                        disabled={line.remove}
                        onChange={(e) => {
                          const next = [...editLines];
                          next[idx] = { ...line, taxed: e.target.checked };
                          setEditLines(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="text-xs text-red-700"
                        onClick={() => {
                          const next = [...editLines];
                          next[idx] = { ...line, remove: !line.remove };
                          setEditLines(next);
                        }}
                      >
                        {line.remove ? 'Restaurar' : 'Remover'}
                      </button>
                    </td>
                  </tr>
                ))}
                {newLines.map((line, idx) => (
                  <tr key={`new-${idx}`} className="border-t border-slate-100 bg-emerald-50/40">
                    <td className="px-2 py-1">
                      <input
                        className="input text-sm"
                        placeholder="Nova linha"
                        value={line.description}
                        onChange={(e) => {
                          const next = [...newLines];
                          next[idx] = { ...line, description: e.target.value };
                          setNewLines(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="input text-sm"
                        value={line.amount}
                        onChange={(e) => {
                          const next = [...newLines];
                          next[idx] = { ...line, amount: e.target.value };
                          setNewLines(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={line.taxed}
                        onChange={(e) => {
                          const next = [...newLines];
                          next[idx] = { ...line, taxed: e.target.checked };
                          setNewLines(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="text-xs text-slate-600"
                        onClick={() => setNewLines(newLines.filter((_, i) => i !== idx))}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setNewLines([...newLines, { description: '', amount: '0', taxed: false }])}
          >
            + Linha
          </button>
        </div>
      ) : null}

      {inv && !editing ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-3 text-sm">
            {[
              ['Estado', inv.status],
              ['Data', inv.date],
              ['Vencimento', inv.duedate],
              ['Pago em', inv.datepaid],
              ['Método', inv.paymentmethod],
              ['Subtotal', inv.subtotal],
              ['IVA', inv.tax],
              ['Total', inv.total],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="font-medium">{value || '—'}</dd>
              </div>
            ))}
          </dl>
          {inv.notes ? (
            <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
              <div className="text-xs text-slate-500">Notas</div>
              <div className="whitespace-pre-wrap">{String(inv.notes)}</div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Valor</th>
                  <th className="px-3 py-2">IVA</th>
                </tr>
              </thead>
              <tbody>
                {(data?.lines ?? []).map((line) => (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-pre-wrap">{line.description}</td>
                    <td className="px-3 py-2">{line.amount}</td>
                    <td className="px-3 py-2">{line.taxed ? 'Sim' : 'Não'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
