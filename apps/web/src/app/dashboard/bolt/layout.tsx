'use client';

import { ModuleAccessGuard } from '@/components/module-access-guard';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { BoltSubNav } from '@/components/bolt/bolt-sub-nav';

export default function BoltLayout({ children }: { children: React.ReactNode }) {
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspaceContext();

  return (
    <ModuleAccessGuard moduleKey="bolt">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Bolt</h1>
            <p className="mt-1 text-sm text-slate-500">
              Pedidos, motoristas e veículos sincronizados da API Bolt.
            </p>
          </div>
          <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
        </div>
        <div className="flex flex-col gap-6 lg:flex-row">
          <BoltSubNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </ModuleAccessGuard>
  );
}
