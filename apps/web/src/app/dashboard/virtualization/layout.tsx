'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES, canAccessDashboardArea, type Role } from '@tvde/shared';
import { VIRTUALIZATION_MODULE_NAME } from '@tvde/shared';
import { ModuleAccessGuard } from '@/components/module-access-guard';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { VirtualizationSubNav } from '@/components/virtualization/virtualization-sub-nav';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

export default function VirtualizationLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspaceContext();
  const [roleChecked, setRoleChecked] = useState(false);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (!res.success || !res.data) {
        router.replace(WEB_ROUTES.login);
        return;
      }
      if (!canAccessDashboardArea(res.data.role, 'virtualization')) {
        router.replace(WEB_ROUTES.dashboard.root);
        return;
      }
      setRoleChecked(true);
    });
  }, [router]);

  if (!roleChecked) {
    return <p className="text-sm text-slate-500">A carregar…</p>;
  }

  return (
    <ModuleAccessGuard moduleKey="virtualization">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{VIRTUALIZATION_MODULE_NAME}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Monitorização Proxmox VE e Proxmox Backup Server.
            </p>
          </div>
          <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
        </div>
        <div className="flex flex-col gap-6 lg:flex-row">
          <VirtualizationSubNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </ModuleAccessGuard>
  );
}
