'use client';

import { FleetModuleShell } from '@/components/fleet-module-shell';

export default function ViaVerdeLayout({ children }: { children: React.ReactNode }) {
  return (
    <FleetModuleShell
      moduleKey="via_verde"
      title="Via Verde"
      description="Portagens e gestão Via Verde."
    >
      {children}
    </FleetModuleShell>
  );
}
