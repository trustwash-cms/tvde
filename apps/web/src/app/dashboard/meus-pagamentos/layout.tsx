'use client';

import { FleetModuleShell } from '@/components/fleet-module-shell';

export default function MeusPagamentosLayout({ children }: { children: React.ReactNode }) {
  return (
    <FleetModuleShell
      moduleKey="pagamentos"
      title="Meus Pagamentos"
      description="Os seus relatórios de pagamento"
    >
      {children}
    </FleetModuleShell>
  );
}
