'use client';

import { FleetModuleShell } from '@/components/fleet-module-shell';

export default function EletricidadeLayout({ children }: { children: React.ReactNode }) {
  return (
    <FleetModuleShell
      moduleKey="eletricidade"
      title="Eletricidade"
      description="Consumos e custos de eletricidade da frota."
    >
      {children}
    </FleetModuleShell>
  );
}
