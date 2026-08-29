'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  formatProxmoxAuthError,
  formatVirtualizationBytes,
  formatVirtualizationPercent,
  isLikelyPveBaseUrl,
  normalizePbsApiTokenSecret,
  type VirtualizationPbsServerDetail,
  type VirtualizationPbsServerPublic,
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
  datastore: string;
  apiTokenId: string;
  apiTokenSecret: string;
  verifySsl: boolean;
  isActive: boolean;
}

const emptyServerForm: ServerFormState = {
  label: '',
  tags: '',
  baseUrl: 'https://',
  datastore: '',
  apiTokenId: '',
  apiTokenSecret: '',
  verifySsl: false,
  isActive: true,
};

export function VirtualizationPbsPanel() {
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [servers, setServers] = useState<VirtualizationPbsServerPublic[]>([]);
  const [details, setDetails] = useState<Record<string, VirtualizationPbsServerDetail>>({});
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
  const [savingPhase, setSavingPhase] = useState<'idle' | 'saving' | 'testing'>('idle');
  const submittingRef = useRef(false);

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

  const openEditModal = (server: VirtualizationPbsServerPublic) => {
    setEditingId(server.id);
    setEditingOriginalTokenId(server.apiTokenId ?? '');
    setServerForm({
      label: server.label,
      tags: server.tags.join(', '),
      baseUrl: server.baseUrl,
      datastore: server.datastore,
      apiTokenId: server.apiTokenId ?? '',
      apiTokenSecret: '',
      verifySsl: server.verifySsl,
      isActive: server.isActive,
    });
    setModalError('');
    setServerModalOpen(true);
  };

  const handleServerSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!workspaceId) {
      setModalError('Seleccione um workspace antes de guardar.');
      return;
    }
    if (submittingRef.current || busy) return;

    const tokenId = serverForm.apiTokenId.trim();
    const tokenSecret = normalizePbsApiTokenSecret(serverForm.apiTokenSecret);
    const label = serverForm.label.trim();
    const datastore = serverForm.datastore.trim();
    const baseUrl = serverForm.baseUrl.trim().replace(/\/+$/, '');

    if (!label) {
      setModalError('A etiqueta é obrigatória.');
      return;
    }
    if (!baseUrl) {
      setModalError('A URL base é obrigatória.');
      return;
    }
    if (!datastore) {
      setModalError('O datastore é obrigatório.');
      return;
    }
    if (!editingId && (!tokenId || !tokenSecret)) {
      setModalError('Token ID e Secret são obrigatórios ao adicionar um servidor.');
      return;
    }

    if (editingId && tokenId !== editingOriginalTokenId && !tokenSecret) {
      setModalError(
        'Ao alterar o Token ID, tem de voltar a introduzir o Secret (só é mostrado uma vez no PBS).'
      );
      return;
    }

    if (isLikelyPveBaseUrl(baseUrl)) {
      setModalError(
        'URL com porta 8006 é Proxmox VE. Adicione-o no separador PVE — as credenciais estão correctas, só estão no sítio errado.'
      );
      return;
    }

    const wasCreate = !editingId;
    submittingRef.current = true;
    setBusy(true);
    setSavingPhase('saving');
    setModalError('');
    setError('');
    setMessage('');

    try {
      const tags = serverForm.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      const payload = {
        label,
        tags,
        baseUrl,
        datastore,
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
        ? await apiFetch<VirtualizationPbsServerPublic>(
            withWorkspaceQuery(API_PATHS.virtualization.pbsServerById(editingId), workspaceId),
            { method: 'PATCH', body: JSON.stringify(payload) },
            getStoredToken()
          )
        : await apiFetch<VirtualizationPbsServerPublic>(
            withWorkspaceQuery(API_PATHS.virtualization.pbsServers, workspaceId),
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
        setModalError(getApiErrorMessage(res) || 'Não foi possível guardar o servidor.');
        return;
      }

      const serverId = res.data.id;
      if (wasCreate) {
        setEditingId(serverId);
        setEditingOriginalTokenId(res.data.apiTokenId ?? tokenId);
      }

      setSavingPhase('testing');
      const testRes = await apiFetch<{ ok: true; version: string; datastores: string[] }>(
        withWorkspaceQuery(API_PATHS.virtualization.pbsServerTest(serverId), workspaceId),
        { method: 'POST' },
        getStoredToken()
      );

      if (testRes.data?.ok) {
        const stores = testRes.data.datastores;
        const storeHint = stores.length > 0 ? ` Datastores: ${stores.join(', ')}.` : '';
        setMessage(
          `${wasCreate ? 'Servidor adicionado' : 'Servidor actualizado'} — ligação OK (PBS ${testRes.data.version}).${storeHint}`
        );
        closeServerModal();
        await loadServers();
      } else {
        const tokenHint = tokenId
          ? ` Em Permissions, o API Token tem de ser exactamente «${tokenId}» (não outro nome).`
          : '';
        setModalError(
          `Guardado, mas a ligação falhou: ${formatProxmoxAuthError(getApiErrorMessage(testRes), 'pbs')}.${tokenHint}`
        );
        setServerForm((prev) => ({
          ...prev,
          apiTokenId: res.data?.apiTokenId ?? tokenId,
          apiTokenSecret: '',
        }));
        await loadServers();
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro ao guardar o servidor.');
    } finally {
      submittingRef.current = false;
      setBusy(false);
      setSavingPhase('idle');
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Remover servidor PBS',
      message: 'Remover este servidor PBS?',
      variant: 'danger',
      confirmLabel: 'Remover',
    });
    if (!ok) return;

    setBusy(true);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.virtualization.pbsServerById(serverId), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    setMessage('Servidor removido.');
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
    setError('');

    const res = await apiFetch<{ ok: true; version: string; datastores: string[] }>(
      withWorkspaceQuery(API_PATHS.virtualization.pbsServerTest(serverId), workspaceId),
      { method: 'POST' },
      getStoredToken()
    );

    if (res.data?.ok) {
      const data = res.data;
      const stores = data.datastores;
      const storeHint = stores.length > 0 ? ` Datastores: ${stores.join(', ')}.` : '';
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
      const message = formatProxmoxAuthError(getApiErrorMessage(res), 'pbs');
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
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Servidores PBS</h2>
            <p className="mt-1 text-sm text-slate-500">
              Proxmox Backup Server (porta 8007). API diferente do PVE — usa{' '}
              <code className="text-xs">PBSAPIToken=…:…</code> (dois pontos entre ID e secret).
            </p>
          </div>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openAddModal}>
            <Plus size={16} />
            Adicionar servidor
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Nenhum servidor PBS configurado. Crie um API Token em Configuration → Access Control → API
            Tokens.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {servers.map((server) => {
              const detail = details[server.id];
              const status = detail?.datastoreStatus;
              const feedback = testFeedback[server.id];
              return (
                <div key={server.id} className="rounded-lg border border-slate-100 p-4">
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
                      <p className="mt-1 text-xs text-slate-500">
                        {server.baseUrl} · {server.datastore}
                      </p>
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
                      {server.lastError ? (
                        <p className="mt-2 text-xs text-red-600">
                          {formatProxmoxAuthError(server.lastError, 'pbs')}
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

                  {status ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      </section>

      <Modal
        open={serverModalOpen}
        onClose={closeServerModal}
        title={editingId ? 'Editar servidor PBS' : 'Adicionar servidor PBS'}
        panelClassName="max-w-2xl"
        scrollBody
        showCloseButton
        footer={
          <div className="space-y-3">
            {modalError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {modalError}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={closeServerModal} disabled={busy}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void handleServerSubmit()}
              >
                {savingPhase === 'testing'
                  ? 'A testar ligação…'
                  : busy
                    ? 'A guardar…'
                    : editingId
                      ? 'Guardar alterações'
                      : 'Adicionar servidor'}
              </button>
            </div>
          </div>
        }
      >
        <p className="text-sm text-slate-500">
          Crie o token em <strong>Configuration → Access Control → API Tokens</strong> e atribua
          permissões em <strong>Permissions</strong>.
        </p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
          <p className="font-medium">Passos obrigatórios no PBS</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong>API Tokens</strong> — criar token (ex. <code className="text-xs">tvde</code>) e
              copiar o Secret.
            </li>
            <li>
              <strong>Permissions</strong> — Path <code className="text-xs">/</code> → API Token{' '}
              <code className="text-xs">root@pam!tvde</code> → Role{' '}
              <code className="text-xs">Admin</code> → Propagate <strong>Yes</strong>.
            </li>
          </ol>
        </div>

        <form
          id="virtualization-pbs-server-form"
          onSubmit={(e) => void handleServerSubmit(e)}
          className="mt-5 grid gap-4 md:grid-cols-2"
        >
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Etiqueta</span>
            <input
              className="input w-full"
              value={serverForm.label}
              onChange={(e) => setServerForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="PBS Cesario Verde"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Tags (separadas por vírgula)</span>
            <input
              className="input w-full"
              value={serverForm.tags}
              onChange={(e) => setServerForm((prev) => ({ ...prev, tags: e.target.value }))}
              placeholder="WHM, MDCluster"
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-700">URL base</span>
            <input
              className="input w-full"
              value={serverForm.baseUrl}
              onChange={(e) => setServerForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://192.168.221.250:8007"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Datastore</span>
            <input
              className="input w-full"
              value={serverForm.datastore}
              onChange={(e) => setServerForm((prev) => ({ ...prev, datastore: e.target.value }))}
              placeholder="ex. CVStorage01"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Token ID</span>
            <input
              className="input w-full font-mono text-sm"
              value={serverForm.apiTokenId}
              onChange={(e) => setServerForm((prev) => ({ ...prev, apiTokenId: e.target.value }))}
              placeholder="root@pam!tvde"
              autoComplete="off"
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-700">
              Secret {editingId ? '(deixe vazio para manter)' : ''}
            </span>
            <NoAutofillSecretInput
              className="input w-full font-mono text-sm"
              value={serverForm.apiTokenSecret}
              onChange={(e) =>
                setServerForm((prev) => ({ ...prev, apiTokenSecret: e.target.value }))
              }
              placeholder="uuid-do-secret"
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
            Servidor activo no dashboard
          </label>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
