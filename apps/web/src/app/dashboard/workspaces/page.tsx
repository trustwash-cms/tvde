'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { WEB_ROUTES, hasMinRole, isHiddenActivationModule, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withSearchQuery } from '@/lib/list-search';
import ListPageSearch from '@/components/list-page-search';

interface ModuleRegistry {
  key: string;
  name: string;
  isCore: boolean;
}

interface WorkspaceModule {
  moduleKey: string;
  enabled: boolean;
  module: { name: string; isCore?: boolean };
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  tenant?: { id: string; name: string; siteId: string };
  workspaceModules?: WorkspaceModule[];
  _count?: { users: number };
}

interface AuthUser {
  role: Role;
  capabilities?: { allowedModules: string[]; activeModules: string[] };
}

function enabledBusinessCount(ws: Workspace, businessKeys: string[]) {
  return businessKeys.filter((key) =>
    ws.workspaceModules?.some((m) => m.moduleKey === key && m.enabled)
  ).length;
}

/** Vista MASTER — superadmin usa Configurações → Workspaces. */
function WorkspacesMasterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [allModules, setAllModules] = useState<ModuleRegistry[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);
  const [expandedWorkspace, setExpandedWorkspace] = useState<string | null>(null);

  const manageModules = user ? hasMinRole(user.role, 'superadmin') : false;
  const allowedKeys = user?.capabilities?.allowedModules ?? allModules.filter((m) => !m.isCore).map((m) => m.key);

  const businessKeys = useMemo(
    () =>
      allModules
        .filter(
          (m) =>
            !m.isCore &&
            allowedKeys.includes(m.key) &&
            !isHiddenActivationModule(m.key)
        )
        .map((m) => m.key),
    [allModules, allowedKeys]
  );

  const groupedByTenant = useMemo(() => {
    const map = new Map<string, { tenant: NonNullable<Workspace['tenant']>; workspaces: Workspace[] }>();
    for (const ws of workspaces) {
      const tenant = ws.tenant ?? { id: 'local', name: 'Meu tenant', siteId: '—' };
      const entry = map.get(tenant.id) ?? { tenant, workspaces: [] };
      entry.workspaces.push(ws);
      map.set(tenant.id, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.tenant.name.localeCompare(b.tenant.name));
  }, [workspaces]);

  function load() {
    const token = getStoredToken();
    apiFetch<Workspace[]>(withSearchQuery(API_PATHS.workspaces.list, q), {}, token).then((res) => {
      if (res.data) setWorkspaces(res.data);
    });
  }

  useEffect(() => {
    const token = getStoredToken();
    apiFetch<AuthUser>(API_PATHS.auth.me, {}, token).then((res) => {
      if (res.data) {
        const authUser = res.data as AuthUser;
        if (authUser.role === 'superadmin') {
          const query = q ? `?q=${encodeURIComponent(q)}` : '';
          router.replace(`${WEB_ROUTES.dashboard.settings.workspaces}${query}`);
          return;
        }
        setUser(authUser);
      }
    });
    apiFetch<ModuleRegistry[]>(API_PATHS.modules.list, {}, token).then((res) => {
      if (res.data) setAllModules(res.data);
    });
  }, [router, q]);

  useEffect(() => {
    if (user?.role === 'master') load();
  }, [user?.role, q]);

  async function toggleModule(workspaceId: string, moduleKey: string, enabled: boolean) {
    const key = `${workspaceId}:${moduleKey}`;
    setToggling(key);
    setError('');
    const res = await apiFetch(
      API_PATHS.workspaces.module(workspaceId, moduleKey),
      { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) },
      getStoredToken()
    );
    if (res.success) load();
    else setError(getApiErrorMessage(res));
    setToggling(null);
  }

  function businessModulesFor(ws: Workspace) {
    return businessKeys.map((key) => {
      const reg = allModules.find((m) => m.key === key)!;
      const wm = ws.workspaceModules?.find((m) => m.moduleKey === key);
      return { key, name: reg.name, enabled: wm?.enabled ?? false };
    });
  }

  function renderWorkspaceModules(ws: Workspace) {
    const mods = businessModulesFor(ws);
    const open = expandedWorkspace === ws.id;

    return (
      <>
        <tr
          className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${open ? 'bg-slate-50' : ''}`}
          onClick={() => setExpandedWorkspace(open ? null : ws.id)}
        >
          <td className="px-3 py-2.5">
            <span className="inline-flex items-center gap-1.5 font-medium">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {ws.name}
            </span>
          </td>
          <td className="px-3 py-2.5 text-slate-500">{ws.slug}</td>
          <td className="px-3 py-2.5 text-slate-500">{ws.type}</td>
          <td className="px-3 py-2.5">
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{ws.status}</span>
          </td>
          <td className="px-3 py-2.5 text-center text-slate-500">{ws._count?.users ?? 0}</td>
          <td className="px-3 py-2.5 text-right text-xs text-slate-500">
            {enabledBusinessCount(ws, businessKeys)}/{businessKeys.length} módulos
          </td>
        </tr>
        {open && (
          <tr className="border-b border-slate-100 bg-slate-50/80">
            <td colSpan={6} className="px-6 py-3">
              {mods.length === 0 ? (
                <p className="text-sm text-slate-400">Nenhum módulo autorizado pelo MASTER</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {mods.map((mod) => {
                    const toggleKey = `${ws.id}:${mod.key}`;
                    const busy = toggling === toggleKey;
                    return (
                      <div
                        key={mod.key}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                      >
                        <span>{mod.name}</span>
                        {manageModules ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={mod.enabled}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleModule(ws.id, mod.key, mod.enabled);
                            }}
                            className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${
                              mod.enabled ? 'bg-[var(--color-primary)]' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                                mod.enabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        ) : (
                          <span className={`text-xs ${mod.enabled ? 'text-green-600' : 'text-slate-400'}`}>
                            {mod.enabled ? 'on' : 'off'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </td>
          </tr>
        )}
      </>
    );
  }

  function renderTenantGroup(
    tenant: NonNullable<Workspace['tenant']>,
    tenantWorkspaces: Workspace[]
  ) {
    const open = expandedTenant === tenant.id;

    return (
      <div key={tenant.id} className="card overflow-hidden p-0">
        <button
          type="button"
          className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50"
          onClick={() => setExpandedTenant(open ? null : tenant.id)}
        >
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{tenant.name}</span>
            <span className="ml-2 text-xs text-slate-500">{tenant.siteId}</span>
          </div>
          <span className="text-xs text-slate-500">{tenantWorkspaces.length} workspace(s)</span>
        </button>

        {open && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Slug</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-center">Users</th>
                  <th className="px-3 py-2 text-right">Módulos</th>
                </tr>
              </thead>
              <tbody>{tenantWorkspaces.map((ws) => renderWorkspaceModules(ws))}</tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (!user || user.role !== 'master') {
    return <p className="text-sm text-slate-500">A carregar…</p>;
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Workspaces</h1>
      <p className="mb-4 text-slate-500">Agrupados por tenant — clique na linha para activar módulos</p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <ListPageSearch placeholder="Pesquisar workspaces (nome, slug, tenant)…" />

      <div className="space-y-3">
        {groupedByTenant.map(({ tenant, workspaces: wsList }) => renderTenantGroup(tenant, wsList))}

        {workspaces.length === 0 && (
          <div className="card py-10 text-center text-slate-400">Sem workspaces</div>
        )}
      </div>
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">A carregar…</p>}>
      <WorkspacesMasterPage />
    </Suspense>
  );
}
