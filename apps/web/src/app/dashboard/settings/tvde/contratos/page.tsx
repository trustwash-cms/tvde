'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { ModulePlaceholder } from '@/components/module-placeholder';

export default function TvdeContratosPage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <ModulePlaceholder title="Contratos" description="Contratos TVDE em preparação." />
    </SettingsAccessGuard>
  );
}
