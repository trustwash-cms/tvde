'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Layers } from 'lucide-react';
import { WEB_ROUTES, filterTvdeModules } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { ModuleHealthBadge, type ModuleHealthStatus } from '@/components/module-health-badge';

interface Module {
  key: string;
  name: string;
  description: string | null;
  isCore: boolean;
  version: string;
}

interface ModuleHealth {
  key: string;
  status: ModuleHealthStatus;
  label: string;
  detail?: string;
}

const CONFIG_LINKS: Partial<Record<string, string>> = {
  sms: WEB_ROUTES.dashboard.settings.sms,
  billing: WEB_ROUTES.dashboard.settings.moloni,
  whmcs: WEB_ROUTES.dashboard.settings.whmcs,
  bolt: WEB_ROUTES.dashboard.settings.bolt,
  calendar: WEB_ROUTES.dashboard.settings.calendar,
};

function moduleAction(
  mod: Module,
  health: ModuleHealth | undefined
): { href: string; label: string } | null {
  if (mod.isCore) return null;

  const configHref = CONFIG_LINKS[mod.key];
  if (configHref && health && (health.status === 'error' || health.status === 'warning')) {
    return { href: configHref, label: 'Configurar' };
  }

  if (health?.status === 'inactive' || health?.status === 'warning') {
    return { href: WEB_ROUTES.dashboard.settings.workspaces, label: 'Workspaces' };
  }

  if (configHref && health?.status === 'ok') {
    return { href: configHref, label: 'Ver config' };
  }

  return null;
}

function ModuleCard({ mod, health }: { mod: Module; health?: ModuleHealth }) {
  const action = moduleAction(mod, health);

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{mod.name}</div>
          {mod.description && <p className="mt-1 text-xs text-slate-500">{mod.description}</p>}
        </div>
        {health && (
          <ModuleHealthBadge
            status={health.status}
            label={health.label}
            title={health.detail}
          />
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        {mod.isCore ? (
          <span className="text-[10px] text-slate-400">v{mod.version}</span>
        ) : (
          <span className="font-mono text-[10px] text-slate-400">{mod.key}</span>
        )}
        {action && (
          <Link
            href={action.href}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            {action.label}
            <ExternalLink size={12} />
          </Link>
        )}
      </div>

      {health?.detail && (
        <p className="-mt-1 text-[11px] text-slate-400">{health.detail}</p>
      )}
    </div>
  );
}

export function SettingsModulesPanel() {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [modules, setModules] = useState<Module[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, ModuleHealth>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const token = getStoredToken();
    const healthPath = workspaceId
      ? withWorkspaceQuery(API_PATHS.modules.health, workspaceId)
      : API_PATHS.modules.health;

    Promise.all([
      apiFetch<Module[]>(API_PATHS.modules.list, {}, token),
      apiFetch<ModuleHealth[]>(healthPath, {}, token),
    ]).then(([modsRes, healthRes]) => {
      if (modsRes.data) setModules(filterTvdeModules(modsRes.data));
      if (healthRes.data) {
        setHealthMap(Object.fromEntries(healthRes.data.map((h) => [h.key, h])));
      }
      setLoading(false);
    });
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const core = useMemo(() => modules.filter((m) => m.isCore), [modules]);
  const business = useMemo(() => modules.filter((m) => !m.isCore), [modules]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Módulos</h2>
        <p className="mt-1 text-sm text-slate-500">
          Estado dos módulos do sistema — activação em Configurações → Workspaces (excepto Clientes CRM,
          activado pelo MASTER); integrações nas restantes secções.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Layers size={16} className="text-slate-400" />
          <span>Workspace para verificar integrações (Moloni, etc.)</span>
        </div>
        <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
      </div>

      {!wsLoading && !workspaceId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seleccione um workspace para avaliar a saúde das integrações de facturação.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">A carregar módulos…</p>
      ) : (
        <>
          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-primary)]">
              Core (sempre activo)
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {core.map((m) => (
                <ModuleCard key={m.key} mod={m} health={healthMap[m.key]} />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-teal)]">
              Negócio
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {business.map((m) => (
                <ModuleCard key={m.key} mod={m} health={healthMap[m.key]} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
