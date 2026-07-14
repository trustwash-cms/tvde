'use client';

import { ModuleAccessGuard } from '@/components/module-access-guard';
import { BillingSubNav } from '@/components/billing/billing-sub-nav';

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleAccessGuard moduleKey="billing">
      <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Facturação</h1>
        <p className="text-slate-500">Documentos de venda Moloni e entidades (clientes / fornecedores).</p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:w-64">
          <BillingSubNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
    </ModuleAccessGuard>
  );
}
