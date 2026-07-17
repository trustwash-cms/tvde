'use client';

import { ModuleAccessGuard } from '@/components/module-access-guard';

export function FleetModuleLayout({
  moduleKey,
  children,
}: {
  moduleKey: string;
  children: React.ReactNode;
}) {
  return <ModuleAccessGuard moduleKey={moduleKey}>{children}</ModuleAccessGuard>;
}
