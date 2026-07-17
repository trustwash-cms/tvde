'use client';

import { useEffect, useState } from 'react';
import { API_PATHS, getRoleLabel, type Role } from '@tvde/shared';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import { useAlertDialog } from '@/hooks/use-alert-dialog';

interface TenantSessionItem {
  id: string;
  userId: string;
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
  const [sessions, setSessions] = useState<TenantSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const { alert, alertDialog } = useAlertDialog();

  function load() {
    setLoading(true);
    setError('');
    apiFetch<TenantSessionItem[]>(API_PATHS.tenants.currentSessions).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setSessions(res.data);
        return;
      }
      setError(getApiErrorMessage(res));
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function revokeSession(session: TenantSessionItem) {
    const ok = window.confirm(`Revogar sessão de ${displayUser(session)}?`);
    if (!ok) return;

    setRevokingId(session.id);
    const res = await apiFetch(API_PATHS.tenants.currentSessionById(session.id), {
      method: 'DELETE',
    });
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

  return (
    <>
      {alertDialog}
      <div className="space-y-6">
        <div>
          <h1 className="mb-2 text-2xl font-bold">Sessões activas</h1>
          <p className="text-slate-500">
            Sessões activas de todos os utilizadores do tenant — revogar acessos suspeitos.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">A carregar sessões…</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : sessions.length === 0 ? (
          <div className="card py-10 text-center text-sm text-slate-500">Nenhuma sessão activa.</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <ul className="divide-y divide-slate-100">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{displayUser(session)}</p>
                    <p className="text-sm text-slate-500">{session.user.email}</p>
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
