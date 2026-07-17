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

export function SettingsTvdeStoragePanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [storage, setStorage] = useState<TenantStorageSummary | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [storageGb, setStorageGb] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch<{ role: Role; tenant?: { id: string } | null }>(API_PATHS.auth.me),
      apiFetch<TenantStorageSummary>(API_PATHS.tenants.currentStorage),
    ]).then(([meRes, storageRes]) => {
      setLoading(false);
      if (meRes.data?.role) setRole(meRes.data.role);
      if (meRes.data?.tenant?.id) setTenantId(meRes.data.tenant.id);
      if (storageRes.success && storageRes.data) {
        setStorage(storageRes.data);
        setStorageGb(String(storageRes.data.limitGb));
      } else if (!storageRes.success && meRes.data?.role !== 'master') {
        setError(getApiErrorMessage(storageRes));
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    const res = await apiFetch<{ storage?: TenantStorageSummary }>(API_PATHS.tenants.limits(tenantId), {
      method: 'PATCH',
      body: JSON.stringify({ storageGb: parseFloat(storageGb) }),
    });

    setSubmitting(false);

    if (res.success && res.data?.storage) {
      setStorage(res.data.storage);
      setMessage('Limite de storage actualizado.');
      return;
    }

    setError(getApiErrorMessage(res));
  }

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar storage…</p>;
  }

  if (!storage) {
    return (
      <div className="card max-w-xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Storage</h2>
        <p className="text-sm text-slate-500">
          {error || 'Sem dados de storage — apenas tenants com superadmin associado.'}
        </p>
      </div>
    );
  }

  const level = storageLimitAlertLevel(storage.usagePercent);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Storage</h1>
        <p className="text-slate-500">
          Quota de armazenamento do tenant — documentos, calendário, branding e ecommerce.
        </p>
      </div>

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
          <div className="h-full rounded-full bg-current transition-all" style={{ width: `${storage.usagePercent}%` }} />
        </div>
        <p className="mt-2 text-sm">
          {storage.usagePercent}% utilizado · Disponível: {formatStorageBytes(storage.availableBytes)}
        </p>
        {storage.usagePercent >= 90 ? (
          <p className="mt-3 text-sm font-medium">
            Limite quase esgotado — novos uploads serão bloqueados até libertar espaço ou aumentar o plano.
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Utilização por categoria</h2>
        <ul className="divide-y divide-slate-100">
          {(Object.keys(BREAKDOWN_LABELS) as Array<keyof TenantStorageBreakdown>).map((key) => (
            <li key={key} className="flex items-center justify-between py-2 text-sm">
              <span className="text-slate-600">{BREAKDOWN_LABELS[key]}</span>
              <span className="font-medium text-slate-900">{formatStorageBytes(storage.breakdown[key])}</span>
            </li>
          ))}
        </ul>
      </div>

      {role === 'master' && tenantId ? (
        <form onSubmit={handleSave} className="card max-w-md space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Alterar limite (MASTER)</h2>
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
          {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'A guardar…' : 'Guardar limite'}
          </button>
        </form>
      ) : (
        <div className="card max-w-xl text-sm text-slate-600">
          Apenas o MASTER pode alterar a quota. O gestor de frota pode monitorizar o uso actual.
        </div>
      )}
    </div>
  );
}
