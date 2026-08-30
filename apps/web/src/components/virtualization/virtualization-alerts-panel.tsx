'use client';

import { useCallback, useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { VirtualizationAlertsInbox } from '@/components/virtualization/virtualization-alerts-inbox';

export function VirtualizationAlertsPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const runNow = useCallback(async () => {
    if (!workspaceId) return;
    setBusy(true);
    setError('');
    setMessage('');
    const res = await apiFetch<{ opened: number; resolved: number; notified: number }>(
      withWorkspaceQuery(API_PATHS.virtualization.alertsEvaluate, workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setBusy(false);
    if (res.data) {
      setMessage(
        `Verificação concluída: ${res.data.opened} abertos, ${res.data.resolved} resolvidos, ${res.data.notified} notificações.`
      );
    } else {
      setError(getApiErrorMessage(res) || 'Falha ao avaliar alertas');
    }
  }, [workspaceId]);

  if (!workspaceId) {
    return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Alertas</h2>
          <p className="text-sm text-slate-500">
            Incidentes abertos de nodes, storage, backups e VMs. Email/WhatsApp seguem as definições em
            Configuração.
          </p>
        </div>
        <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void runNow()}>
          {busy ? 'A verificar…' : 'Verificar agora'}
        </button>
      </div>
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      ) : null}
      <VirtualizationAlertsInbox workspaceId={workspaceId} />
    </div>
  );
}
