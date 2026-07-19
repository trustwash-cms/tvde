'use client';

import { FleetModuleShell } from '@/components/fleet-module-shell';

export default function PagamentosLayout({ children }: { children: React.ReactNode }) {
  return (
    <FleetModuleShell
      moduleKey="pagamentos"
      title="Pagamentos"
      description="Gestão de pagamentos dos motoristas"
    >
      {children}
    </FleetModuleShell>
  );
}
