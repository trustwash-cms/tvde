'use client';

import { useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  ipAddress: string | null;
  createdAt: string;
  afterJson?: Record<string, unknown> | null;
  beforeJson?: Record<string, unknown> | null;
  user?: { email: string } | null;
}

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Login',
  'auth.logout': 'Logout',
  'auth.impersonation_start': 'Personificação iniciada',
  'auth.impersonation_stop': 'Personificação terminada',
  'auth.password_reset_requested': 'Pedido de reset de password',
  'auth.password_reset_completed': 'Password redefinida',
  'auth.password_changed': 'Password alterada',
  'auth.2fa_enabled': '2FA activado',
  'auth.2fa_disabled': '2FA desactivado',
  'auth.2fa_verified': '2FA verificado',
  'auth.2fa_failed': '2FA falhou',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function detailText(log: AuditLog): string | null {
  const after = log.afterJson;
  if (!after || typeof after !== 'object') return null;

  if (log.action === 'auth.impersonation_start') {
    const email = typeof after.targetEmail === 'string' ? after.targetEmail : null;
    const role = typeof after.targetRole === 'string' ? after.targetRole : null;
    if (email && role) return `Alvo: ${email} (${role})`;
    if (email) return `Alvo: ${email}`;
  }

  if (log.action === 'auth.impersonation_stop') {
    const email = typeof after.targetEmail === 'string' ? after.targetEmail : null;
    const role = typeof after.targetRole === 'string' ? after.targetRole : null;
    if (email && role) return `Alvo: ${email} (${role})`;
    if (email) return `Alvo: ${email}`;
    const targetId = typeof after.targetUserId === 'string' ? after.targetUserId : null;
    if (targetId) return `Alvo ID: ${targetId.slice(0, 8)}…`;
  }

  if (typeof after.targetEmail === 'string') return String(after.targetEmail);
  if (typeof after.email === 'string') return String(after.email);
  if (typeof after.fileName === 'string') return String(after.fileName);

  return null;
}

export function SettingsAuditPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    apiFetch<AuditLog[]>(API_PATHS.auditLogs.list, {}, getStoredToken()).then((res) => {
      if (res.data) setLogs(res.data);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Audit Log</h2>
        <p className="mt-1 text-sm text-slate-500">Registo imutável de acções sensíveis</p>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-6 py-3">Data</th>
              <th className="px-6 py-3">Acção</th>
              <th className="px-6 py-3">Detalhe</th>
              <th className="px-6 py-3">Entidade</th>
              <th className="px-6 py-3">Utilizador</th>
              <th className="px-6 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const detail = detailText(log);
              const isImpersonation = log.action.startsWith('auth.impersonation_');
              return (
                <tr
                  key={log.id}
                  className={
                    isImpersonation
                      ? 'border-b bg-amber-50/60 last:border-0'
                      : 'border-b last:border-0'
                  }
                >
                  <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                    {new Date(log.createdAt).toLocaleString('pt-PT')}
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-800">{actionLabel(log.action)}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400">{log.action}</div>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{detail ?? '—'}</td>
                  <td className="px-6 py-4">{log.entityType}</td>
                  <td className="px-6 py-4">{log.user?.email ?? '—'}</td>
                  <td className="px-6 py-4 font-mono text-xs">{log.ipAddress ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="py-10 text-center text-slate-400">Sem registos</div>
        )}
      </div>
    </div>
  );
}
