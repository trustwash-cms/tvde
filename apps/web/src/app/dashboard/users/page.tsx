'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  canCreateUsers,
  canManageUser,
  canToggleUserStatus,
  canViewUserProfile,
  type Role,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken, storeTokens } from '@/lib/api';
import ListPageSearch from '@/components/list-page-search';
import { UserListCard, type UserListItem } from '@/components/users/user-list-card';
import { CreateUserModal, type TenantOption } from '@/components/users/create-user-modal';
import { EditUserModal } from '@/components/users/edit-user-modal';
import { DeleteUserModal } from '@/components/users/delete-user-modal';
import { UserDetailsModal } from '@/components/users/user-details-modal';
import { UserVehiclesModal } from '@/components/users/user-vehicles-modal';
import { useAlertDialog } from '@/hooks/use-alert-dialog';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface AuthUser {
  id: string;
  email: string;
  role: Role;
  tenant?: { siteId: string; name: string } | null;
}

export default function UsersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q');
  const tenantIdParam = searchParams.get('tenantId');

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [actorRole, setActorRole] = useState<Role | null>(null);
  const [actorUserId, setActorUserId] = useState<string | null>(null);
  const [actorSiteId, setActorSiteId] = useState<string | null>(null);
  const [filterTenantId, setFilterTenantId] = useState(tenantIdParam ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserListItem | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserListItem | null>(null);
  const [detailsUser, setDetailsUser] = useState<UserListItem | null>(null);
  const [vehiclesUser, setVehiclesUser] = useState<UserListItem | null>(null);
  const [credentialsBusyId, setCredentialsBusyId] = useState<string | null>(null);

  const isMaster = actorRole === 'master';
  const { alert, alertDialog } = useAlertDialog();
  const { confirm, confirmDialog } = useConfirmDialog();

  function load() {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (isMaster && filterTenantId) params.set('tenantId', filterTenantId);
    const query = params.toString();
    const path = query ? `${API_PATHS.users.list}?${query}` : API_PATHS.users.list;

    apiFetch<UserListItem[]>(path, {}, getStoredToken()).then((res) => {
      if (res.data) setUsers(res.data);
    });
  }

  useEffect(() => {
    const token = getStoredToken();
    apiFetch<AuthUser>(API_PATHS.auth.me, {}, token).then((res) => {
      if (res.data) {
        setActorRole(res.data.role as Role);
        setActorUserId(res.data.id);
        setActorSiteId(res.data.tenant?.siteId ?? null);
      }
    });
  }, []);

  useEffect(() => {
    if (!isMaster) return;
    apiFetch<TenantOption[]>(API_PATHS.tenants.list, {}, getStoredToken()).then((res) => {
      if (res.data) setTenants(res.data);
    });
  }, [isMaster]);

  useEffect(() => {
    if (tenantIdParam) setFilterTenantId(tenantIdParam);
  }, [tenantIdParam]);

  useEffect(() => {
    if (actorRole) load();
  }, [actorRole, q, filterTenantId, isMaster]);

  function setTenantFilter(id: string) {
    setFilterTenantId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('tenantId', id);
    else params.delete('tenantId');
    router.replace(`/dashboard/users${params.toString() ? `?${params}` : ''}`);
  }

  async function handleCreate(payload: Record<string, string>) {
    const res = await apiFetch<{ credentialsSent?: boolean }>(API_PATHS.users.list, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, getStoredToken());

    if (res.success) {
      load();
      if (payload.password) {
        return { ok: true, credentialsSent: false };
      }
      if (res.data?.credentialsSent) {
        await alert({
          title: 'Utilizador criado (Pending)',
          message:
            'Conta criada em Pending. As credenciais foram enviadas — o utilizador activa a conta no 1º login.',
          variant: 'default',
        });
      } else {
        await alert({
          title: 'Utilizador criado (Pending)',
          message:
            'Conta criada, mas o envio de credenciais falhou ou ficou incompleto. Use o ícone da chave para reenviar.',
          variant: 'warning',
        });
      }
      return { ok: true, credentialsSent: res.data?.credentialsSent };
    }

    await alert({
      title: 'Não foi possível criar',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
    return { ok: false };
  }

  async function handleEdit(userId: string, payload: Record<string, string>) {
    const res = await apiFetch(API_PATHS.users.byId(userId), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, getStoredToken());

    if (res.success) {
      load();
      return true;
    }

    await alert({
      title: 'Não foi possível guardar',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
    return false;
  }

  async function handleRequestDeleteCode(userId: string) {
    const res = await apiFetch<{ maskedEmail?: string }>(
      API_PATHS.users.deleteConfirmation(userId),
      { method: 'POST' },
      getStoredToken()
    );
    if (res.success && res.data) return res.data;
    await alert({
      title: 'Envio falhou',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
    return null;
  }

  async function handleConfirmDelete(userId: string, confirmationCode: string) {
    const res = await apiFetch(API_PATHS.users.byId(userId), {
      method: 'DELETE',
      body: JSON.stringify({ confirmationCode }),
    }, getStoredToken());

    if (res.success) {
      load();
      return true;
    }

    await alert({
      title: 'Não foi possível eliminar',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
    return false;
  }

  async function handleToggleStatus(user: UserListItem) {
    const nextStatus = user.status === 'active' ? 'suspended' : 'active';
    const res = await apiFetch(API_PATHS.users.status(user.id), {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    }, getStoredToken());

    if (res.success) {
      load();
      return;
    }

    await alert({
      title: 'Não foi possível alterar estado',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
  }

  function canEditUser(u: UserListItem): boolean {
    if (!actorRole || !actorUserId || u.id === actorUserId) return false;
    return canManageUser(actorRole, u.role as Role);
  }

  function canDeleteUser(u: UserListItem): boolean {
    if (!actorRole || !actorUserId || u.id === actorUserId) return false;
    return canManageUser(actorRole, u.role as Role);
  }

  function canToggleUser(u: UserListItem): boolean {
    if (!actorRole || !actorUserId || u.id === actorUserId) return false;
    if (u.status === 'pending') return false;
    if (!canToggleUserStatus(actorRole)) return false;
    return canManageUser(actorRole, u.role as Role);
  }

  function canCredentialsAction(u: UserListItem): boolean {
    if (!actorRole || !actorUserId || u.id === actorUserId) return false;
    if (!canManageUser(actorRole, u.role as Role)) return false;
    return u.status === 'pending' || u.status === 'active';
  }

  async function handleCredentialsAction(u: UserListItem) {
    const isPending = u.status === 'pending';
    const name = u.fullName || u.username || u.email;
    const ok = await confirm({
      title: isPending ? 'Reenviar credenciais' : 'Reset password',
      message: isPending
        ? `Gerar nova password temporária e reenviar para ${name}? A conta permanece Pending até ao 1º login.`
        : `Gerar nova password temporária e enviar para ${name}? As sessões activas serão terminadas.`,
      confirmLabel: isPending ? 'Reenviar' : 'Reset password',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    setCredentialsBusyId(u.id);
    const path = isPending
      ? API_PATHS.users.resendCredentials(u.id)
      : API_PATHS.users.resetPassword(u.id);
    const res = await apiFetch(path, { method: 'POST' }, getStoredToken());
    setCredentialsBusyId(null);

    if (res.success) {
      load();
      await alert({
        title: isPending ? 'Credenciais reenviadas' : 'Password redefinida',
        message:
          res.message ||
          (isPending
            ? 'Nova password temporária enviada ao utilizador.'
            : 'Nova password temporária enviada. O utilizador deve alterar no próximo login.'),
      });
      return;
    }

    await alert({
      title: 'Operação falhou',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
  }

  function canViewDetails(u: UserListItem): boolean {
    if (!actorRole || !actorUserId) return false;
    return canViewUserProfile(actorUserId, actorRole, u.id, u.role as Role);
  }

  function canImpersonateUser(u: UserListItem): boolean {
    if (!isMaster || !actorUserId) return false;
    if (u.id === actorUserId) return false;
    if (u.status !== 'active') return false;
    if (u.role === 'master') return false;
    return true;
  }

  async function handleImpersonate(u: UserListItem) {
    const name = u.fullName || u.username || u.email;
    const ok = await confirm({
      title: `Personificar ${name}?`,
      message: 'Vai ver o painel exactamente como este utilizador. Pode sair a qualquer momento.',
      confirmLabel: 'Personificar',
      cancelLabel: 'Cancelar',
      variant: 'default',
    });
    if (!ok) return;

    const res = await apiFetch<{
      accessToken: string;
      refreshToken: string;
      user: { role: string };
    }>(API_PATHS.auth.impersonate, {
      method: 'POST',
      body: JSON.stringify({ userId: u.id }),
    });

    if (!res.success || !res.data?.accessToken || !res.data.refreshToken) {
      await alert({
        title: 'Personificação falhou',
        message: getApiErrorMessage(res),
        variant: 'error',
      });
      return;
    }

    storeTokens(res.data.accessToken, res.data.refreshToken);
    window.location.href = '/dashboard';
  }

  return (
    <>
      {alertDialog}
      {confirmDialog}
      <div>
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-bold">Utilizadores</h1>
            <p className="text-slate-500">
              {isMaster
                ? 'Crie gestores de frota, motoristas e staff para cada tenant (cliente).'
                : 'Gestão de utilizadores do tenant — cada role só cria/gere níveis inferiores.'}
            </p>
          </div>
          {actorRole && canCreateUsers(actorRole) ? (
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              Criar utilizador
            </button>
          ) : null}
        </div>

        {isMaster && tenants.length > 0 && (
          <div className="card mb-6 max-w-md">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Filtrar por tenant</label>
            <select
              className="input"
              value={filterTenantId}
              onChange={(e) => setTenantFilter(e.target.value)}
            >
              <option value="">Todos os tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.siteId} — {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <ListPageSearch placeholder="Pesquisar utilizadores (email, username)…" />

        <div className="space-y-3">
          {users.length === 0 ? (
            <div className="card py-12 text-center text-sm text-slate-500">Nenhum utilizador encontrado.</div>
          ) : (
            users.map((u) => (
              <UserListCard
                key={u.id}
                user={u}
                canEdit={canEditUser(u)}
                canDelete={canDeleteUser(u)}
                canToggle={canToggleUser(u)}
                canDetails={canViewDetails(u)}
                canVehicles={canViewDetails(u)}
                canImpersonate={canImpersonateUser(u)}
                canContaCorrente={actorRole === 'master' || actorRole === 'superadmin'}
                canCredentialsAction={canCredentialsAction(u)}
                credentialsBusy={credentialsBusyId === u.id}
                onEdit={() => setEditUser(u)}
                onDelete={() => setDeleteUser(u)}
                onToggleStatus={() => handleToggleStatus(u)}
                onDetails={() => setDetailsUser(u)}
                onVehicles={() => setVehiclesUser(u)}
                onImpersonate={() => handleImpersonate(u)}
                onCredentialsAction={() => handleCredentialsAction(u)}
              />
            ))
          )}
        </div>

        {actorRole && canCreateUsers(actorRole) ? (
          <CreateUserModal
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onSubmit={handleCreate}
            isMaster={isMaster}
            actorRole={actorRole}
            tenants={tenants}
            defaultTenantId={filterTenantId}
            inheritedSiteId={actorSiteId}
          />
        ) : null}

        {actorRole ? (
          <EditUserModal
            open={!!editUser}
            user={editUser}
            onClose={() => setEditUser(null)}
            onSubmit={handleEdit}
            actorRole={actorRole}
            canChangeStatus={canToggleUserStatus(actorRole)}
          />
        ) : null}

        <DeleteUserModal
          open={!!deleteUser}
          user={deleteUser}
          onClose={() => setDeleteUser(null)}
          onRequestCode={handleRequestDeleteCode}
          onConfirmDelete={handleConfirmDelete}
        />

        <UserDetailsModal
          open={!!detailsUser}
          user={detailsUser}
          onClose={() => setDetailsUser(null)}
          onSaved={() => {
            load();
            void alert({
              title: 'Detalhes guardados',
              message: 'Os dados do utilizador foram actualizados com sucesso.',
              variant: 'default',
            });
          }}
        />

        <UserVehiclesModal
          open={!!vehiclesUser}
          user={vehiclesUser}
          onClose={() => setVehiclesUser(null)}
        />
      </div>
    </>
  );
}
