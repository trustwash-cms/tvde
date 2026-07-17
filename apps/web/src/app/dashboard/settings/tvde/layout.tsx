'use client';

import { TvdeSettingsSubNav } from '@/components/settings/tvde-settings-sub-nav';

export default function TvdeSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <TvdeSettingsSubNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
