'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { hasMinRole, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';

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

interface WorkspaceQuota {
  maxWorkspaces: number;
  used: number;
  canRequestMore: boolean;
  pendingRequests: number;
}

interface WorkspaceRequest {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  createdAt: string;
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

export function SettingsWorkspacesPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [requests, setRequests] = useState<WorkspaceRequest[]>([]);
  const [quota, setQuota] = useState<WorkspaceQuota | null>(null);
  const [allModules, setAllModules] = useState<ModuleRegistry[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', type: 'general' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  const [expandedWorkspace, setExpandedWorkspace] = useState<string | null>(null);

  const manageModules = user ? hasMinRole(user.role, 'superadmin') : false;
  const allowedKeys = user?.capabilities?.allowedModules ?? allModules.filter((m) => !m.isCore).map((m) => m.key);
  const canRequest = quota?.canRequestMore && (quota?.pendingRequests ?? 0) === 0;

  const businessKeys = useMemo(
    () =>
      allModules
        .filter((m) => !m.isCore && allowedKeys.includes(m.key) && m.key !== 'clients')
        .map((m) => m.key),
    [allModules, allowedKeys]
  );

  function load() {
    const token = getStoredToken();
    apiFetch<Workspace[]>(API_PATHS.workspaces.list, {}, token).then((res) => {
      if (res.data) setWorkspaces(res.data);
    });
    apiFetch<WorkspaceQuota>(API_PATHS.workspaces.quota, {}, token).then((res) => {
      if (res.data) setQuota(res.data);
    });
    apiFetch<WorkspaceRequest[]>(API_PATHS.workspaceRequests.list, {}, token).then((res) => {
      if (res.data) setRequests(res.data);
    });
  }

  useEffect(() => {
    const token = getStoredToken();
    apiFetch<AuthUser>(API_PATHS.auth.me, {}, token).then((res) => {
      if (res.data) setUser(res.data as AuthUser);
    });
    apiFetch<ModuleRegistry[]>(API_PATHS.modules.list, {}, token).then((res) => {
      if (res.data) setAllModules(res.data);
    });
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user?.role]);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const res = await apiFetch(
      API_PATHS.workspaceRequests.list,
      {
        method: 'POST',
        body: JSON.stringify(form),
      },
      getStoredToken()
    );
    if (res.success) {
      setForm({ name: '', slug: '', type: 'general' });
      setSuccess('Pedido enviado — aguarda aprovação do MASTER');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

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

  const pendingRequests = requests.filter((r) => r.status === 'pending');

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Workspaces</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cada tenant começa com 1 workspace. Adicionais requerem aprovação do MASTER.
        </p>
      </div>

      {quota && (
        <p className="text-sm text-slate-600">
          O seu tenant tem <span className="font-medium">{quota.used}</span> de{' '}
          <span className="font-medium">{quota.maxWorkspaces}</span> workspace(s) autorizado(s).
          {quota.pendingRequests > 0 && (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              {quota.pendingRequests} pedido(s) pendente(s)
            </span>
          )}
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      {canRequest && (
        <form onSubmit={handleRequest} className="card grid gap-4 md:grid-cols-4">
          <div className="md:col-span-4">
            <p className="text-sm font-medium text-slate-700">Pedir workspace adicional</p>
            <p className="text-xs text-slate-500">O MASTER aprova antes de ficar disponível.</p>
          </div>
          <input
            className="input"
            placeholder="Nome"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder="slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder="tipo"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          />
          <button type="submit" className="btn-primary">
            Pedir workspace
          </button>
        </form>
      )}

      {pendingRequests.length > 0 && (
        <div className="card py-3">
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
            Pedidos pendentes
          </h3>
          <ul className="space-y-1 text-sm">
            {pendingRequests.map((r) => (
              <li key={r.id} className="flex justify-between rounded-lg bg-amber-50 px-3 py-2">
                <span>
                  {r.name} <span className="text-slate-500">({r.slug})</span>
                </span>
                <span className="text-amber-700">Aguarda MASTER</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-hidden p-0">
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
            <tbody>
              {workspaces.map((ws) => renderWorkspaceModules(ws))}
            </tbody>
          </table>
        </div>
        {workspaces.length === 0 && (
          <div className="py-10 text-center text-slate-400">Sem workspaces</div>
        )}
      </div>

      {workspaces.length > 0 && (
        <p className="text-xs text-slate-500">
          Clique numa linha para activar ou desactivar módulos de negócio neste workspace.
        </p>
      )}
    </div>
  );
}
