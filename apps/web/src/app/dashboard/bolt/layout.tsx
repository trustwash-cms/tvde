'use client';

import { useEffect, useState } from 'react';
import { ModuleAccessGuard } from '@/components/module-access-guard';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { BoltSubNav } from '@/components/bolt/bolt-sub-nav';
import { BoltDriverPanel } from '@/components/bolt/bolt-driver-panel';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { isDriverRole, type Role } from '@tvde/shared';

export default function BoltLayout({ children }: { children: React.ReactNode }) {
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspaceContext();
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.role) setRole(res.data.role);
    });
  }, []);

  const driverMode = role != null && isDriverRole(role);

  return (
    <ModuleAccessGuard moduleKey="bolt">
      {driverMode ? (
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Bolt</h1>
            <p className="mt-1 text-sm text-slate-500">As suas corridas e valores na Bolt.</p>
          </div>
          {/* Workspace necessário para a API; escondido na UI do motorista */}
          <div className="hidden">
            <WorkspaceSelector
              workspaces={workspaces}
              workspaceId={workspaceId}
              onChange={setWorkspaceId}
            />
          </div>
          <BoltDriverPanel />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Bolt</h1>
              <p className="mt-1 text-sm text-slate-500">
                Pedidos, motoristas e veículos sincronizados da API Bolt.
              </p>
            </div>
            <WorkspaceSelector
              workspaces={workspaces}
              workspaceId={workspaceId}
              onChange={setWorkspaceId}
            />
          </div>
          <div className="flex flex-col gap-6 lg:flex-row">
            <BoltSubNav />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </div>
      )}
    </ModuleAccessGuard>
  );
}
