'use client';

import { useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  ipAddress: string | null;
  createdAt: string;
  user?: { email: string } | null;
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
              <th className="px-6 py-3">Entidade</th>
              <th className="px-6 py-3">Utilizador</th>
              <th className="px-6 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b last:border-0">
                <td className="px-6 py-4 text-slate-500">
                  {new Date(log.createdAt).toLocaleString('pt-PT')}
                </td>
                <td className="px-6 py-4 font-mono text-xs">{log.action}</td>
                <td className="px-6 py-4">{log.entityType}</td>
                <td className="px-6 py-4">{log.user?.email ?? '—'}</td>
                <td className="px-6 py-4 font-mono text-xs">{log.ipAddress ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="py-10 text-center text-slate-400">Sem registos</div>
        )}
      </div>
    </div>
  );
}
