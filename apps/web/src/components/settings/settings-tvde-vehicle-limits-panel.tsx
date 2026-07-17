'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  API_PATHS,
  vehicleLimitAlertLevel,
  type Role,
  type TenantVehicleLimits,
} from '@tvde/shared';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import clsx from 'clsx';

const WHATSAPP_NUMBER = '925986983';

function alertClass(level: ReturnType<typeof vehicleLimitAlertLevel>): string {
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

export function SettingsTvdeVehicleLimitsPanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [limits, setLimits] = useState<TenantVehicleLimits | null>(null);
  const [maxVehicles, setMaxVehicles] = useState('');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch<{ role: Role; tenant?: { id: string } | null }>(API_PATHS.auth.me),
      apiFetch<TenantVehicleLimits>(API_PATHS.tenants.currentVehicleLimits),
    ]).then(([meRes, limitsRes]) => {
      setLoading(false);
      if (meRes.data?.role) setRole(meRes.data.role);
      if (meRes.data?.tenant?.id) setTenantId(meRes.data.tenant.id);
      if (limitsRes.success && limitsRes.data) {
        setLimits(limitsRes.data);
        setMaxVehicles(String(limitsRes.data.maxVehicles));
      } else if (!limitsRes.success && meRes.data?.role !== 'master') {
        setError(getApiErrorMessage(limitsRes));
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

    const res = await apiFetch<TenantVehicleLimits>(API_PATHS.tenants.limits(tenantId), {
      method: 'PATCH',
      body: JSON.stringify({ maxVehicles: parseInt(maxVehicles, 10) }),
    });

    setSubmitting(false);

    if (res.success && res.data) {
      setLimits(res.data);
      setMessage('Limite actualizado com sucesso.');
      return;
    }

    setError(getApiErrorMessage(res));
  }

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar limites…</p>;
  }

  if (role === 'master' && !limits) {
    return (
      <div className="card max-w-xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Limite de viaturas</h2>
        <p className="text-sm text-slate-500">
          Como MASTER, altere o limite de viaturas na gestão de tenants (PATCH{' '}
          <code>/tenants/:id/limits</code>).
        </p>
      </div>
    );
  }

  if (!limits) {
    return <p className="text-sm text-red-600">{error || 'Não foi possível carregar limites.'}</p>;
  }

  const level = vehicleLimitAlertLevel(limits.usagePercent);
  const whatsappText = encodeURIComponent(
    `Olá, preciso aumentar o limite de viaturas do meu plano.

Site ID: ${limits.siteId ?? '—'}
Plano: ${limits.plan}
Viaturas activas: ${limits.activeCount} / ${limits.maxVehicles}
Limite necessário: ${limits.activeCount + 1} viaturas`
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Limite de viaturas</h1>
        <p className="text-slate-500">
          Controlo de viaturas activas por tenant — base para Uber, Bolt, Via Verde e PRIO.
        </p>
      </div>

      <div className={clsx('card border', alertClass(level))}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{limits.tenantName ?? 'Tenant'}</p>
            <p className="text-xs opacity-80">Site ID: {limits.siteId ?? '—'} · Plano: {limits.plan}</p>
          </div>
          <p className="text-2xl font-bold">
            {limits.activeCount} / {limits.maxVehicles}
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/60">
          <div
            className="h-full rounded-full bg-current transition-all"
            style={{ width: `${limits.usagePercent}%` }}
          />
        </div>
        <p className="mt-2 text-sm">{limits.usagePercent}% de utilização</p>
        {limits.usagePercent >= 75 ? (
          <p className="mt-3 text-sm">
            Está próximo do limite.{' '}
            <a
              href={`https://wa.me/351${WHATSAPP_NUMBER}?text=${whatsappText}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline"
            >
              Pedir aumento via WhatsApp
            </a>
          </p>
        ) : null}
      </div>

      {role === 'master' && tenantId ? (
        <form onSubmit={handleSave} className="card max-w-md space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Alterar limite (MASTER)</h2>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Máximo de viaturas activas</label>
            <input
              type="number"
              min={limits.activeCount || 1}
              className="input"
              value={maxVehicles}
              onChange={(e) => setMaxVehicles(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Não pode ser inferior às {limits.activeCount} viaturas activas actuais.
            </p>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'A guardar…' : 'Guardar limite'}
          </button>
        </form>
      ) : (
        <div className="card max-w-xl text-sm text-slate-600">
          Apenas o administrador da plataforma (MASTER) pode alterar o limite do plano. O gestor de frota
          pode consultar o uso actual e pedir aumento.
        </div>
      )}
    </div>
  );
}
