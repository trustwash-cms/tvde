'use client';

import { ModuleAccessGuard } from '@/components/module-access-guard';
import { WhmcsSubNav } from '@/components/whmcs/whmcs-sub-nav';

export default function WhmcsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleAccessGuard moduleKey="whmcs">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">WHMCS</h1>
          <p className="text-slate-500">
            Consulta WHMCS com edição de clientes e gestão completa de faturas (ver, editar, estados,
            apagar / cancelar).
          </p>
        </div>

        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <aside className="w-full shrink-0 lg:w-56">
            <WhmcsSubNav />
          </aside>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </ModuleAccessGuard>
  );
}
