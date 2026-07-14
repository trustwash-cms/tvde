'use client';

import { useEffect, useState } from 'react';
import type { Role } from '@tvde/shared';
import { hasMinRole } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { getModuleLabel, hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';
import { ModuleInactiveMessage } from '@/components/module-inactive-message';

export function SettingsAccessGuard({
  minRole,
  moduleKey,
  children,
}: {
  minRole: Role;
  moduleKey?: string;
  children: React.ReactNode;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const [capabilities, setCapabilities] = useState<ModuleCapabilities | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ role: Role; capabilities?: ModuleCapabilities }>(API_PATHS.auth.me, {}, getStoredToken()).then(
      (res) => {
        if (res.data?.role) setRole(res.data.role);
        if (res.data?.capabilities) setCapabilities(res.data.capabilities);
        setLoading(false);
      }
    );
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar…</p>;
  }

  const moduleInactive =
    moduleKey && role ? !hasActiveModule(role, capabilities, moduleKey) && role !== 'master' : false;

  if (moduleInactive && moduleKey) {
    return <ModuleInactiveMessage moduleLabel={getModuleLabel(moduleKey)} />;
  }

  const moduleAllowed = !moduleKey || hasActiveModule(role ?? 'staff', capabilities, moduleKey);

  if (!role || !hasMinRole(role, minRole) || !moduleAllowed) {
    return (
      <div className="flex min-h-[min(320px,40vh)] items-center justify-center px-4">
        <div className="card max-w-md text-center text-sm text-slate-600">
          Sem permissão para aceder a esta secção de configuração.
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
