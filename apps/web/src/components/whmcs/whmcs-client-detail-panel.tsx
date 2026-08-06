'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { OpenInWhmcsLink, WhmcsConnectionBanner } from '@/components/whmcs/whmcs-ui';
import clsx from 'clsx';

type Tab = 'resumo' | 'perfil' | 'servicos' | 'dominios' | 'faturas';

type ClientDetail = {
  client: Record<string, unknown>;
  stats: Record<string, unknown> | null;
  services: Array<Record<string, unknown> & { id: number; openInWhmcs?: string }>;
  domains: Array<Record<string, unknown> & { id: number; domain: string }>;
  invoices: Array<Record<string, unknown> & { id: number; status: string; total: string }>;
  counts: { services: number; domains: number; invoices: number };
  openInWhmcs: {
    summary: string;
    profile: string;
    services: string;
    domains: string;
    invoices: string;
  };
};

type ProfileForm = {
  firstname: string;
  lastname: string;
  companyname: string;
  email: string;
  tax_id: string;
  phonenumber: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  status: string;
  notes: string;
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'perfil', label: 'Perfil' },
  { id: 'servicos', label: 'Serviços' },
  { id: 'dominios', label: 'Domínios' },
  { id: 'faturas', label: 'Faturas' },
];

function str(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

function formFromClient(c: Record<string, unknown>): ProfileForm {
  return {
    firstname: String(c.firstname ?? ''),
    lastname: String(c.lastname ?? ''),
    companyname: String(c.companyname ?? ''),
    email: String(c.email ?? ''),
    tax_id: String(c.tax_id ?? ''),
    phonenumber: String(c.phonenumber ?? ''),
    address1: String(c.address1 ?? ''),
    address2: String(c.address2 ?? ''),
    city: String(c.city ?? ''),
    state: String(c.state ?? ''),
    postcode: String(c.postcode ?? ''),
    country: String(c.country ?? ''),
    status: String(c.status ?? 'Active'),
    notes: String(c.notes ?? ''),
  };
}

export function WhmcsClientDetailPanel({ clientId }: { clientId: number }) {
  const { workspaceId } = useWorkspaceContext();
  const [tab, setTab] = useState<Tab>('resumo');
  const [data, setData] = useState<ClientDetail | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  const load = useCallback(() => {
    if (!workspaceId || !clientId) return;
    setLoading(true);
    setError('');
    setHint('');
    const q = withWorkspaceQuery(API_PATHS.whmcs.clientById(clientId), workspaceId);
    apiFetch<ClientDetail>(q, {}, getStoredToken()).then((res) => {
      setLoading(false);
      if (!res.success) {
        setError(getApiErrorMessage(res));
        const d = res.data as { hint?: string } | undefined;
        setHint(d?.hint ?? (res as { hint?: string }).hint ?? '');
        setData(null);
        return;
      }
      const payload = res.data ?? null;
      setData(payload);
      if (payload?.client) setForm(formFromClient(payload.client));
    });
  }, [workspaceId, clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !form) return;
    setSaving(true);
    setError('');
    setSuccess('');
    const res = await apiFetch<ClientDetail>(
      API_PATHS.whmcs.clientById(clientId),
      {
        method: 'PUT',
        body: JSON.stringify({ workspaceId, ...form }),
      },
      getStoredToken()
    );
    setSaving(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    setSuccess('Cliente actualizado no WHMCS');
    if (res.data) {
      setData(res.data);
      setForm(formFromClient(res.data.client));
    } else {
      load();
    }
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setEmailBusy(true);
    setError('');
    setSuccess('');
    const res = await apiFetch(
      API_PATHS.whmcs.clientEmail(clientId),
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          subject: emailSubject,
          message: emailMessage,
        }),
      },
      getStoredToken()
    );
    setEmailBusy(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    setSuccess('Email enviado via WHMCS');
    setEmailOpen(false);
    setEmailSubject('');
    setEmailMessage('');
  }

  const c = data?.client ?? {};
  const name = [c.firstname, c.lastname].filter(Boolean).join(' ') || `Cliente #${clientId}`;
  const company = str(c.companyname);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={WEB_ROUTES.dashboard.whmcs.clientes} className="text-xs text-slate-500 hover:underline">
            ← Clientes
          </Link>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            #{clientId} — {name}
            {company !== '—' ? (
              <span className="font-normal text-slate-500"> ({company})</span>
            ) : null}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setEmailOpen((v) => !v)}
          >
            Email
          </button>
          {data?.openInWhmcs.summary ? <OpenInWhmcsLink href={data.openInWhmcs.summary} /> : null}
        </div>
      </div>

      <WhmcsConnectionBanner error={error} hint={hint} />
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      {emailOpen ? (
        <form onSubmit={(e) => void sendEmail(e)} className="space-y-3 rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold">Enviar email (WHMCS)</h3>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Assunto
            <input
              className="input"
              required
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Mensagem (HTML permitido)
            <textarea
              className="input min-h-[120px]"
              required
              value={emailMessage}
              onChange={(e) => setEmailMessage(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-sm" disabled={emailBusy}>
              {emailBusy ? 'A enviar…' : 'Enviar'}
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setEmailOpen(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {loading && !data ? <p className="text-sm text-slate-500">A carregar…</p> : null}

      {data ? (
        <>
          <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-px">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={clsx(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition',
                  tab === t.id
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                )}
              >
                {t.label}
                {t.id === 'servicos' ? ` (${data.counts.services})` : ''}
                {t.id === 'dominios' ? ` (${data.counts.domains})` : ''}
                {t.id === 'faturas' ? ` (${data.counts.invoices})` : ''}
              </button>
            ))}
          </div>

          {tab === 'resumo' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoCard title="Contacto">
                <p>{str(c.email)}</p>
                <p>{str(c.phonenumber)}</p>
                <p className="text-slate-500">
                  {[c.address1, c.city, c.postcode, c.country].filter(Boolean).join(', ') || '—'}
                </p>
              </InfoCard>
              <InfoCard title="Contagens">
                <p>Serviços: {data.counts.services}</p>
                <p>Domínios: {data.counts.domains}</p>
                <p>Faturas (amostra): {data.counts.invoices}</p>
              </InfoCard>
              <InfoCard title="Atalhos WHMCS">
                <div className="flex flex-col gap-2 items-start">
                  <OpenInWhmcsLink href={data.openInWhmcs.profile} label="Perfil" />
                  <OpenInWhmcsLink href={data.openInWhmcs.services} label="Serviços" />
                  <OpenInWhmcsLink href={data.openInWhmcs.domains} label="Domínios" />
                  <OpenInWhmcsLink href={data.openInWhmcs.invoices} label="Faturas" />
                </div>
              </InfoCard>
            </div>
          ) : null}

          {tab === 'perfil' && form ? (
            <form onSubmit={(e) => void saveProfile(e)} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['firstname', 'Nome'],
                    ['lastname', 'Apelido'],
                    ['companyname', 'Empresa'],
                    ['email', 'Email'],
                    ['tax_id', 'NIF / VAT'],
                    ['phonenumber', 'Telefone'],
                    ['address1', 'Morada'],
                    ['address2', 'Morada 2'],
                    ['city', 'Cidade'],
                    ['state', 'Distrito'],
                    ['postcode', 'Código postal'],
                    ['country', 'País (ISO)'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-1 text-xs text-slate-600">
                    {label}
                    <input
                      className="input"
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  Estado
                  <select
                    className="input"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Closed">Closed</option>
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Notas (admin)
                <textarea
                  className="input min-h-[100px]"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <button type="submit" className="btn-primary text-sm" disabled={saving}>
                {saving ? 'A guardar…' : 'Guardar no WHMCS'}
              </button>
            </form>
          ) : null}

          {tab === 'servicos' ? (
            <SimpleTable
              columns={['#', 'Produto', 'Domínio', 'Estado', 'Próx. venc.', '']}
              rows={data.services.map((s) => [
                String(s.id),
                str(s.name),
                str(s.domain),
                str(s.status),
                str(s.nextduedate),
                <OpenInWhmcsLink
                  key={`s-${s.id}`}
                  href={`${data.openInWhmcs.services}&id=${s.id}`}
                />,
              ])}
            />
          ) : null}

          {tab === 'dominios' ? (
            <SimpleTable
              columns={['#', 'Domínio', 'Estado', 'Expira', '']}
              rows={data.domains.map((d) => [
                String(d.id),
                d.domain || '—',
                str(d.status),
                str(d.expirydate),
                <OpenInWhmcsLink
                  key={`d-${d.id}`}
                  href={`${data.openInWhmcs.domains}&id=${d.id}`}
                />,
              ])}
            />
          ) : null}

          {tab === 'faturas' ? (
            <SimpleTable
              columns={['#', 'Data', 'Vencimento', 'Total', 'Estado', '']}
              rows={data.invoices.map((inv) => [
                String(inv.invoicenum || inv.id),
                str(inv.date),
                str(inv.duedate),
                str(inv.total),
                str(inv.status),
                <div key={`i-${inv.id}`} className="flex gap-1 justify-end">
                  <Link
                    href={WEB_ROUTES.dashboard.whmcs.faturaWhmcs(inv.id)}
                    className="inline-flex rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white"
                  >
                    Ver
                  </Link>
                </div>,
              ])}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 text-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="space-y-1 text-slate-800">{children}</div>
    </div>
  );
}

function SimpleTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c || 'actions'} className="px-3 py-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-t border-slate-100">
              {cells.map((cell, j) => (
                <td key={j} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                Sem registos
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
