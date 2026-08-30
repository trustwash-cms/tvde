'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getVirtualizationAlertKindLabel,
  getVirtualizationAlertLevelLabel,
  virtualizationAlertLevelClass,
  virtualizationAlertLevelDotClass,
  type VirtualizationAlertIncidentPublic,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface VirtualizationAlertsInboxProps {
  workspaceId: string;
  compact?: boolean;
}

export function VirtualizationAlertsInbox({ workspaceId, compact }: VirtualizationAlertsInboxProps) {
  const [items, setItems] = useState<VirtualizationAlertIncidentPublic[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await apiFetch<VirtualizationAlertIncidentPublic[]>(
      withWorkspaceQuery(API_PATHS.virtualization.alerts, workspaceId, { filter: 'open' }),
      {},
      getStoredToken()
    );
    if (res.data) {
      setItems(res.data);
      setError('');
    } else {
      setError(getApiErrorMessage(res) || 'Não foi possível carregar alertas');
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const act = async (id: string, path: string, body?: object) => {
    setBusyId(id);
    const res = await apiFetch<VirtualizationAlertIncidentPublic>(
      withWorkspaceQuery(path, workspaceId),
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
      getStoredToken()
    );
    setBusyId(null);
    if (res.data) {
      await load();
    } else {
      setError(getApiErrorMessage(res) || 'Acção falhou');
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar alertas…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500">Sem alertas abertos. O worker verifica PBS/PVE no intervalo configurado.</p>
    );
  }

  const visible = compact ? items.slice(0, 6) : items;

  return (
    <div className="space-y-2">
      {visible.map((item) => (
        <div
          key={item.id}
          className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${virtualizationAlertLevelDotClass(item.level)}`} />
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${virtualizationAlertLevelClass(item.level)}`}
              >
                {getVirtualizationAlertLevelLabel(item.level)}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                {getVirtualizationAlertKindLabel(item.kind)}
              </span>
              {item.status === 'acknowledged' ? (
                <span className="text-[10px] text-slate-500">reconhecido</span>
              ) : null}
              {item.status === 'silenced' ? (
                <span className="text-[10px] text-slate-500">silenciado</span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-sm font-medium text-slate-900">{item.title}</p>
            <p className="text-xs text-slate-500">
              {item.sourceLabel} · {item.message} · {formatWhen(item.lastSeenAt)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={busyId === item.id || item.status === 'acknowledged'}
              onClick={() => void act(item.id, API_PATHS.virtualization.alertAcknowledge(item.id))}
            >
              Reconhecer
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={busyId === item.id}
              onClick={() =>
                void act(item.id, API_PATHS.virtualization.alertSilence(item.id), { hours: 24 })
              }
            >
              Silenciar 24h
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={busyId === item.id}
              onClick={() => void act(item.id, API_PATHS.virtualization.alertResolve(item.id))}
            >
              Resolver
            </button>
          </div>
        </div>
      ))}
      {compact && items.length > visible.length ? (
        <p className="text-xs text-slate-500">+{items.length - visible.length} mais na página Alertas.</p>
      ) : null}
    </div>
  );
}
