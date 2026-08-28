'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  VIRTUALIZATION_DASHBOARD_REFRESH_OPTIONS,
  VIRTUALIZATION_POLL_INTERVAL_OPTIONS,
  formatProxmoxAuthError,
  isLikelyPveBaseUrl,
  normalizePbsApiTokenSecret,
  type VirtualizationPbsServerPublic,
  type VirtualizationSettingsPublic,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { NoAutofillSecretInput } from '@/components/whatsapp/no-autofill-field';
import { Modal } from '@/components/modal';
import { VirtualizationZerotierPanel } from '@/components/virtualization/virtualization-zerotier-panel';

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

type ServerHealthStatus = 'loading' | 'ok' | 'warning' | 'error';

interface ServerHealthInfo {
  status: ServerHealthStatus;
  hint: string;
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

function resolveServerHealth(
  server: VirtualizationPbsServerPublic,
  tested?: boolean | null
): ServerHealthInfo {
  if (!server.isActive) {
    return { status: 'warning', hint: 'Servidor inactivo no dashboard' };
  }
  if (tested === true) {
    return { status: 'ok', hint: 'Ligação OK' };
  }
  if (tested === false || server.lastError) {
    return {
      status: 'error',
      hint: server.lastError ? formatProxmoxAuthError(server.lastError) : 'Ligação falhou',
    };
  }
  if (!server.lastCheckedAt) {
    return { status: 'warning', hint: 'Ainda não testado' };
  }
  return { status: 'ok', hint: 'Sem erros registados' };
}

function ServerHealthDot({ health }: { health: ServerHealthInfo }) {
  const colorClass =
    health.status === 'ok'
      ? 'bg-emerald-500'
      : health.status === 'error'
        ? 'bg-red-500'
        : health.status === 'warning'
          ? 'bg-amber-500'
          : 'bg-slate-300 animate-pulse';

  return (
    <span
      className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colorClass}`}
      title={health.hint}
      aria-label={health.hint}
    />
  );
}

export function VirtualizationConfigPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [servers, setServers] = useState<VirtualizationPbsServerPublic[]>([]);
  const [settings, setSettings] = useState<VirtualizationSettingsPublic | null>(null);
  const [serverForm, setServerForm] = useState<ServerFormState>(emptyServerForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOriginalTokenId, setEditingOriginalTokenId] = useState('');
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [modalError, setModalError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [healthMap, setHealthMap] = useState<Record<string, ServerHealthInfo>>({});
  const [sshSecrets, setSshSecrets] = useState({
    password: '',
    privateKey: '',
    passphrase: '',
  });
  const submittingRef = useRef(false);

  const refreshServerHealth = useCallback(
    async (serverList: VirtualizationPbsServerPublic[]) => {
      if (!workspaceId || serverList.length === 0) {
        setHealthMap({});
        return;
      }

      const loadingMap = Object.fromEntries(
        serverList.map((server) => [server.id, { status: 'loading' as const, hint: 'A testar…' }])
      );
      setHealthMap(loadingMap);

      const results = await Promise.all(
        serverList.map(async (server) => {
          if (!server.isActive) {
            return [server.id, resolveServerHealth(server, null)] as const;
          }

          const testRes = await apiFetch<{ ok: true; version: string; datastores: string[] }>(
            withWorkspaceQuery(API_PATHS.virtualization.pbsServerTest(server.id), workspaceId),
            { method: 'POST' },
            getStoredToken()
          );

          return [
            server.id,
            resolveServerHealth(server, testRes.data?.ok === true),
          ] as const;
        })
      );

      setHealthMap(Object.fromEntries(results));
    },
    [workspaceId]
  );

  const loadAll = useCallback(async () => {
    if (!workspaceId) return;
    const [serversRes, settingsRes] = await Promise.all([
      apiFetch<VirtualizationPbsServerPublic[]>(
        withWorkspaceQuery(API_PATHS.virtualization.pbsServers, workspaceId),
        {},
        getStoredToken()
      ),
      apiFetch<VirtualizationSettingsPublic>(
        withWorkspaceQuery(API_PATHS.virtualization.settings, workspaceId),
        {},
        getStoredToken()
      ),
    ]);

    if (serversRes.data) {
      setServers(serversRes.data);
      void refreshServerHealth(serversRes.data);
    }
    if (settingsRes.data) setSettings(settingsRes.data);
    if (!serversRes.data && !settingsRes.data) {
      setError(getApiErrorMessage(serversRes) || getApiErrorMessage(settingsRes));
    }
  }, [workspaceId, refreshServerHealth]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

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

  const handleServerSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || submittingRef.current || busy) return;

    const tokenId = serverForm.apiTokenId.trim();
    const tokenSecret = normalizePbsApiTokenSecret(serverForm.apiTokenSecret);

    if (!editingId && (!tokenId || !tokenSecret)) {
      setModalError('Token ID e Secret são obrigatórios ao adicionar um servidor.');
      return;
    }

    if (editingId && tokenId !== editingOriginalTokenId && !tokenSecret) {
      setModalError('Ao alterar o Token ID, tem de voltar a introduzir o Secret (só é mostrado uma vez no PBS).');
      return;
    }

    const baseUrl = serverForm.baseUrl.trim().replace(/\/+$/, '');
    if (isLikelyPveBaseUrl(baseUrl)) {
      setModalError(
        'URL com porta 8006 é Proxmox VE. Remova este registo e adicione-o no separador PVE — as credenciais estão correctas, só estão no sítio errado.'
      );
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
        baseUrl,
        datastore: serverForm.datastore,
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
        setModalError(getApiErrorMessage(res));
        return;
      }

      const serverId = res.data.id;
      if (wasCreate) {
        setEditingId(serverId);
        setEditingOriginalTokenId(res.data.apiTokenId ?? tokenId);
      }

      const testRes = await apiFetch<{ ok: true; version: string; datastores: string[] }>(
        withWorkspaceQuery(API_PATHS.virtualization.pbsServerTest(serverId), workspaceId),
        { method: 'POST' },
        getStoredToken()
      );

      if (testRes.data?.ok) {
        const stores = testRes.data.datastores;
        const storeHint =
          stores.length > 0 ? ` Datastores: ${stores.join(', ')}.` : '';
        setMessage(
          `${wasCreate ? 'Servidor adicionado' : 'Servidor actualizado'} — ligação OK (PBS ${testRes.data.version}).${storeHint}`
        );
        closeServerModal();
        await loadAll();
      } else {
        const tokenHint = tokenId
          ? ` Em Permissions, o API Token tem de ser exactamente «${tokenId}» (não outro nome).`
          : '';
        setModalError(
          `Ligação falhou: ${getApiErrorMessage(testRes)}.${tokenHint} Corrija o Secret e clique «Guardar alterações» — não crie outro servidor.`
        );
        setServerForm((prev) => ({
          ...prev,
          apiTokenId: res.data?.apiTokenId ?? tokenId,
          apiTokenSecret: '',
        }));
        await loadAll();
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    if (!workspaceId) return;
    if (!window.confirm('Remover este servidor PBS?')) return;

    setBusy(true);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.virtualization.pbsServerById(serverId), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.data) {
      setMessage('Servidor removido.');
      if (editingId === serverId) closeServerModal();
      await loadAll();
    } else {
      setError(getApiErrorMessage(res));
    }
    setBusy(false);
  };

  const handleSettingsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !settings) return;

    setBusy(true);
    setError('');
    setMessage('');

    const res = await apiFetch<VirtualizationSettingsPublic>(
      withWorkspaceQuery(API_PATHS.virtualization.settings, workspaceId),
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...settings,
          ...(sshSecrets.password.trim() ? { sshPassword: sshSecrets.password } : {}),
          ...(sshSecrets.privateKey.trim() ? { sshPrivateKey: sshSecrets.privateKey } : {}),
          ...(sshSecrets.passphrase.trim() ? { sshPassphrase: sshSecrets.passphrase } : {}),
        }),
      },
      getStoredToken()
    );

    if (res.data) {
      setSettings(res.data);
      setSshSecrets({ password: '', privateKey: '', passphrase: '' });
      setMessage('Definições guardadas.');
    } else {
      setError(getApiErrorMessage(res));
    }
    setBusy(false);
  };

  if (!workspaceId) {
    return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;
  }

  return (
    <div className="space-y-8">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Servidores PBS</h2>
            <p className="mt-1 text-sm text-slate-500">
              Proxmox Backup Server (porta 8007). Para Proxmox VE, use o separador PVE.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> OK
              </span>
              {' · '}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Atenção
              </span>
              {' · '}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Erro
              </span>
            </p>
          </div>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openAddModal}>
            <Plus size={16} />
            Adicionar servidor
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Nenhum servidor ainda.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {servers.map((server) => {
              const health =
                healthMap[server.id] ?? resolveServerHealth(server, null);
              return (
                <div
                  key={server.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-100 px-4 py-3"
                >
                  <div className="flex min-w-0 gap-3">
                    <ServerHealthDot health={health} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{server.label}</p>
                      <p className="text-xs text-slate-500">
                        {server.baseUrl} · {server.datastore}
                      </p>
                      {health.status !== 'ok' && health.status !== 'loading' ? (
                        <p
                          className={`mt-1 text-xs ${
                            health.status === 'error' ? 'text-red-600' : 'text-amber-700'
                          }`}
                        >
                          {health.hint}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={() => openEditModal(server)}
                    >
                      Editar
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
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={closeServerModal} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="virtualization-pbs-server-form" className="btn-primary" disabled={busy}>
              {busy ? 'A guardar…' : editingId ? 'Guardar alterações' : 'Adicionar servidor'}
            </button>
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

        {modalError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {modalError}
          </div>
        ) : null}

        {editingId ? (
          <p className="mt-4 text-xs text-slate-500">
            A editar servidor existente — novos cliques em guardar actualizam este registo, não criam duplicados.
          </p>
        ) : null}

        <form
          id="virtualization-pbs-server-form"
          onSubmit={handleServerSubmit}
          className="mt-5 grid gap-4 md:grid-cols-2"
        >
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Etiqueta</span>
            <input
              className="input w-full"
              value={serverForm.label}
              onChange={(e) => setServerForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="PBS Cesario Verde"
              required
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
              required
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Datastore</span>
            <input
              className="input w-full"
              value={serverForm.datastore}
              onChange={(e) => setServerForm((prev) => ({ ...prev, datastore: e.target.value }))}
              placeholder="ex. CVStorage01"
              required
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Token ID</span>
            <input
              className="input w-full font-mono text-sm"
              value={serverForm.apiTokenId}
              onChange={(e) => setServerForm((prev) => ({ ...prev, apiTokenId: e.target.value }))}
              placeholder="root@pam!tvde"
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
            Servidor activo no dashboard
          </label>
        </form>
      </Modal>

      {settings ? (
        <section className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">Definições do workspace</h2>
          <p className="mt-1 text-sm text-slate-500">
            Acesso SSH partilhado, notificações e intervalos de actualização.
          </p>

          <form id="virtualization-settings-form" onSubmit={handleSettingsSubmit} className="mt-5 space-y-8">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">Acesso SSH</h3>
              <p className="text-sm text-slate-500">
                Usado para instalar ZeroTier nos servidores. Os alvos podem herdar estas credenciais.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">Utilizador predefinido</span>
                  <input
                    className="input w-full"
                    value={settings.sshDefaultUsername}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, sshDefaultUsername: e.target.value } : prev
                      )
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">Porta predefinida</span>
                  <input
                    className="input w-full"
                    type="number"
                    min={1}
                    max={65535}
                    value={settings.sshDefaultPort}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, sshDefaultPort: Number(e.target.value) || 22 } : prev
                      )
                    }
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Autenticação SSH</span>
                <select
                  className="input w-full max-w-xs"
                  value={settings.sshAuthMode}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            sshAuthMode: e.target.value as VirtualizationSettingsPublic['sshAuthMode'],
                          }
                        : prev
                    )
                  }
                >
                  <option value="password">Password</option>
                  <option value="private_key">Chave privada</option>
                </select>
              </label>

              {settings.sshAuthMode === 'password' ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">
                    Password SSH {settings.hasSshPassword ? '(deixe vazio para manter)' : ''}
                  </span>
                  <NoAutofillSecretInput
                    className="input w-full max-w-md"
                    value={sshSecrets.password}
                    onChange={(e) =>
                      setSshSecrets((prev) => ({ ...prev, password: e.target.value }))
                    }
                    required={!settings.hasSshPassword}
                  />
                </label>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-700">
                      Chave privada SSH {settings.hasSshPrivateKey ? '(deixe vazio para manter)' : ''}
                    </span>
                    <textarea
                      className="input min-h-[120px] w-full font-mono text-xs"
                      value={sshSecrets.privateKey}
                      onChange={(e) =>
                        setSshSecrets((prev) => ({ ...prev, privateKey: e.target.value }))
                      }
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      required={!settings.hasSshPrivateKey}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-700">Passphrase da chave (opcional)</span>
                    <NoAutofillSecretInput
                      className="input w-full max-w-md"
                      value={sshSecrets.passphrase}
                      onChange={(e) =>
                        setSshSecrets((prev) => ({ ...prev, passphrase: e.target.value }))
                      }
                    />
                  </label>
                </>
              )}
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-6">
              <h3 className="text-sm font-semibold text-slate-900">Notificações e intervalos</h3>
              <p className="text-sm text-slate-500">
                Alertas automáticos quando um backup falhar (worker em fase posterior).
              </p>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.notifyOnBackupFailure}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, notifyOnBackupFailure: e.target.checked } : prev
                  )
                }
              />
              Notificar falhas de backup
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.notifyWhatsappEnabled}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, notifyWhatsappEnabled: e.target.checked } : prev
                  )
                }
              />
              Enviar WhatsApp
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Telefones WhatsApp (um por linha)</span>
              <textarea
                className="input min-h-24 w-full"
                value={settings.notifyWhatsappPhones.join('\n')}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev
                      ? {
                          ...prev,
                          notifyWhatsappPhones: e.target.value
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean),
                        }
                      : prev
                  )
                }
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.notifyEmailEnabled}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, notifyEmailEnabled: e.target.checked } : prev
                  )
                }
              />
              Enviar email
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Emails (um por linha)</span>
              <textarea
                className="input min-h-24 w-full"
                value={settings.notifyEmailAddresses.join('\n')}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev
                      ? {
                          ...prev,
                          notifyEmailAddresses: e.target.value
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean),
                        }
                      : prev
                  )
                }
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Actualização do dashboard (segundos)</span>
              <select
                className="input w-full max-w-xs"
                value={settings.dashboardRefreshSeconds}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, dashboardRefreshSeconds: Number(e.target.value) } : prev
                  )
                }
              >
                {VIRTUALIZATION_DASHBOARD_REFRESH_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} s
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Refresh visual com cache no servidor. Pausa quando o separador está em background.
              </p>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Alertas de backup (minutos)</span>
              <select
                className="input w-full max-w-xs"
                value={settings.pollIntervalMinutes}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, pollIntervalMinutes: Number(e.target.value) } : prev
                  )
                }
              >
                {VIRTUALIZATION_POLL_INTERVAL_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </label>
            </div>

            <button type="submit" className="btn-primary" disabled={busy}>
              Guardar definições
            </button>
          </form>
        </section>
      ) : null}

      <VirtualizationZerotierPanel />
    </div>
  );
}
