'use client';

import { FleetModuleShell } from '@/components/fleet-module-shell';

export default function ContaCorrenteLayout({ children }: { children: React.ReactNode }) {
  return (
    <FleetModuleShell
      moduleKey="pagamentos"
      title="Conta Corrente dos Motoristas"
      description="Créditos e débitos ocasionais dos motoristas"
    >
      {children}
    </FleetModuleShell>
  );
}
