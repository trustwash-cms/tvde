'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  API_PATHS,
  VEHICLE_LIMIT_PLANS,
  buildVehicleLimitWhatsappMessage,
  buildVehicleLimitWhatsappUrl,
  getVehicleLimitPlanLabel,
  resolveVehicleLimitPlanType,
  vehicleLimitAlertLevel,
  type Role,
  type TenantVehicleLimits,
  type VehicleLimitPlanType,
} from '@tvde/shared';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import { Modal } from '@/components/modal';
import clsx from 'clsx';

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

function UsageCard({ limits }: { limits: TenantVehicleLimits }) {
  const level = vehicleLimitAlertLevel(limits.usagePercent);
  const whatsappUrl = buildVehicleLimitWhatsappUrl(
    buildVehicleLimitWhatsappMessage({
      siteId: limits.siteId,
      plan: limits.plan,
      activeCount: limits.activeCount,
      maxVehicles: limits.maxVehicles,
    })
  );

  return (
    <div className={clsx('card border', alertClass(level))}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{limits.tenantName ?? 'Tenant'}</p>
          <p className="text-xs opacity-80">
            Site ID: {limits.siteId ?? '—'} · Plano: {getVehicleLimitPlanLabel(limits.plan)}
          </p>
        </div>
        <p className="text-2xl font-bold">
          {limits.activeCount} / {limits.maxVehicles >= 999999 ? '∞' : limits.maxVehicles}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/60">
        <div
          className="h-full rounded-full bg-current transition-all"
          style={{ width: `${Math.min(100, limits.usagePercent)}%` }}
        />
      </div>
      <p className="mt-2 text-sm">{limits.usagePercent}% de utilização</p>
      {limits.usagePercent >= 75 ? (
        <p className="mt-3 text-sm">
          Está próximo do limite.{' '}
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="font-medium underline">
            Pedir aumento via WhatsApp
          </a>
        </p>
      ) : null}
    </div>
  );
}

export function SettingsTvdeVehicleLimitsPanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [limits, setLimits] = useState<TenantVehicleLimits | null>(null);
  const [allLimits, setAllLimits] = useState<TenantVehicleLimits[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editRow, setEditRow] = useState<TenantVehicleLimits | null>(null);
  const [planType, setPlanType] = useState<VehicleLimitPlanType>('gratuito');
  const [customMax, setCustomMax] = useState('');
  const [useCustomMax, setUseCustomMax] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    apiFetch<{ role: Role; tenant?: { id: string } | null }>(API_PATHS.auth.me).then((meRes) => {
      const meRole = meRes.data?.role ?? null;
      setRole(meRole);

      if (meRole === 'master') {
        apiFetch<TenantVehicleLimits[]>(API_PATHS.tenants.vehicleLimits).then((res) => {
          setLoading(false);
          if (res.success && res.data) setAllLimits(res.data);
          else setError(getApiErrorMessage(res));
        });
        return;
      }

      apiFetch<TenantVehicleLimits>(API_PATHS.tenants.currentVehicleLimits).then((limitsRes) => {
        setLoading(false);
        if (limitsRes.success && limitsRes.data) setLimits(limitsRes.data);
        else setError(getApiErrorMessage(limitsRes));
      });
    });
  }

  useEffect(() => {
    load();
  }, []);

  function openEdit(row: TenantVehicleLimits) {
    setEditRow(row);
    setPlanType(resolveVehicleLimitPlanType(row.plan));
    setCustomMax(String(row.maxVehicles));
    setUseCustomMax(false);
    setMessage('');
    setError('');
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editRow?.tenantId) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    const body: { planType: VehicleLimitPlanType; maxVehicles?: number } = { planType };
    if (useCustomMax) {
      const parsed = parseInt(customMax, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        setSubmitting(false);
        setError('Limite inválido');
        return;
      }
      body.maxVehicles = parsed;
    }

    const res = await apiFetch<TenantVehicleLimits>(API_PATHS.tenants.limits(editRow.tenantId), {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    setSubmitting(false);

    if (res.success && res.data) {
      setMessage('Limite actualizado com sucesso.');
      setEditRow(null);
      load();
      return;
    }

    setError(getApiErrorMessage(res));
  }

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar limites…</p>;
  }

  if (role === 'master') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="mb-2 text-2xl font-bold">Limite de viaturas</h1>
          <p className="text-slate-500">
            Controlo de viaturas activas por tenant (planos Gratuito / Standard / Business).
          </p>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Site ID</th>
                <th className="px-4 py-3 font-medium">Plano</th>
                <th className="px-4 py-3 font-medium">Uso</th>
                <th className="px-4 py-3 font-medium">%</th>
                <th className="px-4 py-3 font-medium text-right">Acções</th>
              </tr>
            </thead>
            <tbody>
              {allLimits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Sem tenants.
                  </td>
                </tr>
              ) : (
                allLimits.map((row) => {
                  const level = vehicleLimitAlertLevel(row.usagePercent);
                  return (
                    <tr key={row.tenantId ?? row.siteId} className="border-b border-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{row.tenantName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.siteId}</td>
                      <td className="px-4 py-3">{getVehicleLimitPlanLabel(row.plan)}</td>
                      <td className="px-4 py-3">
                        {row.activeCount} / {row.maxVehicles >= 999999 ? '∞' : row.maxVehicles}
                      </td>
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
                        <button type="button" className="btn-secondary text-xs" onClick={() => openEdit(row)}>
                          Alterar plano
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Modal
          open={Boolean(editRow)}
          onClose={() => setEditRow(null)}
          title={editRow ? `Limite — ${editRow.tenantName}` : 'Limite'}
          panelClassName="max-w-md"
        >
          {editRow ? (
            <form onSubmit={handleSave} className="space-y-4">
              <p className="text-sm text-slate-500">
                Activas: {editRow.activeCount}. O novo limite não pode ser inferior a este valor.
              </p>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Plano</label>
                <select
                  className="input"
                  value={planType}
                  onChange={(e) => {
                    const next = e.target.value as VehicleLimitPlanType;
                    setPlanType(next);
                    setCustomMax(String(VEHICLE_LIMIT_PLANS[next].maxVehicles));
                    setUseCustomMax(false);
                  }}
                >
                  {(Object.keys(VEHICLE_LIMIT_PLANS) as VehicleLimitPlanType[]).map((key) => (
                    <option key={key} value={key}>
                      {VEHICLE_LIMIT_PLANS[key].label} (
                      {VEHICLE_LIMIT_PLANS[key].maxVehicles >= 999999
                        ? 'ilimitado'
                        : VEHICLE_LIMIT_PLANS[key].maxVehicles}{' '}
                      viaturas)
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={useCustomMax}
                  onChange={(e) => setUseCustomMax(e.target.checked)}
                />
                Usar limite personalizado
              </label>
              {useCustomMax ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Máximo de viaturas activas
                  </label>
                  <input
                    type="number"
                    min={editRow.activeCount || 1}
                    className="input"
                    value={customMax}
                    onChange={(e) => setCustomMax(e.target.value)}
                    required
                  />
                </div>
              ) : null}
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

  if (!limits) {
    return <p className="text-sm text-red-600">{error || 'Não foi possível carregar limites.'}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Limite de viaturas</h1>
        <p className="text-slate-500">
          Controlo de viaturas activas do seu tenant — base para Uber, Bolt, Via Verde e PRIO.
        </p>
      </div>

      <UsageCard limits={limits} />

      <div className="card max-w-xl text-sm text-slate-600">
        Apenas o administrador da plataforma (MASTER) pode alterar o plano. O gestor de frota pode
        consultar o uso actual e pedir aumento via WhatsApp quando estiver ≥75%.
      </div>
    </div>
  );
}
