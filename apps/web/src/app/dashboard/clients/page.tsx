'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight, Receipt, UserCircle } from 'lucide-react';
import type { Role } from '@tvde/shared';
import { API_PATHS, apiFetch, appName, getStoredToken } from '@/lib/api';
import { BillingHubLinks, ClientsHubCard } from '@/components/clients-hub-card';
import { withSearchQuery } from '@/lib/list-search';
import ListPageSearch from '@/components/list-page-search';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface OrgUser {
  id: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

interface MasterTenantNode {
  tenant: {
    id: string;
    siteId: string;
    name: string;
    plan: string;
    status: string;
    workspaceCount: number;
  };
  superadmin: OrgUser | null;
  admins: OrgUser[];
  staff: OrgUser[];
}

interface MasterHierarchy {
  view: 'master';
  tenants: MasterTenantNode[];
}

interface SuperadminHierarchy {
  view: 'superadmin';
  admins: OrgUser[];
  staff: OrgUser[];
}

interface AdminHierarchy {
  view: 'admin';
  staff: OrgUser[];
}

type HierarchyData = MasterHierarchy | SuperadminHierarchy | AdminHierarchy;

interface CrmClient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  nif: string | null;
  status: string;
}

const emptyForm = { name: '', email: '', phone: '', nif: '' };

function UserRow({ user, indent = false }: { user: OrgUser; indent?: boolean }) {
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className={`px-4 py-2.5 ${indent ? 'pl-8' : ''}`}>
        <span className="font-medium">{user.email}</span>
      </td>
      <td className="px-4 py-2.5">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase">{user.role}</span>
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'
          }`}
        >
          {user.status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-slate-500">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('pt-PT') : '—'}
      </td>
    </tr>
  );
}

function OrganizationHierarchyView({ data }: { data: HierarchyData }) {
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);

  if (data.view === 'master') {
    return (
      <div className="space-y-2">
        {data.tenants.map((node) => {
          const open = expandedTenant === node.tenant.id;
          const teamCount = (node.superadmin ? 1 : 0) + node.admins.length + node.staff.length;
          return (
            <div key={node.tenant.id} className="card overflow-hidden p-0">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                onClick={() => setExpandedTenant(open ? null : node.tenant.id)}
              >
                {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{node.tenant.name}</div>
                  <div className="text-xs text-slate-500">
                    {node.tenant.siteId} · {node.tenant.plan} · {node.tenant.workspaceCount} workspace(s)
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  {node.superadmin ? (
                    <span className="block truncate">{node.superadmin.email}</span>
                  ) : (
                    <span className="text-amber-600">Sem gestor de frota</span>
                  )}
                  <span>{teamCount} utilizador(es)</span>
                </div>
              </button>

              {open && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="pb-2 pl-4">Utilizador</th>
                        <th className="pb-2">Role</th>
                        <th className="pb-2">Estado</th>
                        <th className="pb-2">Último login</th>
                      </tr>
                    </thead>
                    <tbody className="rounded-lg bg-white">
                      {node.superadmin && (
                        <>
                          <tr className="bg-[var(--color-primary-light)]/40">
                            <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-[var(--color-primary)]">
                              Super Admin
                            </td>
                          </tr>
                          <UserRow user={node.superadmin} indent />
                        </>
                      )}
                      {node.admins.length > 0 && (
                        <>
                          <tr className="bg-slate-50">
                            <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-slate-500">
                              Admins ({node.admins.length})
                            </td>
                          </tr>
                          {node.admins.map((u) => (
                            <UserRow key={u.id} user={u} indent />
                          ))}
                        </>
                      )}
                      {node.staff.length > 0 && (
                        <>
                          <tr className="bg-slate-50">
                            <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-slate-500">
                              Staff ({node.staff.length})
                            </td>
                          </tr>
                          {node.staff.map((u) => (
                            <UserRow key={u.id} user={u} indent />
                          ))}
                        </>
                      )}
                      {!node.superadmin && node.admins.length === 0 && node.staff.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                            Sem utilizadores neste tenant
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {data.tenants.length === 0 && (
          <div className="card py-10 text-center text-slate-400">Sem tenants</div>
        )}
      </div>
    );
  }

  if (data.view === 'superadmin') {
    return (
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Utilizador</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Último login</th>
            </tr>
          </thead>
          <tbody>
            {data.admins.length > 0 && (
              <>
                <tr className="bg-slate-50">
                  <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-slate-500">
                    Admins ({data.admins.length})
                  </td>
                </tr>
                {data.admins.map((u) => (
                  <UserRow key={u.id} user={u} indent />
                ))}
              </>
            )}
            {data.staff.length > 0 && (
              <>
                <tr className="bg-slate-50">
                  <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-slate-500">
                    Staff ({data.staff.length})
                  </td>
                </tr>
                {data.staff.map((u) => (
                  <UserRow key={u.id} user={u} indent />
                ))}
              </>
            )}
            {data.admins.length === 0 && data.staff.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  Sem admins ou staff — crie em Utilizadores
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <table className="w-full text-sm">
        <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3">Utilizador</th>
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3">Último login</th>
          </tr>
        </thead>
        <tbody>
          {data.staff.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
          {data.staff.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                Sem staff — crie em Utilizadores
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CrmClientsView({ q }: { q: string | null }) {
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { confirm, confirmDialog } = useConfirmDialog();

  function load() {
    apiFetch<CrmClient[]>(withSearchQuery(API_PATHS.clients.list, q), {}, getStoredToken()).then((res) => {
      if (res.data) setClients(res.data);
    });
  }

  useEffect(load, [q]);

  function startEdit(client: CrmClient) {
    setEditingId(client.id);
    setForm({
      name: client.name,
      email: client.email ?? '',
      phone: client.phone ?? '',
      nif: client.nif ?? '',
    });
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const token = getStoredToken();
    const payload = {
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      nif: form.nif || null,
    };

    const res = editingId
      ? await apiFetch(API_PATHS.clients.byId(editingId), {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }, token)
      : await apiFetch(API_PATHS.clients.list, {
          method: 'POST',
          body: JSON.stringify(form),
        }, token);

    if (res.success) {
      cancelEdit();
      load();
    } else {
      setError(res.error ?? 'Operação falhou');
    }
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: 'Eliminar cliente',
      message: `Eliminar cliente «${name}»?`,
      variant: 'danger',
    });
    if (!ok) return;
    setError('');
    const res = await apiFetch(API_PATHS.clients.byId(id), { method: 'DELETE' }, getStoredToken());
    if (res.success) {
      if (editingId === id) cancelEdit();
      load();
    } else {
      setError(res.error ?? 'Eliminação falhou');
    }
  }

  return (
    <>
      {confirmDialog}
      <form onSubmit={handleSubmit} className="mb-4 grid gap-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4 md:grid-cols-6">
        <input className="input md:col-span-1" placeholder="Nome *" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="input md:col-span-1" placeholder="Email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="input md:col-span-1" placeholder="Telefone" value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input className="input md:col-span-1" placeholder="NIF" value={form.nif}
          onChange={(e) => setForm({ ...form, nif: e.target.value })} />
        <button type="submit" className="btn-primary md:col-span-1">
          {editingId ? 'Guardar' : 'Adicionar'}
        </button>
        {editingId && (
          <button type="button" className="btn-secondary md:col-span-1" onClick={cancelEdit}>
            Cancelar
          </button>
        )}
      </form>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-6 py-3">Nome</th>
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Telefone</th>
              <th className="px-6 py-3">NIF</th>
              <th className="px-6 py-3 text-right">Acções</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-6 py-4 font-medium">{c.name}</td>
                <td className="px-6 py-4">{c.email ?? '—'}</td>
                <td className="px-6 py-4">{c.phone ?? '—'}</td>
                <td className="px-6 py-4">{c.nif ?? '—'}</td>
                <td className="px-6 py-4 text-right">
                  <button type="button" className="mr-2 text-[var(--color-primary)] hover:underline"
                    onClick={() => startEdit(c)}>Editar</button>
                  <button type="button" className="text-red-600 hover:underline"
                    onClick={() => handleDelete(c.id, c.name)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">Sem clientes CRM</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface ModuleCapabilities {
  activeModules: string[];
}

export default function ClientsPage() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q');
  const [role, setRole] = useState<Role | null>(null);
  const [activeModules, setActiveModules] = useState<string[]>([]);
  const [hierarchy, setHierarchy] = useState<HierarchyData | null>(null);
  const [loading, setLoading] = useState(true);

  const isOrgView = role === 'master' || role === 'superadmin' || role === 'admin';
  const hasBilling =
    role === 'master' ||
    role === 'superadmin' ||
    role === 'admin' ||
    activeModules.includes('billing');

  useEffect(() => {
    const token = getStoredToken();
    apiFetch<{ role: Role; capabilities?: ModuleCapabilities }>(API_PATHS.auth.me, {}, token).then(
      (res) => {
        if (res.data?.role) setRole(res.data.role);
        if (res.data?.capabilities?.activeModules) {
          setActiveModules(res.data.capabilities.activeModules);
        }
      }
    );
  }, []);

  useEffect(() => {
    if (!role) return;
    if (role === 'staff') {
      setLoading(false);
      return;
    }
    apiFetch<HierarchyData>(
      withSearchQuery(API_PATHS.clients.hierarchy, q),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setHierarchy(res.data);
      setLoading(false);
    });
  }, [role, q]);

  const appCardDescriptions: Record<string, string> = {
    master:
      'Clientes da plataforma (tenants) e respetivas equipas — gestores de frota, motoristas e staff. Não são clientes fiscais.',
    superadmin: 'Equipa do seu tenant: motoristas e staff com acesso à plataforma.',
    admin: 'Staff da sua equipa com acesso ao workspace.',
    staff: 'Contactos e relações no CRM do workspace — leads, parceiros, histórico da app.',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Clientes</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          O termo «cliente» aparece em dois contextos:{' '}
          <span className="text-slate-700">contactos da app ({appName})</span> e{' '}
          <span className="text-slate-700">clientes fiscais (Moloni)</span> para emitir documentos.
          São listas independentes.
        </p>
      </div>

      <div className={`grid gap-6 ${hasBilling ? 'lg:grid-cols-2' : ''}`}>
        <ClientsHubCard
          title={`Clientes (${appName})`}
          description={role ? appCardDescriptions[role] : '…'}
          icon={UserCircle}
        >
          <ListPageSearch
            placeholder={
              role === 'staff'
                ? 'Pesquisar contactos (nome, email, NIF)…'
                : 'Pesquisar tenants / equipa (nome, email)…'
            }
          />

          {loading && <div className="text-slate-400">A carregar…</div>}

          {!loading && isOrgView && hierarchy && (
            <OrganizationHierarchyView data={hierarchy} />
          )}

          {!loading && role === 'staff' && <CrmClientsView q={q} />}
        </ClientsHubCard>

        {hasBilling && (
          <ClientsHubCard
            title="Faturação"
            description="Clientes e fornecedores fiscais para faturas, sincronizados com Moloni. Crie na fatura ou importe em Configurações → Moloni."
            icon={Receipt}
            footer={<BillingHubLinks />}
          >
            <ul className="space-y-2 text-sm text-slate-600">
              <li>· NIF e morada fiscal para documentos legais</li>
              <li>· Separado do CRM — ligação opcional por NIF</li>
              <li>· Novo cliente rápido em Facturação → Faturas</li>
            </ul>
          </ClientsHubCard>
        )}
      </div>
    </div>
  );
}
