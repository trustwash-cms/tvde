'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  API_PATHS,
  formatStorageBytes,
  storageLimitAlertLevel,
  type Role,
  type TenantStorageBreakdown,
  type TenantStorageSummary,
} from '@tvde/shared';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import { Modal } from '@/components/modal';
import clsx from 'clsx';

const BREAKDOWN_LABELS: Record<keyof TenantStorageBreakdown, string> = {
  userDocuments: 'Documentos utilizadores',
  calendarAttachments: 'Anexos calendário',
  ecommerceProductImages: 'Imagens ecommerce (produtos)',
  ecommerceMediaAssets: 'Media ecommerce',
  branding: 'Branding (logo/wallpaper)',
};

function alertClass(level: ReturnType<typeof storageLimitAlertLevel>): string {
  switch (level) {
    case 'danger':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'warning':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'info':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    default:
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  }
}

function UsageCard({ storage }: { storage: TenantStorageSummary }) {
  const level = storageLimitAlertLevel(storage.usagePercent);

  return (
    <div className={clsx('card border', alertClass(level))}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{storage.tenantName ?? 'Tenant'}</p>
          <p className="text-xs opacity-80">
            Site ID: {storage.siteId ?? '—'} · Plano: {storage.plan} · Limite: {storage.limitGb} GB
          </p>
        </div>
        <p className="text-2xl font-bold">
          {formatStorageBytes(storage.usedBytes)} / {formatStorageBytes(storage.limitBytes)}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/60">
        <div
          className="h-full rounded-full bg-current transition-all"
          style={{ width: `${Math.min(100, storage.usagePercent)}%` }}
        />
      </div>
      <p className="mt-2 text-sm">
        {storage.usagePercent}% utilizado · Disponível: {formatStorageBytes(storage.availableBytes)}
      </p>
      {storage.usagePercent >= 90 ? (
        <p className="mt-3 text-sm font-medium">
          Limite quase esgotado — novos uploads serão bloqueados até libertar espaço ou aumentar o
          plano.
        </p>
      ) : null}
    </div>
  );
}

function BreakdownCard({ storage }: { storage: TenantStorageSummary }) {
  return (
    <div className="card">
      <h2 className="mb-4 text-base font-semibold text-slate-900">Utilização por categoria</h2>
      <ul className="divide-y divide-slate-100">
        {(Object.keys(BREAKDOWN_LABELS) as Array<keyof TenantStorageBreakdown>).map((key) => (
          <li key={key} className="flex items-center justify-between py-2 text-sm">
            <span className="text-slate-600">{BREAKDOWN_LABELS[key]}</span>
            <span className="font-medium text-slate-900">
              {formatStorageBytes(storage.breakdown[key])}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsTvdeStoragePanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [storage, setStorage] = useState<TenantStorageSummary | null>(null);
  const [allStorage, setAllStorage] = useState<TenantStorageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editRow, setEditRow] = useState<TenantStorageSummary | null>(null);
  const [storageGb, setStorageGb] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [detailRow, setDetailRow] = useState<TenantStorageSummary | null>(null);

  function load() {
    setLoading(true);
    setError('');
    apiFetch<{ role: Role; tenant?: { id: string } | null }>(API_PATHS.auth.me).then((meRes) => {
      const meRole = meRes.data?.role ?? null;
      setRole(meRole);

      if (meRole === 'master') {
        apiFetch<TenantStorageSummary[]>(API_PATHS.tenants.storage).then((res) => {
          setLoading(false);
          if (res.success && res.data) setAllStorage(res.data);
          else setError(getApiErrorMessage(res));
        });
        return;
      }

      apiFetch<TenantStorageSummary>(API_PATHS.tenants.currentStorage).then((storageRes) => {
        setLoading(false);
        if (storageRes.success && storageRes.data) setStorage(storageRes.data);
        else setError(getApiErrorMessage(storageRes));
      });
    });
  }

  useEffect(() => {
    load();
  }, []);

  function openEdit(row: TenantStorageSummary) {
    setEditRow(row);
    setStorageGb(String(row.limitGb));
    setMessage('');
    setError('');
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editRow?.tenantId) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    const parsed = parseFloat(storageGb);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setSubmitting(false);
      setError('Limite inválido');
      return;
    }

    const res = await apiFetch<TenantStorageSummary>(API_PATHS.tenants.limits(editRow.tenantId), {
      method: 'PATCH',
      body: JSON.stringify({ storageGb: parsed }),
    });

    setSubmitting(false);

    if (res.success && res.data) {
      setMessage('Limite de storage actualizado.');
      setEditRow(null);
      load();
      return;
    }

    setError(getApiErrorMessage(res));
  }

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar storage…</p>;
  }

  if (role === 'master') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="mb-2 text-2xl font-bold">Storage</h1>
          <p className="text-slate-500">
            Quota de armazenamento por tenant — documentos, calendário, branding e ecommerce.
          </p>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Site ID</th>
                <th className="px-4 py-3 font-medium">Uso</th>
                <th className="px-4 py-3 font-medium">Limite</th>
                <th className="px-4 py-3 font-medium">%</th>
                <th className="px-4 py-3 font-medium text-right">Acções</th>
              </tr>
            </thead>
            <tbody>
              {allStorage.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Sem tenants.
                  </td>
                </tr>
              ) : (
                allStorage.map((row) => {
                  const level = storageLimitAlertLevel(row.usagePercent);
                  return (
                    <tr key={row.tenantId ?? row.siteId} className="border-b border-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.tenantName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.siteId}</td>
                      <td className="px-4 py-3">{formatStorageBytes(row.usedBytes)}</td>
                      <td className="px-4 py-3">{row.limitGb} GB</td>
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                            alertClass(level)
                          )}
                        >
                          {row.usagePercent}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => setDetailRow(row)}
                          >
                            Detalhe
                          </button>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => openEdit(row)}
                          >
                            Alterar limite
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Modal
          open={Boolean(detailRow)}
          onClose={() => setDetailRow(null)}
          title={detailRow ? `Storage — ${detailRow.tenantName}` : 'Storage'}
          panelClassName="max-w-lg"
        >
          {detailRow ? (
            <div className="space-y-4">
              <UsageCard storage={detailRow} />
              <BreakdownCard storage={detailRow} />
            </div>
          ) : null}
        </Modal>

        <Modal
          open={Boolean(editRow)}
          onClose={() => setEditRow(null)}
          title={editRow ? `Limite — ${editRow.tenantName}` : 'Limite'}
          panelClassName="max-w-md"
        >
          {editRow ? (
            <form onSubmit={handleSave} className="space-y-4">
              <p className="text-sm text-slate-500">
                Uso actual: {formatStorageBytes(editRow.usedBytes)}. O novo limite não pode ser
                inferior a este valor.
              </p>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Storage (GB)</label>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  className="input"
                  value={storageGb}
                  onChange={(e) => setStorageGb(e.target.value)}
                  required
                />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setEditRow(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'A guardar…' : 'Guardar'}
                </button>
              </div>
            </form>
          ) : null}
        </Modal>
      </div>
    );
  }

  if (!storage) {
    return <p className="text-sm text-red-600">{error || 'Não foi possível carregar storage.'}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Storage</h1>
        <p className="text-slate-500">
          Quota de armazenamento do tenant — documentos, calendário, branding e ecommerce.
        </p>
      </div>

      <UsageCard storage={storage} />
      <BreakdownCard storage={storage} />

      <div className="card max-w-xl text-sm text-slate-600">
        Apenas o MASTER pode alterar a quota. O gestor de frota pode monitorizar o uso actual.
      </div>
    </div>
  );
}
