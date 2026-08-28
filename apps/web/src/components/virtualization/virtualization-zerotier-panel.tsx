'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  ZEROTIER_NETWORK_MEMBER_LIMIT,
  type VirtualizationPbsServerPublic,
  type VirtualizationPveServerPublic,
  type VirtualizationSettingsPublic,
  type VirtualizationZerotierAccountPublic,
  type VirtualizationZerotierJoinTargetPublic,
  type VirtualizationZerotierMemberPublic,
  type VirtualizationZerotierNetworkPublic,
  type VirtualizationZerotierRemoteNetwork,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { NoAutofillSecretInput } from '@/components/whatsapp/no-autofill-field';
import { Modal } from '@/components/modal';

interface AccountFormState {
  label: string;
  email: string;
  apiToken: string;
  apiMode: 'legacy' | 'central';
  orgId: string;
}

interface JoinTargetFormState {
  networkRowId: string;
  label: string;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  useWorkspaceSsh: boolean;
  sshAuthMode: 'password' | 'private_key';
  sshPassword: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  targetKind: 'pbs' | 'pve' | 'custom';
  pbsServerId: string;
  pveServerId: string;
}

const emptyAccountForm: AccountFormState = {
  label: '',
  email: '',
  apiToken: '',
  apiMode: 'legacy',
  orgId: '',
};

const emptyJoinTargetForm: JoinTargetFormState = {
  networkRowId: '',
  label: '',
  sshHost: '',
  sshPort: '22',
  sshUsername: 'root',
  useWorkspaceSsh: true,
  sshAuthMode: 'password',
  sshPassword: '',
  sshPrivateKey: '',
  sshPassphrase: '',
  targetKind: 'custom',
  pbsServerId: '',
  pveServerId: '',
};

export function VirtualizationZerotierPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [accounts, setAccounts] = useState<VirtualizationZerotierAccountPublic[]>([]);
  const [networks, setNetworks] = useState<VirtualizationZerotierNetworkPublic[]>([]);
  const [joinTargets, setJoinTargets] = useState<VirtualizationZerotierJoinTargetPublic[]>([]);
  const [pbsServers, setPbsServers] = useState<VirtualizationPbsServerPublic[]>([]);
  const [pveServers, setPveServers] = useState<VirtualizationPveServerPublic[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<VirtualizationSettingsPublic | null>(null);
  const [remoteNetworks, setRemoteNetworks] = useState<VirtualizationZerotierRemoteNetwork[]>([]);
  const [members, setMembers] = useState<VirtualizationZerotierMemberPublic[]>([]);
  const [membersNetworkId, setMembersNetworkId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<AccountFormState>(emptyAccountForm);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [linkAccountId, setLinkAccountId] = useState<string | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [joinTargetModalOpen, setJoinTargetModalOpen] = useState(false);
  const [joinTargetForm, setJoinTargetForm] = useState<JoinTargetFormState>(emptyJoinTargetForm);
  const [provisioningId, setProvisioningId] = useState<string | null>(null);
  const [modalError, setModalError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!workspaceId) return;
    const [accountsRes, networksRes, targetsRes, pbsRes, pveRes, settingsRes] = await Promise.all([
      apiFetch<VirtualizationZerotierAccountPublic[]>(
        withWorkspaceQuery(API_PATHS.virtualization.zerotierAccounts, workspaceId),
        {},
        getStoredToken()
      ),
      apiFetch<VirtualizationZerotierNetworkPublic[]>(
        withWorkspaceQuery(API_PATHS.virtualization.zerotierNetworks, workspaceId),
        {},
        getStoredToken()
      ),
      apiFetch<VirtualizationZerotierJoinTargetPublic[]>(
        withWorkspaceQuery(API_PATHS.virtualization.zerotierJoinTargets, workspaceId),
        {},
        getStoredToken()
      ),
      apiFetch<VirtualizationPbsServerPublic[]>(
        withWorkspaceQuery(API_PATHS.virtualization.pbsServers, workspaceId),
        {},
        getStoredToken()
      ),
      apiFetch<VirtualizationPveServerPublic[]>(
        withWorkspaceQuery(API_PATHS.virtualization.pveServers, workspaceId),
        {},
        getStoredToken()
      ),
      apiFetch<VirtualizationSettingsPublic>(
        withWorkspaceQuery(API_PATHS.virtualization.settings, workspaceId),
        {},
        getStoredToken()
      ),
    ]);
    if (accountsRes.data) setAccounts(accountsRes.data);
    if (networksRes.data) setNetworks(networksRes.data);
    if (targetsRes.data) setJoinTargets(targetsRes.data);
    if (pbsRes.data) setPbsServers(pbsRes.data);
    if (pveRes.data) setPveServers(pveRes.data);
    if (settingsRes.data) setWorkspaceSettings(settingsRes.data);
    if (!accountsRes.data && !networksRes.data) {
      setError(getApiErrorMessage(accountsRes) || getApiErrorMessage(networksRes));
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const closeAccountModal = () => {
    setAccountModalOpen(false);
    setModalError('');
    setEditingAccountId(null);
    setAccountForm(emptyAccountForm);
  };

  const openAddAccountModal = () => {
    setEditingAccountId(null);
    setAccountForm(emptyAccountForm);
    setModalError('');
    setAccountModalOpen(true);
  };

  const openEditAccountModal = (account: VirtualizationZerotierAccountPublic) => {
    setEditingAccountId(account.id);
    setAccountForm({
      label: account.label,
      email: account.email ?? '',
      apiToken: '',
      apiMode: account.apiMode,
      orgId: account.orgId ?? '',
    });
    setModalError('');
    setAccountModalOpen(true);
  };

  const handleAccountSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || busy) return;

    if (!editingAccountId && !accountForm.apiToken.trim()) {
      setModalError('API Token é obrigatório ao adicionar conta.');
      return;
    }

    setBusy(true);
    setModalError('');
    const payload = {
      label: accountForm.label,
      email: accountForm.email.trim() || undefined,
      apiMode: accountForm.apiMode,
      orgId: accountForm.orgId.trim() || undefined,
      ...(accountForm.apiToken.trim() ? { apiToken: accountForm.apiToken.trim() } : {}),
    };

    const res = editingAccountId
      ? await apiFetch<VirtualizationZerotierAccountPublic>(
          withWorkspaceQuery(API_PATHS.virtualization.zerotierAccountById(editingAccountId), workspaceId),
          { method: 'PATCH', body: JSON.stringify(payload) },
          getStoredToken()
        )
      : await apiFetch<VirtualizationZerotierAccountPublic>(
          withWorkspaceQuery(API_PATHS.virtualization.zerotierAccounts, workspaceId),
          { method: 'POST', body: JSON.stringify({ ...payload, apiToken: accountForm.apiToken.trim() }) },
          getStoredToken()
        );

    setBusy(false);
    if (!res.data) {
      setModalError(getApiErrorMessage(res));
      return;
    }

    const accountId = res.data.id;
    const testRes = await apiFetch<{ ok: true; networkCount: number }>(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierAccountTest(accountId), workspaceId),
      { method: 'POST' },
      getStoredToken()
    );

    if (testRes.data?.ok) {
      setMessage(
        `${editingAccountId ? 'Conta actualizada' : 'Conta adicionada'} — ${testRes.data.networkCount} rede(s) encontrada(s).`
      );
      closeAccountModal();
      await loadAll();
    } else {
      setModalError(getApiErrorMessage(testRes));
      await loadAll();
    }
  };

  const handleTestAccount = async (accountId: string) => {
    if (!workspaceId) return;
    setTestingId(accountId);
    const res = await apiFetch<{ ok: true; networkCount: number }>(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierAccountTest(accountId), workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setTestingId(null);
    if (res.data?.ok) {
      setMessage(`Ligação OK — ${res.data.networkCount} rede(s) na conta.`);
      await loadAll();
    } else {
      setError(getApiErrorMessage(res));
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!workspaceId || !window.confirm('Remover esta conta ZeroTier e todas as redes associadas?')) return;
    setBusy(true);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierAccountById(accountId), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    await loadAll();
  };

  const openLinkModal = async (accountId: string) => {
    if (!workspaceId) return;
    setLinkAccountId(accountId);
    setModalError('');
    setRemoteNetworks([]);
    setLinkModalOpen(true);
    const res = await apiFetch<VirtualizationZerotierRemoteNetwork[]>(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierAccountRemoteNetworks(accountId), workspaceId),
      {},
      getStoredToken()
    );
    if (res.data) {
      setRemoteNetworks(res.data);
    } else {
      setModalError(getApiErrorMessage(res));
    }
  };

  const handleLinkNetwork = async (networkId: string) => {
    if (!workspaceId || !linkAccountId) return;
    setBusy(true);
    const res = await apiFetch<VirtualizationZerotierNetworkPublic>(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierAccountNetworks(linkAccountId), workspaceId),
      { method: 'POST', body: JSON.stringify({ networkId }) },
      getStoredToken()
    );
    setBusy(false);
    if (!res.data) {
      setModalError(getApiErrorMessage(res));
      return;
    }
    setMessage(`Rede ${res.data.label} associada.`);
    setLinkModalOpen(false);
    await loadAll();
  };

  const handleUnlinkNetwork = async (networkRowId: string) => {
    if (!workspaceId || !window.confirm('Remover esta rede da app?')) return;
    setBusy(true);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierNetworkById(networkRowId), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    await loadAll();
  };

  const handleRefreshNetworks = async () => {
    if (!workspaceId) return;
    setBusy(true);
    const res = await apiFetch<{ refreshed: number }>(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierNetworksRefreshAll, workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setBusy(false);
    if (res.data) {
      setMessage(`${res.data.refreshed} rede(s) actualizada(s).`);
      await loadAll();
    } else {
      setError(getApiErrorMessage(res));
    }
  };

  const openMembersModal = async (networkRowId: string) => {
    if (!workspaceId) return;
    setMembersNetworkId(networkRowId);
    setMembers([]);
    setMembersModalOpen(true);
    setModalError('');
    const res = await apiFetch<VirtualizationZerotierMemberPublic[]>(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierNetworkMembers(networkRowId), workspaceId),
      {},
      getStoredToken()
    );
    if (res.data) {
      setMembers(res.data);
    } else {
      setModalError(getApiErrorMessage(res));
    }
  };

  const handleToggleMember = async (memberId: string, authorized: boolean) => {
    if (!workspaceId || !membersNetworkId) return;
    setBusy(true);
    const res = await apiFetch<VirtualizationZerotierMemberPublic>(
      withWorkspaceQuery(
        API_PATHS.virtualization.zerotierNetworkMemberById(membersNetworkId, memberId),
        workspaceId
      ),
      { method: 'PATCH', body: JSON.stringify({ authorized }) },
      getStoredToken()
    );
    setBusy(false);
    if (!res.data) {
      setModalError(getApiErrorMessage(res));
      return;
    }
    setMembers((prev) =>
      prev.map((member) => (member.memberId === memberId ? res.data! : member))
    );
    await loadAll();
  };

  const openJoinTargetModal = () => {
    setJoinTargetForm({
      ...emptyJoinTargetForm,
      networkRowId: networks[0]?.id ?? '',
      sshPort: String(workspaceSettings?.sshDefaultPort ?? 22),
      sshUsername: workspaceSettings?.sshDefaultUsername ?? 'root',
      sshAuthMode: workspaceSettings?.sshAuthMode ?? 'password',
      useWorkspaceSsh: true,
    });
    setModalError('');
    setJoinTargetModalOpen(true);
  };

  const handleJoinTargetSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || busy) return;
    if (!joinTargetForm.networkRowId) {
      setModalError('Seleccione uma rede ZeroTier.');
      return;
    }
    if (!joinTargetForm.useWorkspaceSsh) {
      if (joinTargetForm.sshAuthMode === 'password' && !joinTargetForm.sshPassword.trim()) {
        setModalError('Password SSH é obrigatória.');
        return;
      }
      if (joinTargetForm.sshAuthMode === 'private_key' && !joinTargetForm.sshPrivateKey.trim()) {
        setModalError('Chave privada SSH é obrigatória.');
        return;
      }
    }

    setBusy(true);
    const res = await apiFetch<VirtualizationZerotierJoinTargetPublic>(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierJoinTargets, workspaceId),
      {
        method: 'POST',
        body: JSON.stringify({
          networkRowId: joinTargetForm.networkRowId,
          label: joinTargetForm.label,
          sshHost: joinTargetForm.targetKind === 'custom' ? joinTargetForm.sshHost : undefined,
          sshPort: Number(joinTargetForm.sshPort) || 22,
          sshUsername: joinTargetForm.sshUsername,
          useWorkspaceSsh: joinTargetForm.useWorkspaceSsh,
          ...(joinTargetForm.useWorkspaceSsh
            ? {}
            : {
                sshAuthMode: joinTargetForm.sshAuthMode,
                ...(joinTargetForm.sshAuthMode === 'password'
                  ? { sshPassword: joinTargetForm.sshPassword }
                  : {
                      sshPrivateKey: joinTargetForm.sshPrivateKey,
                      sshPassphrase: joinTargetForm.sshPassphrase.trim() || undefined,
                    }),
              }),
          targetKind: joinTargetForm.targetKind,
          pbsServerId: joinTargetForm.targetKind === 'pbs' ? joinTargetForm.pbsServerId || null : null,
          pveServerId: joinTargetForm.targetKind === 'pve' ? joinTargetForm.pveServerId || null : null,
        }),
      },
      getStoredToken()
    );
    setBusy(false);
    if (!res.data) {
      setModalError(getApiErrorMessage(res));
      return;
    }
    setMessage(`Alvo "${res.data.label}" criado.`);
    setJoinTargetModalOpen(false);
    await loadAll();
  };

  const handleProvisionTarget = async (targetId: string) => {
    if (!workspaceId) return;
    setProvisioningId(targetId);
    setError('');
    const res = await apiFetch<VirtualizationZerotierJoinTargetPublic>(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierJoinTargetProvision(targetId), workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setProvisioningId(null);
    if (res.data) {
      setMessage(`ZeroTier instalado e autorizado — node ${res.data.nodeId}.`);
      await loadAll();
    } else {
      setError(getApiErrorMessage(res));
      await loadAll();
    }
  };

  const handleDeleteJoinTarget = async (targetId: string) => {
    if (!workspaceId || !window.confirm('Remover este alvo de instalação?')) return;
    setBusy(true);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.virtualization.zerotierJoinTargetById(targetId), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    await loadAll();
  };

  if (!workspaceId) {
    return null;
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">ZeroTier</h2>
          <p className="mt-1 text-sm text-slate-500">
            Várias contas e network IDs — cada rede suporta até {ZEROTIER_NETWORK_MEMBER_LIMIT} dispositivos
            (app + restantes).
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Cada conta ZeroTier (email + API token) gere as suas redes. Para instalar nos servidores PBS/PVE,
            a app liga por SSH, instala o ZeroTier, faz join e autoriza o membro via API.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Token em{' '}
            <a href="https://my.zerotier.com/account" target="_blank" rel="noreferrer" className="underline">
              my.zerotier.com
            </a>{' '}
            (Legacy) ou Service Account no{' '}
            <a href="https://docs.zerotier.com/tokens/" target="_blank" rel="noreferrer" className="underline">
              New Central
            </a>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={() => void handleRefreshNetworks()} disabled={busy}>
            Actualizar contadores
          </button>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openAddAccountModal}>
            <Plus size={16} />
            Adicionar conta
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}

      {accounts.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Nenhuma conta ZeroTier configurada.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="rounded-lg border border-slate-100 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{account.label}</p>
                  {account.email ? (
                    <p className="text-xs text-slate-500">{account.email}</p>
                  ) : null}
                  <p className="text-xs text-slate-500">
                    {account.apiMode === 'central' ? 'New Central' : 'Legacy Central'} ·{' '}
                    {account.networkCount} rede(s) ligada(s)
                  </p>
                  {account.lastError ? (
                    <p className="mt-1 text-xs text-red-600">{account.lastError}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary text-sm" onClick={() => void openLinkModal(account.id)}>
                    Associar rede
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={() => void handleTestAccount(account.id)}
                    disabled={testingId === account.id}
                  >
                    {testingId === account.id ? 'A testar…' : 'Testar'}
                  </button>
                  <button type="button" className="btn-secondary text-sm" onClick={() => openEditAccountModal(account)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-sm text-red-700"
                    onClick={() => void handleDeleteAccount(account.id)}
                    disabled={busy}
                  >
                    Remover
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {networks.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-900">Redes associadas</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {networks.map((network) => (
              <div key={network.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                <p className="text-xs font-medium text-slate-900">{network.label}</p>
                <p className="font-mono text-[10px] text-slate-500">{network.networkId}</p>
                <p className="mt-1 text-xs text-slate-500">{network.accountLabel}</p>
                <p className="mt-2 text-xs text-slate-700">
                  {network.lastMemberCount ?? '—'} / {network.memberLimit} dispositivos
                  {network.slotsRemaining != null ? ` · ${network.slotsRemaining} livres` : ''}
                </p>
                {network.lastAuthorizedCount != null ? (
                  <p className="text-xs text-slate-500">{network.lastAuthorizedCount} autorizados</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs text-slate-700 hover:underline"
                    onClick={() => void openMembersModal(network.id)}
                  >
                    Membros
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-700 hover:underline"
                    onClick={() => void handleUnlinkNetwork(network.id)}
                  >
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Instalar ZeroTier nos servidores</h3>
          <p className="mt-1 text-xs text-slate-500">
            SSH ao host (ex.: root + password), instalação automática e join na rede seleccionada.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={openJoinTargetModal}
          disabled={networks.length === 0}
        >
          Adicionar servidor
        </button>
      </div>

      {joinTargets.length > 0 ? (
        <div className="mt-3 space-y-2">
          {joinTargets.map((target) => (
            <div key={target.id} className="rounded-lg border border-slate-100 px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{target.label}</p>
                  <p className="text-xs text-slate-500">
                    {target.sshUsername}@{target.sshHost}:{target.sshPort} · {target.networkLabel}
                    {' · '}
                    {target.sshAuthMode === 'private_key' ? 'chave SSH' : 'password SSH'}
                    {target.useWorkspaceSsh ? ' · defs. workspace' : ' · credenciais próprias'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Conta: {target.accountEmail ?? target.accountLabel}
                    {target.nodeId ? ` · node ${target.nodeId}` : ''}
                  </p>
                  <p className="mt-1 text-xs capitalize text-slate-600">Estado: {target.joinStatus}</p>
                  {target.lastError ? (
                    <p className="mt-1 text-xs text-red-600">{target.lastError}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    disabled={provisioningId === target.id || target.joinStatus === 'running'}
                    onClick={() => void handleProvisionTarget(target.id)}
                  >
                    {provisioningId === target.id || target.joinStatus === 'running'
                      ? 'A instalar…'
                      : target.joinStatus === 'authorized'
                        ? 'Reinstalar / rejoin'
                        : 'Instalar & join'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-sm text-red-700"
                    onClick={() => void handleDeleteJoinTarget(target.id)}
                    disabled={busy}
                  >
                    Remover
                  </button>
                </div>
              </div>
              {target.provisionLog ? (
                <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-900/5 p-2 text-[10px] text-slate-600">
                  {target.provisionLog}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Nenhum servidor configurado para instalação.</p>
      )}

      <Modal
        open={accountModalOpen}
        onClose={closeAccountModal}
        title={editingAccountId ? 'Editar conta ZeroTier' : 'Adicionar conta ZeroTier'}
        panelClassName="max-w-lg"
        scrollBody
        showCloseButton
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={closeAccountModal} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="zerotier-account-form" className="btn-primary" disabled={busy}>
              {busy ? 'A guardar…' : editingAccountId ? 'Guardar' : 'Adicionar'}
            </button>
          </div>
        }
      >
        {modalError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{modalError}</div>
        ) : null}
        <form id="zerotier-account-form" onSubmit={handleAccountSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Email da conta ZeroTier</span>
            <input
              className="input w-full"
              type="email"
              value={accountForm.email}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="exemplo1@test.pt"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Identificação da conta — o login web não é usado pela API; gere o token em my.zerotier.com
              depois de entrar com este email.
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Etiqueta</span>
            <input
              className="input w-full"
              value={accountForm.label}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="Conta pessoal CV"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Modo API</span>
            <select
              className="input w-full"
              value={accountForm.apiMode}
              onChange={(e) =>
                setAccountForm((prev) => ({
                  ...prev,
                  apiMode: e.target.value as 'legacy' | 'central',
                }))
              }
            >
              <option value="legacy">Legacy (my.zerotier.com — token pessoal)</option>
              <option value="central">New Central (Bearer + org-id)</option>
            </select>
          </label>
          {accountForm.apiMode === 'central' ? (
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Organization ID</span>
              <input
                className="input w-full font-mono text-sm"
                value={accountForm.orgId}
                onChange={(e) => setAccountForm((prev) => ({ ...prev, orgId: e.target.value }))}
                placeholder="org-id do New Central"
              />
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">
              API Token {editingAccountId ? '(deixe vazio para manter)' : ''}
            </span>
            <NoAutofillSecretInput
              className="input w-full font-mono text-sm"
              value={accountForm.apiToken}
              onChange={(e) => setAccountForm((prev) => ({ ...prev, apiToken: e.target.value }))}
              required={!editingAccountId}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title="Associar rede ZeroTier"
        panelClassName="max-w-2xl"
        scrollBody
        showCloseButton
      >
        {modalError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{modalError}</div>
        ) : null}
        {remoteNetworks.length === 0 ? (
          <p className="text-sm text-slate-500">A carregar redes…</p>
        ) : (
          <div className="space-y-2">
            {remoteNetworks.map((network) => (
              <div
                key={network.networkId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{network.name}</p>
                  <p className="font-mono text-xs text-slate-500">{network.networkId}</p>
                  <p className="text-xs text-slate-500">
                    {network.totalMemberCount} membro(s) · {network.authorizedMemberCount} autorizado(s)
                  </p>
                </div>
                {network.alreadyLinked ? (
                  <span className="text-xs text-slate-500">Já associada</span>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={busy}
                    onClick={() => void handleLinkNetwork(network.networkId)}
                  >
                    Associar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={membersModalOpen}
        onClose={() => setMembersModalOpen(false)}
        title="Membros da rede"
        panelClassName="max-w-2xl"
        scrollBody
        showCloseButton
      >
        {modalError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{modalError}</div>
        ) : null}
        {members.length === 0 ? (
          <p className="text-sm text-slate-500">A carregar membros…</p>
        ) : (
          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.memberId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2"
              >
                <div>
                  <p className="font-mono text-sm text-slate-900">{member.nodeId}</p>
                  <p className="text-xs text-slate-500">{member.name ?? 'Sem nome'}</p>
                  <p className="text-xs text-slate-500">
                    {member.authorized ? 'Autorizado' : 'Pendente'}
                    {member.lastOnline ? ` · online ${new Date(member.lastOnline).toLocaleString()}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  disabled={busy}
                  onClick={() => void handleToggleMember(member.memberId, !member.authorized)}
                >
                  {member.authorized ? 'Desautorizar' : 'Autorizar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={joinTargetModalOpen}
        onClose={() => setJoinTargetModalOpen(false)}
        title="Instalar ZeroTier num servidor"
        panelClassName="max-w-lg"
        scrollBody
        showCloseButton
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setJoinTargetModalOpen(false)} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="zerotier-join-target-form" className="btn-primary" disabled={busy}>
              {busy ? 'A guardar…' : 'Guardar'}
            </button>
          </div>
        }
      >
        {modalError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{modalError}</div>
        ) : null}
        <form id="zerotier-join-target-form" onSubmit={handleJoinTargetSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Rede ZeroTier</span>
            <select
              className="input w-full"
              value={joinTargetForm.networkRowId}
              onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, networkRowId: e.target.value }))}
              required
            >
              <option value="">Seleccionar…</option>
              {networks.map((network) => (
                <option key={network.id} value={network.id}>
                  {network.label} ({network.networkId})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Etiqueta</span>
            <input
              className="input w-full"
              value={joinTargetForm.label}
              onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, label: e.target.value }))}
              placeholder="PBS produção"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Tipo de servidor</span>
            <select
              className="input w-full"
              value={joinTargetForm.targetKind}
              onChange={(e) =>
                setJoinTargetForm((prev) => ({
                  ...prev,
                  targetKind: e.target.value as JoinTargetFormState['targetKind'],
                }))
              }
            >
              <option value="custom">Host manual</option>
              <option value="pbs">Servidor PBS configurado</option>
              <option value="pve">Servidor PVE configurado</option>
            </select>
          </label>
          {joinTargetForm.targetKind === 'pbs' ? (
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Servidor PBS</span>
              <select
                className="input w-full"
                value={joinTargetForm.pbsServerId}
                onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, pbsServerId: e.target.value }))}
                required
              >
                <option value="">Seleccionar…</option>
                {pbsServers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {joinTargetForm.targetKind === 'pve' ? (
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Servidor PVE</span>
              <select
                className="input w-full"
                value={joinTargetForm.pveServerId}
                onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, pveServerId: e.target.value }))}
                required
              >
                <option value="">Seleccionar…</option>
                {pveServers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {joinTargetForm.targetKind === 'custom' ? (
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Host SSH</span>
              <input
                className="input w-full font-mono text-sm"
                value={joinTargetForm.sshHost}
                onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, sshHost: e.target.value }))}
                placeholder="192.168.1.10"
                required
              />
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Utilizador SSH</span>
              <input
                className="input w-full"
                value={joinTargetForm.sshUsername}
                onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, sshUsername: e.target.value }))}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Porta SSH</span>
              <input
                className="input w-full"
                value={joinTargetForm.sshPort}
                onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, sshPort: e.target.value }))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={joinTargetForm.useWorkspaceSsh}
              onChange={(e) =>
                setJoinTargetForm((prev) => ({ ...prev, useWorkspaceSsh: e.target.checked }))
              }
            />
            Usar credenciais SSH das definições de virtualização
          </label>
          {joinTargetForm.useWorkspaceSsh ? (
            <p className="text-xs text-slate-500">
              {workspaceSettings?.sshAuthMode === 'private_key'
                ? workspaceSettings.hasSshPrivateKey
                  ? 'Chave privada configurada no workspace.'
                  : 'Ainda não há chave SSH nas definições — configure em Definições do workspace.'
                : workspaceSettings?.hasSshPassword
                  ? 'Password SSH configurada no workspace.'
                  : 'Ainda não há password SSH nas definições — configure em Definições do workspace.'}
            </p>
          ) : null}
          {!joinTargetForm.useWorkspaceSsh ? (
            <>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Autenticação SSH</span>
            <select
              className="input w-full"
              value={joinTargetForm.sshAuthMode}
              onChange={(e) =>
                setJoinTargetForm((prev) => ({
                  ...prev,
                  sshAuthMode: e.target.value as JoinTargetFormState['sshAuthMode'],
                }))
              }
            >
              <option value="password">Password</option>
              <option value="private_key">Chave privada</option>
            </select>
          </label>
          {joinTargetForm.sshAuthMode === 'password' ? (
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Password SSH</span>
              <NoAutofillSecretInput
                className="input w-full"
                value={joinTargetForm.sshPassword}
                onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, sshPassword: e.target.value }))}
                required
              />
            </label>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Chave privada SSH</span>
                <textarea
                  className="input min-h-[120px] w-full font-mono text-xs"
                  value={joinTargetForm.sshPrivateKey}
                  onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, sshPrivateKey: e.target.value }))}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Passphrase da chave (opcional)</span>
                <NoAutofillSecretInput
                  className="input w-full"
                  value={joinTargetForm.sshPassphrase}
                  onChange={(e) => setJoinTargetForm((prev) => ({ ...prev, sshPassphrase: e.target.value }))}
                />
              </label>
            </>
          )}
            </>
          ) : null}
        </form>
      </Modal>
    </section>
  );
}
