'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_PATHS, getRoleLabel, type Role } from '@tvde/shared';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import { useAlertDialog } from '@/hooks/use-alert-dialog';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface TenantSessionItem {
  id: string;
  userId: string;
  tenantId?: string | null;
  tenantName?: string | null;
  siteId?: string | null;
  ipAddress: string | null;
  deviceInfo: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    username: string | null;
    fullName: string | null;
    role: string;
  };
}

function displayUser(session: TenantSessionItem): string {
  return session.user.username ?? session.user.fullName ?? session.user.email;
}

export function SettingsTvdeSessionsPanel() {
  const [role, setRole] = useState<Role | null>(null);
  const [sessions, setSessions] = useState<TenantSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [tenantFilter, setTenantFilter] = useState('');
  const { alert, alertDialog } = useAlertDialog();
  const { confirm, confirmDialog } = useConfirmDialog();

  const isMaster = role === 'master';

  const tenantOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) {
      if (session.tenantId) {
        map.set(
          session.tenantId,
          session.tenantName
            ? `${session.tenantName}${session.siteId ? ` (${session.siteId})` : ''}`
            : session.siteId ?? session.tenantId
        );
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt'));
  }, [sessions]);

  const visibleSessions = useMemo(() => {
    if (!isMaster || !tenantFilter) return sessions;
    return sessions.filter((s) => s.tenantId === tenantFilter);
  }, [isMaster, sessions, tenantFilter]);

  function load() {
    setLoading(true);
    setError('');
    apiFetch<{ role: Role }>(API_PATHS.auth.me).then((meRes) => {
      const meRole = meRes.data?.role ?? null;
      setRole(meRole);

      if (meRole === 'master') {
        apiFetch<TenantSessionItem[]>(API_PATHS.tenants.sessions).then((res) => {
          setLoading(false);
          if (res.success && res.data) {
            setSessions(res.data);
            return;
          }
          setError(getApiErrorMessage(res));
        });
        return;
      }

      apiFetch<TenantSessionItem[]>(API_PATHS.tenants.currentSessions).then((res) => {
        setLoading(false);
        if (res.success && res.data) {
          setSessions(res.data);
          return;
        }
        setError(getApiErrorMessage(res));
      });
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function revokeSession(session: TenantSessionItem) {
    const ok = await confirm({
      title: 'Revogar sessão',
      message: `Revogar sessão de ${displayUser(session)}?`,
      confirmLabel: 'Revogar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    setRevokingId(session.id);
    const path = isMaster
      ? API_PATHS.tenants.sessionById(session.id)
      : API_PATHS.tenants.currentSessionById(session.id);
    const res = await apiFetch(path, { method: 'DELETE' });
    setRevokingId(null);

    if (res.success) {
      load();
      return;
    }

    await alert({
      title: 'Não foi possível revogar',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
  }

  async function revokeAll() {
    const scopeLabel = tenantFilter
      ? tenantOptions.find(([id]) => id === tenantFilter)?.[1] ?? 'este tenant'
      : 'toda a plataforma';

    const ok = await confirm({
      title: 'Terminar todas as sessões',
      message: `Revogar todas as sessões activas de ${scopeLabel}? A sua sessão actual será mantida.`,
      confirmLabel: 'Terminar todas',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    setRevokingAll(true);
    const res = await apiFetch<{ revoked: number }>(API_PATHS.tenants.sessionsRevokeAll, {
      method: 'POST',
      body: JSON.stringify(tenantFilter ? { tenantId: tenantFilter } : {}),
    });
    setRevokingAll(false);

    if (res.success) {
      const count = res.data?.revoked ?? 0;
      await alert({
        title: 'Sessões revogadas',
        message:
          count === 0
            ? 'Nenhuma sessão a revogar.'
            : `${count} sessão(ões) revogada(s).`,
      });
      load();
      return;
    }

    await alert({
      title: 'Não foi possível revogar',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
  }

  return (
    <>
      {alertDialog}
      {confirmDialog}
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-bold">Sessões activas</h1>
            <p className="text-slate-500">
              {isMaster
                ? 'Sessões activas de todos os tenants — revogar acessos suspeitos ou terminar todas (excepto a sua).'
                : 'Sessões activas de todos os utilizadores do tenant — revogar acessos suspeitos.'}
            </p>
          </div>
          {isMaster ? (
            <button
              type="button"
              className="btn-secondary text-sm text-red-700"
              disabled={revokingAll || loading}
              onClick={() => revokeAll()}
            >
              {revokingAll
                ? 'A terminar…'
                : tenantFilter
                  ? 'Terminar sessões do tenant'
                  : 'Terminar todas'}
            </button>
          ) : null}
        </div>

        {isMaster ? (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Filtrar tenant</label>
              <select
                className="input min-w-[240px]"
                value={tenantFilter}
                onChange={(e) => setTenantFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {tenantOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-secondary text-sm" onClick={() => load()}>
              Actualizar
            </button>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">A carregar sessões…</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : visibleSessions.length === 0 ? (
          <div className="card py-10 text-center text-sm text-slate-500">Nenhuma sessão activa.</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <ul className="divide-y divide-slate-100">
              {visibleSessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{displayUser(session)}</p>
                    <p className="text-sm text-slate-500">{session.user.email}</p>
                    {isMaster ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {session.tenantName
                          ? `${session.tenantName}${session.siteId ? ` · ${session.siteId}` : ''}`
                          : 'Sem tenant (ex. MASTER)'}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">
                      {getRoleLabel(session.user.role as Role)} ·{' '}
                      {session.deviceInfo || session.userAgent || 'Dispositivo desconhecido'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {session.ipAddress ? `IP ${session.ipAddress} · ` : ''}
                      Desde {new Date(session.createdAt).toLocaleString('pt-PT')} · Expira{' '}
                      {new Date(session.expiresAt).toLocaleString('pt-PT')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={revokingId === session.id}
                    onClick={() => revokeSession(session)}
                  >
                    {revokingId === session.id ? 'A revogar…' : 'Revogar'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
