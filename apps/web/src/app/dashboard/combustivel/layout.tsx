'use client';

import { FleetModuleShell } from '@/components/fleet-module-shell';

export default function CombustivelLayout({ children }: { children: React.ReactNode }) {
  return (
    <FleetModuleShell
      moduleKey="combustivel"
      title="Combustível"
      description="Abastecimentos e gestão de combustível."
    >
      {children}
    </FleetModuleShell>
  );
}
