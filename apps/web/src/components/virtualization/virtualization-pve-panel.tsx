'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  formatProxmoxAuthError,
  formatVirtualizationBytes,
  formatVirtualizationPercent,
  normalizePveApiTokenSecret,
  type VirtualizationPveServerDetail,
  type VirtualizationPveServerPublic,
  type VirtualizationPveStorageSummary,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { NoAutofillSecretInput } from '@/components/whatsapp/no-autofill-field';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface ServerFormState {
  label: string;
  tags: string;
  baseUrl: string;
  apiTokenId: string;
  apiTokenSecret: string;
  verifySsl: boolean;
  isActive: boolean;
}

const emptyServerForm: ServerFormState = {
  label: '',
  tags: '',
  baseUrl: 'https://',
  apiTokenId: '',
  apiTokenSecret: '',
  verifySsl: false,
  isActive: true,
};

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

function PveStorageCards({ storages }: { storages: VirtualizationPveStorageSummary[] }) {
  if (storages.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">Sem storages disponíveis.</p>;
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {storages.map((storage) => (
        <div
          key={`${storage.storage}-${storage.node ?? ''}`}
          className="rounded-lg border border-slate-100 bg-slate-50/50 p-3"
        >
          <p className="truncate text-xs font-medium text-slate-900" title={storage.storage}>
            {storage.storage}
          </p>
          <p className="truncate text-xs text-slate-500">
            {storage.node ? `${storage.node}` : '—'}
            {storage.plugintype ? ` · ${storage.plugintype}` : ''}
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="text-xs text-slate-600">
              {formatVirtualizationBytes(storage.usedBytes)} /{' '}
              {formatVirtualizationBytes(storage.totalBytes)}
            </p>
            <span className="shrink-0 text-xs font-medium text-slate-700">
              {formatVirtualizationPercent(storage.usedPercent)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-orange-100">
            <div
              className="h-full rounded-full bg-orange-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, storage.usedPercent))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function VirtualizationPvePanel() {
  const searchParams = useSearchParams();
  const focusServerId = searchParams.get('server');
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [servers, setServers] = useState<VirtualizationPveServerPublic[]>([]);
  const [details, setDetails] = useState<Record<string, VirtualizationPveServerDetail>>({});
  const [serverForm, setServerForm] = useState<ServerFormState>(emptyServerForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOriginalTokenId, setEditingOriginalTokenId] = useState('');
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [modalError, setModalError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<
    Record<string, { type: 'success' | 'error'; message: string }>
  >({});
  const submittingRef = useRef(false);

  const loadServers = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    const res = await apiFetch<VirtualizationPveServerPublic[]>(
      withWorkspaceQuery(API_PATHS.virtualization.pveServers, workspaceId),
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
      const res = await apiFetch<VirtualizationPveServerDetail>(
        withWorkspaceQuery(API_PATHS.virtualization.pveServerDetail(serverId), workspaceId),
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

  useEffect(() => {
    if (!focusServerId) return;
    const element = document.getElementById(`pve-server-${focusServerId}`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.classList.add('ring-2', 'ring-orange-300', 'ring-offset-2');
    const timeout = window.setTimeout(() => {
      element.classList.remove('ring-2', 'ring-orange-300', 'ring-offset-2');
    }, 2500);
    return () => window.clearTimeout(timeout);
  }, [focusServerId, servers, details]);

  const closeServerModal = () => {
    setServerModalOpen(false);
    setModalError('');
    setEditingId(null);
    setEditingOriginalTokenId('');
    setServerForm(emptyServerForm);
  };

  const openAddModal = () => {
    setEditingId(null);
    setEditingOriginalTokenId('');
    setServerForm(emptyServerForm);
    setModalError('');
    setServerModalOpen(true);
  };

  const openEditModal = (server: VirtualizationPveServerPublic) => {
    setEditingId(server.id);
    setEditingOriginalTokenId(server.apiTokenId ?? '');
    setServerForm({
      label: server.label,
      tags: server.tags.join(', '),
      baseUrl: server.baseUrl,
      apiTokenId: server.apiTokenId ?? '',
      apiTokenSecret: '',
      verifySsl: server.verifySsl,
      isActive: server.isActive,
    });
    setModalError('');
    setServerModalOpen(true);
  };

  const handleServerSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || submittingRef.current || busy) return;

    const tokenId = serverForm.apiTokenId.trim();
    const tokenSecret = normalizePveApiTokenSecret(serverForm.apiTokenSecret);

    if (!editingId && (!tokenId || !tokenSecret)) {
      setModalError('Token ID e Secret são obrigatórios ao adicionar um servidor.');
      return;
    }

    if (editingId && tokenId !== editingOriginalTokenId && !tokenSecret) {
      setModalError('Ao alterar o Token ID, tem de voltar a introduzir o Secret.');
      return;
    }

    const wasCreate = !editingId;
    submittingRef.current = true;
    setBusy(true);
    setModalError('');
    setError('');
    setMessage('');

    try {
      const tags = serverForm.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      const payload = {
        label: serverForm.label,
        tags,
        baseUrl: serverForm.baseUrl.trim().replace(/\/+$/, ''),
        verifySsl: serverForm.verifySsl,
        isActive: serverForm.isActive,
        ...(tokenId && tokenSecret
          ? {
              apiTokenId: tokenId,
              apiTokenSecret: tokenSecret,
            }
          : {}),
      };

      const res = editingId
        ? await apiFetch<VirtualizationPveServerPublic>(
            withWorkspaceQuery(API_PATHS.virtualization.pveServerById(editingId), workspaceId),
            { method: 'PATCH', body: JSON.stringify(payload) },
            getStoredToken()
          )
        : await apiFetch<VirtualizationPveServerPublic>(
            withWorkspaceQuery(API_PATHS.virtualization.pveServers, workspaceId),
            {
              method: 'POST',
              body: JSON.stringify({
                ...payload,
                apiTokenId: tokenId,
                apiTokenSecret: tokenSecret,
              }),
            },
            getStoredToken()
          );

      if (!res.data) {
        setModalError(getApiErrorMessage(res));
        return;
      }

      const serverId = res.data.id;
      if (wasCreate) {
        setEditingId(serverId);
        setEditingOriginalTokenId(res.data.apiTokenId ?? tokenId);
      }

      const testRes = await apiFetch<{ ok: true; version: string; nodes: string[] }>(
        withWorkspaceQuery(API_PATHS.virtualization.pveServerTest(serverId), workspaceId),
        { method: 'POST' },
        getStoredToken()
      );

      if (testRes.data?.ok) {
        const nodeHint =
          testRes.data.nodes.length > 0 ? ` Nodes: ${testRes.data.nodes.join(', ')}.` : '';
        setMessage(
          `${wasCreate ? 'Servidor adicionado' : 'Servidor actualizado'} — ligação OK (PVE ${testRes.data.version}).${nodeHint}`
        );
        closeServerModal();
        await loadServers();
      } else {
        setModalError(
          `Ligação falhou: ${formatProxmoxAuthError(getApiErrorMessage(testRes), 'pve')}`
        );
        setServerForm((prev) => ({
          ...prev,
          apiTokenId: res.data?.apiTokenId ?? tokenId,
          apiTokenSecret: '',
        }));
        await loadServers();
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Remover servidor PVE',
      message: 'Remover este servidor PVE?',
      variant: 'danger',
      confirmLabel: 'Remover',
    });
    if (!ok) return;

    setBusy(true);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.virtualization.pveServerById(serverId), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    await loadServers();
  };

  const handleTest = async (serverId: string) => {
    if (!workspaceId) return;
    setTestingId(serverId);
    setTestFeedback((prev) => {
      const next = { ...prev };
      delete next[serverId];
      return next;
    });

    const res = await apiFetch<{ ok: true; version: string; nodes: string[] }>(
      withWorkspaceQuery(API_PATHS.virtualization.pveServerTest(serverId), workspaceId),
      { method: 'POST' },
      getStoredToken()
    );

    if (res.data?.ok) {
      const data = res.data;
      const nodeHint =
        data.nodes.length > 0 ? ` Nodes: ${data.nodes.join(', ')}.` : '';
      setTestFeedback((prev) => ({
        ...prev,
        [serverId]: {
          type: 'success',
          message: `Ligação OK — PVE ${data.version}.${nodeHint}`,
        },
      }));
      await loadServers();
      await loadDetail(serverId);
    } else {
      setTestFeedback((prev) => ({
        ...prev,
        [serverId]: {
          type: 'error',
          message: formatProxmoxAuthError(getApiErrorMessage(res), 'pve'),
        },
      }));
    }
    setTestingId(null);
  };

  if (!workspaceId) {
    return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;
  }

  if (loading && servers.length === 0) {
    return <p className="text-sm text-slate-500">A carregar servidores PVE…</p>;
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Servidores PVE</h2>
            <p className="mt-1 text-sm text-slate-500">
              Proxmox Virtual Environment (porta 8006). API diferente do PBS — usa{' '}
              <code className="text-xs">PVEAPIToken=…=…</code> (igual entre ID e secret).
            </p>
          </div>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openAddModal}>
            <Plus size={16} />
            Adicionar servidor
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Nenhum servidor PVE configurado. Crie um API Token em Datacenter → Permissions → API Tokens.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {servers.map((server) => {
              const detail = details[server.id];
              const feedback = testFeedback[server.id];
              return (
                <div
                  key={server.id}
                  id={`pve-server-${server.id}`}
                  className="scroll-mt-6 rounded-lg border border-slate-100 p-4 transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{server.label}</h3>
                        {!server.isActive ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            Inactivo
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{server.baseUrl}</p>
                      {server.lastError ? (
                        <p className="mt-2 text-xs text-red-600">
                          {formatProxmoxAuthError(server.lastError, 'pve')}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={() => openEditModal(server)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={() => void handleTest(server.id)}
                        disabled={testingId === server.id}
                      >
                        {testingId === server.id ? 'A testar…' : 'Testar ligação'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-sm text-red-700"
                        onClick={() => void handleDeleteServer(server.id)}
                        disabled={busy}
                      >
                        Remover
                      </button>
                    </div>
                  </div>

                  {feedback ? (
                    <p
                      className={`mt-3 text-xs ${
                        feedback.type === 'success' ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {feedback.message}
                    </p>
                  ) : null}

                  {detail ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Versão</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {detail.version ?? '—'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Nodes</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {detail.nodes.length > 0
                            ? detail.nodes.map((node) => node.node).join(', ')
                            : '—'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">VMs / CTs</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {detail.vmCount} / {detail.ctCount}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Memória (1.º node)</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {detail.nodes[0]
                            ? `${formatVirtualizationBytes(detail.nodes[0].mem)} / ${formatVirtualizationBytes(detail.nodes[0].maxmem)}`
                            : '—'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">A carregar métricas…</p>
                  )}

                  {detail && detail.storages.length > 0 ? (
                    <div className="mt-5">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Storages
                      </h4>
                      <PveStorageCards storages={detail.storages} />
                    </div>
                  ) : null}

                  {detail && detail.nodes.length > 0 ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="pb-2 pr-4 font-medium">Node</th>
                            <th className="pb-2 pr-4 font-medium">Estado</th>
                            <th className="pb-2 pr-4 font-medium">CPU</th>
                            <th className="pb-2 pr-4 font-medium">RAM</th>
                            <th className="pb-2 font-medium">Uptime</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {detail.nodes.map((node) => (
                            <tr key={node.node}>
                              <td className="py-2 pr-4 font-medium text-slate-900">{node.node}</td>
                              <td className="py-2 pr-4 text-slate-600">{node.status}</td>
                              <td className="py-2 pr-4 text-slate-600">
                                {node.maxcpu > 0
                                  ? `${Math.round((node.cpu / node.maxcpu) * 100)}%`
                                  : '—'}
                              </td>
                              <td className="py-2 pr-4 text-slate-600">
                                {node.maxmem > 0
                                  ? `${formatVirtualizationBytes(node.mem)} / ${formatVirtualizationBytes(node.maxmem)}`
                                  : '—'}
                              </td>
                              <td className="py-2 text-slate-600">{formatUptime(node.uptime)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={serverModalOpen}
        onClose={closeServerModal}
        title={editingId ? 'Editar servidor PVE' : 'Adicionar servidor PVE'}
        panelClassName="max-w-2xl"
        scrollBody
        showCloseButton
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={closeServerModal} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="virtualization-pve-server-form" className="btn-primary" disabled={busy}>
              {busy ? 'A guardar…' : editingId ? 'Guardar alterações' : 'Adicionar servidor'}
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-500">
          No PVE, o Token ID completo é <strong>utilizador!nome</strong>, por exemplo{' '}
          <code className="text-xs">root@pam!PVEcv</code> (como no ecrã de edição do token).
        </p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
          <p className="font-medium">Diferença face ao PBS</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Porta habitual: <strong>8006</strong> (PBS usa 8007)</li>
            <li>Header: <code className="text-xs">PVEAPIToken=root@pam!token=secret</code> (igual, não dois pontos)</li>
            <li>Permissões: Datacenter → Permissions → API Token com role adequada</li>
          </ul>
        </div>

        {modalError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {modalError}
          </div>
        ) : null}

        <form
          id="virtualization-pve-server-form"
          onSubmit={handleServerSubmit}
          className="mt-5 grid gap-4 md:grid-cols-2"
        >
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Etiqueta</span>
            <input
              className="input w-full"
              value={serverForm.label}
              onChange={(e) => setServerForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="PVE Cesario"
              required
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Tags (separadas por vírgula)</span>
            <input
              className="input w-full"
              value={serverForm.tags}
              onChange={(e) => setServerForm((prev) => ({ ...prev, tags: e.target.value }))}
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-700">URL base</span>
            <input
              className="input w-full"
              value={serverForm.baseUrl}
              onChange={(e) => setServerForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://192.168.x.x:8006"
              required
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-700">Token ID</span>
            <input
              className="input w-full font-mono text-sm"
              value={serverForm.apiTokenId}
              onChange={(e) => setServerForm((prev) => ({ ...prev, apiTokenId: e.target.value }))}
              placeholder="root@pam!PVEcv"
              required={!editingId}
              autoComplete="off"
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-700">
              Secret {editingId ? '(obrigatório para actualizar credenciais)' : ''}
            </span>
            <NoAutofillSecretInput
              className="input w-full font-mono text-sm"
              value={serverForm.apiTokenSecret}
              onChange={(e) =>
                setServerForm((prev) => ({ ...prev, apiTokenSecret: e.target.value }))
              }
              placeholder="uuid-do-secret"
              required={!editingId}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={serverForm.verifySsl}
              onChange={(e) => setServerForm((prev) => ({ ...prev, verifySsl: e.target.checked }))}
            />
            Verificar certificado SSL
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={serverForm.isActive}
              onChange={(e) => setServerForm((prev) => ({ ...prev, isActive: e.target.checked }))}
            />
            Servidor activo
          </label>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
