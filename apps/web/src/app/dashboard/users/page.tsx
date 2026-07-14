'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getAssignableRoles, canManageUser, getRoleLabel, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import ListPageSearch from '@/components/list-page-search';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useAlertDialog } from '@/hooks/use-alert-dialog';

interface TenantOption {
  id: string;
  siteId: string;
  name: string;
}

interface User {
  id: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  tenant?: { id: string; siteId: string; name: string } | null;
}

interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export default function UsersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q');
  const tenantIdParam = searchParams.get('tenantId');

  const [users, setUsers] = useState<User[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [actorRole, setActorRole] = useState<Role | null>(null);
  const [actorUserId, setActorUserId] = useState<string | null>(null);
  const [filterTenantId, setFilterTenantId] = useState(tenantIdParam ?? '');
  const [form, setForm] = useState({
    email: '',
    password: '',
    role: 'staff',
    tenantId: tenantIdParam ?? '',
  });

  const isMaster = actorRole === 'master';
  const assignableRoles = actorRole ? getAssignableRoles(actorRole) : [];
  const { confirm, confirmDialog } = useConfirmDialog();
  const { alert, alertDialog } = useAlertDialog();

  function load() {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (isMaster && filterTenantId) params.set('tenantId', filterTenantId);
    const query = params.toString();
    const path = query ? `${API_PATHS.users.list}?${query}` : API_PATHS.users.list;

    apiFetch<User[]>(path, {}, getStoredToken()).then((res) => {
      if (res.data) setUsers(res.data);
    });
  }

  useEffect(() => {
    const token = getStoredToken();
    apiFetch<AuthUser>(API_PATHS.auth.me, {}, token).then((res) => {
      if (res.data) {
        const role = res.data.role as Role;
        setActorRole(role);
        setActorUserId(res.data.id);
        const roles = getAssignableRoles(role);
        if (roles.length) {
          setForm((f) => ({
            ...f,
            role: role === 'master' ? 'superadmin' : roles[0],
          }));
        }
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
    if (tenantIdParam) {
      setFilterTenantId(tenantIdParam);
      setForm((f) => ({ ...f, tenantId: tenantIdParam }));
    }
  }, [tenantIdParam]);

  useEffect(() => {
    if (actorRole) load();
  }, [actorRole, q, filterTenantId, isMaster]);

  function setTenantFilter(id: string) {
    setFilterTenantId(id);
    setForm((f) => ({ ...f, tenantId: id }));
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('tenantId', id);
    else params.delete('tenantId');
    router.replace(`/dashboard/users${params.toString() ? `?${params}` : ''}`);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();

    if (isMaster && !form.tenantId) {
      await alert({
        title: 'Tenant em falta',
        message: 'Seleccione o tenant (cliente) para o novo utilizador.',
        variant: 'warning',
      });
      return;
    }

    const email = form.email.trim();
    if (!email) {
      await alert({
        title: 'Email em falta',
        message: 'Indique o email do novo utilizador.',
        variant: 'warning',
      });
      return;
    }

    if (!form.password) {
      await alert({
        title: 'Password em falta',
        message: 'Indique a password do novo utilizador.',
        variant: 'warning',
      });
      return;
    }

    if (form.password.length < 12) {
      await alert({
        title: 'Password demasiado curta',
        message: 'A password deve ter pelo menos 12 caracteres.',
        variant: 'warning',
      });
      return;
    }

    const payload: Record<string, string> = {
      email,
      password: form.password,
      role: form.role,
    };
    if (isMaster && form.tenantId) payload.tenantId = form.tenantId;

    const res = await apiFetch(API_PATHS.users.list, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, getStoredToken());

    if (res.success) {
      setForm({
        email: '',
        password: '',
        role: isMaster ? 'superadmin' : assignableRoles[0] ?? 'staff',
        tenantId: form.tenantId,
      });
      load();
    } else {
      await alert({
        title: 'Não foi possível criar',
        message: getApiErrorMessage(res),
        variant: 'error',
      });
    }
  }

  function canDeleteUser(u: User): boolean {
    if (!actorRole || !actorUserId) return false;
    if (u.id === actorUserId) return false;
    return canManageUser(actorRole, u.role as Role);
  }

  async function handleDelete(id: string, email: string) {
    const ok = await confirm({
      title: 'Eliminar utilizador',
      message: `Eliminar utilizador «${email}»? Esta acção não pode ser desfeita.`,
      variant: 'danger',
    });
    if (!ok) return;
    const res = await apiFetch(API_PATHS.users.byId(id), { method: 'DELETE' }, getStoredToken());
    if (res.success) {
      load();
    } else {
      await alert({
        title: 'Não foi possível eliminar',
        message: getApiErrorMessage(res),
        variant: 'error',
      });
    }
  }

  return (
    <>
      {confirmDialog}
      {alertDialog}
    <div>
      <h1 className="mb-2 text-2xl font-bold">Utilizadores</h1>
      <p className="mb-8 text-slate-500">
        {isMaster
          ? 'Crie superadmins, admins e staff para cada tenant (cliente).'
          : 'Gestão de utilizadores do tenant — cada role só cria/gere níveis inferiores.'}
      </p>

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

      <ListPageSearch placeholder="Pesquisar utilizadores (email)…" />

      {assignableRoles.length > 0 && (
        <form
          onSubmit={handleCreate}
          noValidate
          autoComplete="off"
          className={`card relative mb-6 grid gap-4 ${isMaster ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}
        >
          {/* Decoys — absorvem autofill do browser (login) para não preencher os campos reais */}
          <input
            type="text"
            name="username"
            tabIndex={-1}
            autoComplete="username"
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            aria-hidden
          />
          <input
            type="password"
            name="password"
            tabIndex={-1}
            autoComplete="current-password"
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            aria-hidden
          />
          {isMaster && (
            <select
              className="input md:col-span-2"
              value={form.tenantId}
              onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
            >
              <option value="">Tenant (cliente)…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.siteId} — {t.name}
                </option>
              ))}
            </select>
          )}
          <input
            className="input"
            type="email"
            name="new-user-email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            onFocus={(e) => {
              e.currentTarget.readOnly = false;
            }}
            readOnly
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
          />
          <input
            className="input"
            type="password"
            name="new-user-password"
            placeholder="Password (min. 12)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            onFocus={(e) => {
              e.currentTarget.readOnly = false;
            }}
            readOnly
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
          />
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {getRoleLabel(r)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-primary">
            Criar
          </button>
        </form>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-slate-500">
            <tr>
              {isMaster && <th className="px-6 py-3">Tenant</th>}
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Role</th>
              <th className="px-6 py-3">Estado</th>
              <th className="px-6 py-3">Último login</th>
              <th className="px-6 py-3 text-right">Acções</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                {isMaster && (
                  <td className="px-6 py-4 text-slate-600">
                    {u.tenant ? (
                      <>
                        <span className="font-mono text-xs">{u.tenant.siteId}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{u.tenant.name}</span>
                      </>
                    ) : (
                      <span className="text-amber-600">Sem tenant</span>
                    )}
                  </td>
                )}
                <td className="px-6 py-4">{u.email}</td>
                <td className="px-6 py-4">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{getRoleLabel(u.role as Role)}</span>
                </td>
                <td className="px-6 py-4">{u.status}</td>
                <td className="px-6 py-4 text-slate-500">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('pt-PT') : '—'}
                </td>
                <td className="px-6 py-4 text-right">
                  {canDeleteUser(u) ? (
                    <button
                      type="button"
                      className="text-red-600 hover:underline"
                      onClick={() => handleDelete(u.id, u.email)}
                    >
                      Eliminar
                    </button>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}
