'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { filterActivatableModules } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withSearchQuery } from '@/lib/list-search';
import ListPageSearch from '@/components/list-page-search';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface WorkspaceRequest {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  createdAt: string;
  tenant: { siteId: string; name: string };
  requester: { email: string };
}

interface TenantModule {
  moduleKey: string;
  allowed: boolean;
  module: { key: string; name: string; isCore: boolean };
}

interface Tenant {
  id: string;
  siteId: string;
  name: string;
  plan: string;
  status: string;
  tenantModules?: TenantModule[];
  _count?: { workspaces: number; users: number };
  provisionedAdmin?: {
    email: string;
    canResendCredentials: boolean;
    tempPasswordExpired: boolean;
  } | null;
}

interface ModuleRegistry {
  key: string;
  name: string;
  isCore: boolean;
}

export default function TenantsPage() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const searchParams = useSearchParams();
  const q = searchParams.get('q');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [wsRequests, setWsRequests] = useState<WorkspaceRequest[]>([]);
  const [allModules, setAllModules] = useState<ModuleRegistry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    siteId: '',
    name: '',
    plan: 'starter',
    adminEmail: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [deleteConfirmSiteId, setDeleteConfirmSiteId] = useState('');
  const [deleteConfirmationCode, setDeleteConfirmationCode] = useState('');
  const [deleteCodeHint, setDeleteCodeHint] = useState('');
  const [deleteCodeSending, setDeleteCodeSending] = useState(false);
  const [deleteCodeSent, setDeleteCodeSent] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const businessModules = useMemo(
    () => filterActivatableModules(allModules.filter((m) => !m.isCore)),
    [allModules]
  );

  function load() {
    const token = getStoredToken();
    apiFetch<Tenant[]>(withSearchQuery(API_PATHS.tenants.list, q), {}, token).then((res) => {
      if (res.data) setTenants(res.data);
    });
    apiFetch<WorkspaceRequest[]>(API_PATHS.workspaceRequests.list, {}, token).then((res) => {
      if (res.data) setWsRequests(res.data);
    });
  }

  useEffect(() => {
    const token = getStoredToken();
    apiFetch<ModuleRegistry[]>(API_PATHS.modules.list, {}, token).then((res) => {
      if (res.data) setAllModules(res.data);
    });
    load();
  }, [q]);

  useEffect(() => {
    if (!deleteTarget) return;
    void requestDeleteConfirmationCode(deleteTarget.id);
  }, [deleteTarget?.id]);

  function resetDeleteModal() {
    setDeleteTarget(null);
    setDeleteConfirmSiteId('');
    setDeleteConfirmationCode('');
    setDeleteCodeHint('');
    setDeleteCodeSent(false);
    setDeleteCodeSending(false);
  }

  async function requestDeleteConfirmationCode(tenantId: string) {
    setDeleteCodeSending(true);
    setDeleteCodeSent(false);
    setDeleteConfirmationCode('');
    const res = await apiFetch<{ maskedEmail?: string }>(
      API_PATHS.tenants.deleteConfirmation(tenantId),
      { method: 'POST' },
      getStoredToken()
    );
    if (res.success && res.data?.maskedEmail) {
      setDeleteCodeHint(res.data.maskedEmail);
      setDeleteCodeSent(true);
    } else {
      setError(res.error ?? 'Não foi possível enviar o código por email');
      setDeleteCodeHint('');
    }
    setDeleteCodeSending(false);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const token = getStoredToken();
    const payload = {
      siteId: form.siteId.trim(),
      name: form.name.trim(),
      plan: form.plan,
      ...(form.adminEmail.trim() ? { adminEmail: form.adminEmail.trim() } : {}),
    };
    const res = await apiFetch(API_PATHS.tenants.list, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
    if (res.success) {
      setShowForm(false);
      setForm({ siteId: '', name: '', plan: 'starter', adminEmail: '' });
      if (payload.adminEmail) {
        setSuccess(
          `Tenant criado. Foi enviada uma password temporária (válida 24h) para ${payload.adminEmail}.`
        );
      } else {
        setSuccess('Tenant criado.');
      }
      load();
    } else {
      setError(res.error ?? 'Erro ao criar tenant');
    }
  }

  async function resendAdminCredentials(tenant: Tenant) {
    const ok = await confirm({
      title: 'Reenviar credenciais',
      message: `Será gerada uma nova password temporária (válida 24h) e enviada para ${tenant.provisionedAdmin?.email}.`,
      confirmLabel: 'Reenviar',
    });
    if (!ok) return;

    setResendBusy(tenant.id);
    setError('');
    setSuccess('');
    const res = await apiFetch(
      API_PATHS.tenants.resendAdminCredentials(tenant.id),
      { method: 'POST' },
      getStoredToken()
    );
    if (res.success) {
      setSuccess(`Credenciais reenviadas para ${tenant.provisionedAdmin?.email}.`);
      load();
    } else {
      setError(res.error ?? 'Erro ao reenviar credenciais');
    }
    setResendBusy(null);
  }

  function isModuleAllowed(tenant: Tenant, moduleKey: string): boolean {
    const tm = tenant.tenantModules?.find((m) => m.moduleKey === moduleKey);
    return tm?.allowed ?? false;
  }

  async function toggleTenantModule(tenantId: string, moduleKey: string, allowed: boolean) {
    setToggling(`${tenantId}:${moduleKey}`);
    setError('');
    const res = await apiFetch(
      API_PATHS.tenants.module(tenantId, moduleKey),
      { method: 'PATCH', body: JSON.stringify({ allowed: !allowed }) },
      getStoredToken()
    );
    if (res.success) {
      load();
    } else {
      setError(res.error ?? 'Erro ao actualizar módulo');
    }
    setToggling(null);
  }

  async function approveRequest(id: string) {
    setError('');
    const res = await apiFetch(API_PATHS.workspaceRequests.approve(id), {
      method: 'POST',
    }, getStoredToken());
    if (res.success) load();
    else setError(getApiErrorMessage(res));
  }

  async function rejectRequest(id: string) {
    setError('');
    const res = await apiFetch(API_PATHS.workspaceRequests.reject(id), {
      method: 'POST',
      body: JSON.stringify({}),
    }, getStoredToken());
    if (res.success) load();
    else setError(getApiErrorMessage(res));
  }

  async function toggleTenantStatus(tenant: Tenant) {
    const nextStatus = tenant.status === 'active' ? 'inactive' : 'active';
    const isDeactivate = nextStatus === 'inactive';
    const ok = await confirm({
      title: isDeactivate ? 'Desactivar tenant' : 'Reactivar tenant',
      message: isDeactivate
        ? `Confirma desactivar o tenant «${tenant.name}»? Os utilizadores deixarão de conseguir entrar.`
        : `Confirma reactivar o tenant «${tenant.name}»?`,
      confirmLabel: isDeactivate ? 'Desactivar' : 'Reactivar',
      variant: isDeactivate ? 'danger' : 'default',
    });
    if (!ok) return;

    setStatusBusy(tenant.id);
    setError('');
    const res = await apiFetch(
      API_PATHS.tenants.byId(tenant.id),
      { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) },
      getStoredToken()
    );
    if (res.success) load();
    else setError(res.error ?? `Erro ao ${isDeactivate ? 'desactivar' : 'reactivar'} tenant`);
    setStatusBusy(null);
  }

  async function confirmDeleteTenant() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.tenants.byId(deleteTarget.id),
      {
        method: 'DELETE',
        body: JSON.stringify({
          confirmSiteId: deleteConfirmSiteId.trim(),
          confirmationCode: deleteConfirmationCode.trim(),
        }),
      },
      getStoredToken()
    );
    if (res.success) {
      resetDeleteModal();
      if (expandedId === deleteTarget.id) setExpandedId(null);
      load();
    } else {
      setError(res.error ?? 'Erro ao eliminar tenant');
    }
    setDeleting(false);
  }

  function tenantStatusClass(status: string) {
    if (status === 'active') return 'bg-green-100 text-green-700';
    return 'bg-amber-100 text-amber-800';
  }

  const pendingWsRequests = wsRequests.filter((r) => r.status === 'pending');

  return (
    <>
      {confirmDialog}
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenants</h1>
          <p className="text-slate-500">
            MASTER define módulos por cliente e aprova pedidos de workspaces adicionais (+1)
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          Novo Tenant
        </button>
      </div>

      <ListPageSearch placeholder="Pesquisar tenants (nome, siteId)…" />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          autoComplete="off"
          className="card mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          <input
            type="text"
            name="username"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute h-0 w-0 opacity-0"
          />
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute h-0 w-0 opacity-0"
          />
          <input
            className="input"
            placeholder="site-id"
            name="tenant-site-id"
            autoComplete="off"
            value={form.siteId}
            onChange={(e) => setForm({ ...form, siteId: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder="Nome"
            name="tenant-name"
            autoComplete="off"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className="input md:col-span-2 lg:col-span-1"
            type="email"
            placeholder="Email do Gestor de Frota"
            name="tenant-admin-email"
            autoComplete="off"
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
          />
          <button type="submit" className="btn-primary md:col-span-2 lg:col-span-1">Criar</button>
          <p className="text-xs text-slate-500 md:col-span-2 lg:col-span-3">
            Se indicar email, é criado um Gestor de Frota no workspace principal e enviada uma password
            temporária por email (válida 24 horas). No primeiro acesso terá de definir uma nova password.
          </p>
        </form>
      )}

      {pendingWsRequests.length > 0 && (
        <div className="card mb-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-amber-700">
            Pedidos de workspace pendentes
          </h2>
          <ul className="space-y-3">
            {pendingWsRequests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
              >
                <div>
                  <span className="font-mono text-xs text-slate-500">{r.tenant.siteId}</span>
                  <p className="font-medium">
                    {r.name} <span className="text-slate-500">({r.slug})</span>
                  </p>
                  <p className="text-xs text-slate-500">Por {r.requester.email}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" onClick={() => approveRequest(r.id)}>
                    Aprovar (+1)
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => rejectRequest(r.id)}>
                    Rejeitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {tenants.map((t) => (
          <div key={t.id} className="card p-0 overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-slate-50"
              onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
            >
              <div>
                <span className="font-mono text-xs text-slate-500">{t.siteId}</span>
                <h3 className="font-semibold">{t.name}</h3>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <span>{t._count?.workspaces ?? 0} ws</span>
                <span>{t._count?.users ?? 0} users</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${tenantStatusClass(t.status)}`}>
                  {t.status === 'active' ? 'activo' : 'inactivo'}
                </span>
              </div>
            </button>

            {expandedId === t.id && (
              <div className="border-t border-slate-100 bg-slate-50 px-6 py-4">
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={statusBusy === t.id}
                    onClick={() => toggleTenantStatus(t)}
                  >
                    {statusBusy === t.id
                      ? 'A processar…'
                      : t.status === 'active'
                        ? 'Desactivar tenant'
                        : 'Reactivar tenant'}
                  </button>
                  {t.provisionedAdmin?.canResendCredentials && (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={resendBusy === t.id}
                      onClick={() => resendAdminCredentials(t)}
                    >
                      {resendBusy === t.id ? 'A enviar…' : 'Reenviar credenciais'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                    onClick={() => {
                      setDeleteTarget(t);
                      setDeleteConfirmSiteId('');
                    }}
                  >
                    Apagar tenant
                  </button>
                </div>
                {t.provisionedAdmin && (
                  <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                    <p>
                      Gestor de Frota pendente: <strong>{t.provisionedAdmin.email}</strong>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t.provisionedAdmin.tempPasswordExpired
                        ? 'A password temporária expirou — pode reenviar novas credenciais.'
                        : 'Password temporária válida 24 horas. Após o primeiro acesso, o reenvio deixa de estar disponível.'}
                    </p>
                  </div>
                )}
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                  Módulos autorizados para este cliente
                </p>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {businessModules.map((mod) => {
                    const allowed = isModuleAllowed(t, mod.key);
                    const busy = toggling === `${t.id}:${mod.key}`;
                    return (
                      <li
                        key={mod.key}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <span className="text-sm">{mod.name}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={allowed}
                          disabled={busy}
                          onClick={() => toggleTenantModule(t.id, mod.key, allowed)}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                            allowed ? 'bg-[var(--color-primary)]' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                              allowed ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={resetDeleteModal}
        title="Eliminar tenant"
        panelClassName="max-w-md"
        scrollBody
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn-secondary"
              disabled={deleting}
              onClick={resetDeleteModal}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={
                !deleteTarget
                || deleting
                || deleteConfirmSiteId.trim() !== deleteTarget.siteId
                || deleteConfirmationCode.trim().length !== 6
                || !deleteCodeSent
              }
              onClick={confirmDeleteTenant}
            >
              {deleting ? 'A eliminar…' : 'Eliminar definitivamente'}
            </button>
          </div>
        }
      >
        {deleteTarget && (
          <>
            <p className="text-sm text-slate-600">
              Esta acção é irreversível. Serão eliminados todos os workspaces, utilizadores e dados
              associados a <strong>{deleteTarget.name}</strong>.
            </p>
            <p className="mt-3 text-sm text-slate-600">
              Escreva <span className="font-mono font-semibold">{deleteTarget.siteId}</span> para confirmar:
            </p>
            <input
              className="input mt-3"
              value={deleteConfirmSiteId}
              onChange={(e) => setDeleteConfirmSiteId(e.target.value)}
              placeholder="site-id"
              autoFocus
            />
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-700">Confirmação por email</p>
              <p className="mt-1 text-xs text-slate-500">
                {deleteCodeSending
                  ? 'A enviar código…'
                  : deleteCodeSent && deleteCodeHint
                    ? `Código enviado para ${deleteCodeHint}. Válido 10 minutos.`
                    : 'Será enviado um código para o email do MASTER.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  className="input max-w-[10rem]"
                  value={deleteConfirmationCode}
                  onChange={(e) => setDeleteConfirmationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Código 6 dígitos"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={deleteCodeSending}
                  onClick={() => requestDeleteConfirmationCode(deleteTarget.id)}
                >
                  {deleteCodeSending ? 'A enviar…' : 'Reenviar código'}
                </button>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
    </>
  );
}
