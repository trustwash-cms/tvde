'use client';

import { ADMIN_MGMT_MODULE_NAME } from '@tvde/shared';
import { ModuleAccessGuard } from '@/components/module-access-guard';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { AdminMgmtSubNav } from '@/components/admin-mgmt/admin-mgmt-sub-nav';

export default function AdminMgmtLayout({ children }: { children: React.ReactNode }) {
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspaceContext();

  return (
    <ModuleAccessGuard moduleKey="admin_mgmt">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{ADMIN_MGMT_MODULE_NAME}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Seguros, contratos, pessoal, fiscal e alertas de vencimentos.
            </p>
          </div>
          <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
        </div>
        <div className="flex flex-col gap-6 lg:flex-row">
          <AdminMgmtSubNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </ModuleAccessGuard>
  );
}
