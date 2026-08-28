'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  formatProxmoxAuthError,
  formatVirtualizationBytes,
  formatVirtualizationPercent,
  type VirtualizationPbsServerDetail,
  type VirtualizationPbsServerPublic,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';

export function VirtualizationPbsPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [servers, setServers] = useState<VirtualizationPbsServerPublic[]>([]);
  const [details, setDetails] = useState<Record<string, VirtualizationPbsServerDetail>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<
    Record<string, { type: 'success' | 'error'; message: string }>
  >({});

  const loadServers = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const res = await apiFetch<VirtualizationPbsServerPublic[]>(
      withWorkspaceQuery(API_PATHS.virtualization.pbsServers, workspaceId),
      {},
      getStoredToken()
    );
    if (res.data) {
      setServers(res.data);
      setError('');
    } else {
      setError(getApiErrorMessage(res));
    }
    setLoading(false);
  }, [workspaceId]);

  const loadDetail = useCallback(
    async (serverId: string) => {
      if (!workspaceId) return;
      const res = await apiFetch<VirtualizationPbsServerDetail>(
        withWorkspaceQuery(API_PATHS.virtualization.pbsServerDetail(serverId), workspaceId),
        {},
        getStoredToken()
      );
      if (res.data) {
        setDetails((prev) => ({ ...prev, [serverId]: res.data! }));
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  useEffect(() => {
    if (!workspaceId || servers.length === 0) return;
    for (const server of servers) {
      void loadDetail(server.id);
    }
  }, [workspaceId, servers, loadDetail]);

  const handleTest = async (serverId: string) => {
    if (!workspaceId) return;
    setTestingId(serverId);
    setTestFeedback((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });
    setError('');

    const res = await apiFetch<{ ok: true; version: string; datastores: string[] }>(
      withWorkspaceQuery(API_PATHS.virtualization.pbsServerTest(serverId), workspaceId),
      { method: 'POST' },
      getStoredToken()
    );

    if (res.data?.ok) {
      const data = res.data;
      const stores = data.datastores;
      const storeHint =
        stores.length > 0 ? ` Datastores: ${stores.join(', ')}.` : '';
      setTestFeedback((prev) => ({
        ...prev,
        [serverId]: {
          type: 'success',
          message: `Ligação OK — PBS ${data.version}.${storeHint}`,
        },
      }));
      await loadServers();
      await loadDetail(serverId);
    } else {
      const message = formatProxmoxAuthError(getApiErrorMessage(res));
      setTestFeedback((prev) => ({
        ...prev,
        [serverId]: { type: 'error', message },
      }));
      setError(message);
    }
    setTestingId(null);
  };

  if (!workspaceId) {
    return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;
  }

  if (loading && servers.length === 0) {
    return <p className="text-sm text-slate-500">A carregar servidores PBS…</p>;
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {servers.length === 0 ? (
        <div className="card border-dashed border-slate-300 bg-slate-50/60 p-6 text-sm text-slate-600">
          Nenhum servidor PBS configurado. Adicione servidores em Configuração.
        </div>
      ) : (
        <div className="space-y-4">
          {servers.map((server) => {
            const detail = details[server.id];
            const status = detail?.datastoreStatus;
            const feedback = testFeedback[server.id];
            return (
              <div key={server.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">{server.label}</h2>
                      {!server.isActive ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          Inactivo
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{server.baseUrl}</p>
                    {server.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {server.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex min-w-[11rem] flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTest(server.id)}
                      disabled={testingId === server.id}
                      className="btn-secondary text-sm"
                    >
                      {testingId === server.id ? 'A testar…' : 'Testar ligação'}
                    </button>
                    {feedback ? (
                      <p
                        className={`max-w-xs text-right text-xs leading-snug ${
                          feedback.type === 'success' ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {feedback.message}
                      </p>
                    ) : null}
                  </div>
                </div>

                {server.lastError ? (
                  <p className="mt-3 text-sm text-red-600">{server.lastError}</p>
                ) : null}

                {status ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Datastore</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{status.store}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Espaço usado</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {status.error
                          ? '—'
                          : `${formatVirtualizationBytes(status.usedBytes)} (${formatVirtualizationPercent(status.usedPercent)})`}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Grupos</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {detail?.groupsCount ?? '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Snapshots</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {detail?.snapshotsCount ?? '—'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">A carregar métricas…</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
