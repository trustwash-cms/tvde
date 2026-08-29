'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  WEB_ROUTES,
  formatVirtualizationBytes,
  formatVirtualizationPercent,
  formatVirtualizationRatio,
  formatProxmoxAuthError,
  getVirtualizationBackupStatusLabel,
  virtualizationBackupStatusClass,
  type VirtualizationDashboardData,
  type VirtualizationSettingsPublic,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { PveGuestsModal } from './pve-guests-modal';

function formatBackupTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const BACKUPS_PAGE_SIZE = 10;

/** Preferir "VM 209" / "CT 101"; evita UPIDs longos. */
function formatBackupGuestLabel(backup: {
  backupId: string;
  name: string;
}): string {
  const name = backup.name?.trim() || '';
  if (/^(VM|CT)\s+\d+$/i.test(name)) return name.replace(/^(vm|ct)\s+/i, (m) => m.toUpperCase());
  if (/^\d+$/.test(backup.backupId) && /^(VM|CT)\b/i.test(name)) {
    return `${name.match(/^(VM|CT)/i)?.[1]?.toUpperCase() ?? 'VM'} ${backup.backupId}`;
  }
  if (/^\d+$/.test(backup.backupId)) return `VM ${backup.backupId}`;
  if (name && name !== '—' && name.length < 40) return name;
  return backup.backupId.length < 24 ? backup.backupId : '—';
}

export function VirtualizationDashboardPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [data, setData] = useState<VirtualizationDashboardData | null>(null);
  const [refreshSeconds, setRefreshSeconds] = useState(30);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupsPage, setBackupsPage] = useState(0);
  const [guestsModal, setGuestsModal] = useState<{ serverId: string; serverLabel: string } | null>(
    null
  );
  const hasLoadedRef = useRef(false);

  const loadDashboard = useCallback(
    async (force = false) => {
      if (!workspaceId) return;
      if (!hasLoadedRef.current) setLoading(true);
      try {
        const res = await apiFetch<VirtualizationDashboardData>(
          withWorkspaceQuery(API_PATHS.virtualization.dashboard, workspaceId, force ? { refresh: '1' } : undefined),
          { signal: AbortSignal.timeout(45_000) },
          getStoredToken()
        );
        if (res.data) {
          hasLoadedRef.current = true;
          setData(res.data);
          setError('');
        } else {
          setError(getApiErrorMessage(res));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro ao carregar dashboard';
        setError(
          message.includes('aborted') || message.includes('timeout')
            ? 'Timeout ao carregar dashboard — verifique se a API consegue alcançar os servidores PBS/PVE.'
            : message
        );
      } finally {
        setLoading(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    if (!workspaceId) return;
    apiFetch<VirtualizationSettingsPublic>(
      withWorkspaceQuery(API_PATHS.virtualization.settings, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data?.dashboardRefreshSeconds) {
        setRefreshSeconds(res.data.dashboardRefreshSeconds);
      }
    });
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;

    void loadDashboard(true);

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void loadDashboard(true);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void loadDashboard(false);
      }
    }, refreshSeconds * 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [workspaceId, refreshSeconds, loadDashboard]);

  if (!workspaceId) {
    return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;
  }

  if (loading && !data) {
    return <p className="text-sm text-slate-500">A carregar dashboard…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!data) {
    return null;
  }

  const hasServers = data.serversTotal > 0;

  return (
    <div className="space-y-6">
      {!hasServers ? (
        <div className="card border-dashed border-slate-300 bg-slate-50/60 p-6 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Nenhum servidor configurado</p>
          <p className="mt-1">
            Adicione servidores PBS em{' '}
            <Link
              href={WEB_ROUTES.dashboard.virtualization.configuracao}
              className="font-medium text-[var(--color-primary)] hover:underline"
            >
              Configuração
            </Link>{' '}
            ou PVE em{' '}
            <Link
              href={WEB_ROUTES.dashboard.virtualization.pve}
              className="font-medium text-[var(--color-primary)] hover:underline"
            >
              PVE
            </Link>{' '}
            para ver métricas agregadas.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card overflow-hidden border-blue-100 bg-gradient-to-br from-blue-50 to-white p-5">
          <p className="text-sm font-medium text-blue-800">Espaço usado</p>
          <p className="mt-2 text-3xl font-semibold text-blue-950">
            {formatVirtualizationBytes(data.storage.usedBytes)}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-blue-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, data.storage.usedPercent))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-blue-700">
            {formatVirtualizationPercent(data.storage.usedPercent)} de{' '}
            {formatVirtualizationBytes(data.storage.totalBytes)}
          </p>
        </div>

        <div className="card overflow-hidden border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5">
          <p className="text-sm font-medium text-emerald-800">Backups</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-950">
            {data.backupCount.toLocaleString('pt-PT')}
          </p>
          <p className="mt-4 text-xs text-emerald-700">
            {data.serversOnline}/{data.serversTotal} servidores online
          </p>
        </div>

        <div className="card overflow-hidden border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5">
          <p className="text-sm font-medium text-violet-800">Deduplicação</p>
          <p className="mt-2 text-3xl font-semibold text-violet-950">
            {formatVirtualizationRatio(data.deduplicationRatio)}
          </p>
          <p className="mt-4 text-xs text-violet-700">Média entre datastores activos</p>
        </div>
      </div>

      {(data.datastores.length > 0 || data.pveServers.length > 0) ? (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Infraestrutura</h2>
          <p className="mt-1 text-xs text-slate-500">
            PBS por datastore · PVE: clique para ver VMs/CTs (consola e SSH).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.datastores.map((ds) => (
              <div
                key={`pbs-${ds.serverId}-${ds.store}`}
                className="rounded-lg border border-slate-100 bg-slate-50/50 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-xs font-medium text-slate-900" title={ds.serverLabel}>
                    {ds.serverLabel}
                  </p>
                  <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                    PBS
                  </span>
                </div>
                <p className="truncate text-xs text-slate-500" title={ds.store}>
                  {ds.store}
                </p>
                {ds.error ? (
                  <p className="mt-2 text-xs leading-snug text-red-600">
                    {formatProxmoxAuthError(ds.error, 'pbs')}
                  </p>
                ) : (
                  <>
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <p className="text-xs text-slate-600">
                        {formatVirtualizationBytes(ds.usedBytes)} /{' '}
                        {formatVirtualizationBytes(ds.totalBytes)}
                      </p>
                      <span className="shrink-0 text-xs font-medium text-slate-700">
                        {formatVirtualizationPercent(ds.usedPercent)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, ds.usedPercent))}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            ))}

            {data.pveServers.map((pve) => (
              <button
                key={`pve-${pve.serverId}`}
                type="button"
                onClick={() =>
                  setGuestsModal({ serverId: pve.serverId, serverLabel: pve.serverLabel })
                }
                className="rounded-lg border border-orange-100 bg-orange-50/40 p-3 text-left transition hover:border-orange-200 hover:bg-orange-50/70"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-xs font-medium text-slate-900" title={pve.serverLabel}>
                    {pve.serverLabel}
                  </p>
                  <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800">
                    PVE
                  </span>
                </div>
                {pve.error ? (
                  <p className="mt-2 text-xs leading-snug text-red-600">
                    {formatProxmoxAuthError(pve.error, 'pve')}
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-slate-500">
                      {pve.vmCount} VMs · {pve.ctCount} CTs · {pve.storageCount} storages
                      {pve.nodeCount > 0 ? ` · ${pve.nodeCount} node${pve.nodeCount > 1 ? 's' : ''}` : ''}
                    </p>
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <p className="text-xs text-slate-600">
                        {formatVirtualizationBytes(pve.usedBytes)} /{' '}
                        {formatVirtualizationBytes(pve.totalBytes)}
                      </p>
                      <span className="shrink-0 text-xs font-medium text-slate-700">
                        {formatVirtualizationPercent(pve.usedPercent)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-orange-100">
                      <div
                        className="h-full rounded-full bg-orange-500 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, pve.usedPercent))}%` }}
                      />
                    </div>
                    {pve.version ? (
                      <p className="mt-2 text-[10px] text-slate-500">PVE {pve.version}</p>
                    ) : null}
                    <p className="mt-2 text-[10px] font-medium text-orange-700">
                      Ver VMs / consola / SSH
                    </p>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <PveGuestsModal
        open={Boolean(guestsModal)}
        onClose={() => setGuestsModal(null)}
        workspaceId={workspaceId}
        serverId={guestsModal?.serverId ?? null}
        serverLabel={guestsModal?.serverLabel ?? ''}
      />

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Últimos backups</h2>
          <Link
            href={WEB_ROUTES.dashboard.virtualization.pbs}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            Ver PBS
          </Link>
        </div>

        {data.latestBackups.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Sem tarefas de backup recentes.</p>
        ) : (
          (() => {
            const totalPages = Math.max(1, Math.ceil(data.latestBackups.length / BACKUPS_PAGE_SIZE));
            const page = Math.min(backupsPage, totalPages - 1);
            const slice = data.latestBackups.slice(
              page * BACKUPS_PAGE_SIZE,
              page * BACKUPS_PAGE_SIZE + BACKUPS_PAGE_SIZE
            );
            return (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="pb-3 pr-4 font-medium">VM / CT</th>
                        <th className="pb-3 pr-4 font-medium">Servidor</th>
                        <th className="pb-3 pr-4 font-medium">Data</th>
                        <th className="pb-3 pr-4 font-medium">Tamanho</th>
                        <th className="pb-3 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {slice.map((backup, index) => (
                        <tr key={`${backup.serverId}-${backup.backupId}-${page}-${index}`}>
                          <td className="py-3 pr-4 font-medium text-slate-900">
                            {formatBackupGuestLabel(backup)}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">{backup.serverLabel}</td>
                          <td className="py-3 pr-4 text-slate-600">
                            {formatBackupTime(backup.backupTime)}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">
                            {backup.sizeBytes != null
                              ? formatVirtualizationBytes(backup.sizeBytes)
                              : '—'}
                          </td>
                          <td className={`py-3 ${virtualizationBackupStatusClass(backup.status)}`}>
                            {getVirtualizationBackupStatusLabel(backup.status)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 ? (
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-600">
                    <span>
                      {page * BACKUPS_PAGE_SIZE + 1}–
                      {Math.min((page + 1) * BACKUPS_PAGE_SIZE, data.latestBackups.length)} de{' '}
                      {data.latestBackups.length}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        disabled={page <= 0}
                        onClick={() => setBackupsPage((p) => Math.max(0, p - 1))}
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2 py-1 text-xs"
                        disabled={page >= totalPages - 1}
                        onClick={() => setBackupsPage((p) => Math.min(totalPages - 1, p + 1))}
                      >
                        Seguinte
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    A mostrar os {data.latestBackups.length} backups mais recentes.
                  </p>
                )}
              </>
            );
          })()
        )}
      </div>

      {data.recentFailures.length > 0 ? (
        <div className="card border-red-100 bg-red-50/40 p-5">
          <h2 className="text-sm font-semibold text-red-900">Falhas recentes</h2>
          <ul className="mt-3 space-y-2 text-sm text-red-800">
            {data.recentFailures.map((failure, index) => (
              <li key={`${failure.serverId}-${failure.backupId}-${index}`}>
                <span className="font-medium">
                  {failure.serverLabel} — {formatBackupGuestLabel(failure)}
                </span>
                {failure.errorMessage ? (
                  <span className="text-red-700"> — {failure.errorMessage}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
