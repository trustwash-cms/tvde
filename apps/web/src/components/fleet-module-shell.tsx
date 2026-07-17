'use client';

import { FleetModuleLayout } from '@/components/fleet-module-layout';

export function FleetModuleShell({
  moduleKey,
  title,
  description,
  children,
}: {
  moduleKey: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <FleetModuleLayout moduleKey={moduleKey}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        {children}
      </div>
    </FleetModuleLayout>
  );
}
