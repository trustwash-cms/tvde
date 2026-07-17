'use client';

import { FleetModuleShell } from '@/components/fleet-module-shell';

export default function UberLayout({ children }: { children: React.ReactNode }) {
  return (
    <FleetModuleShell moduleKey="uber" title="Uber" description="Integração e gestão Uber.">
      {children}
    </FleetModuleShell>
  );
}
