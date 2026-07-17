'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { ModulePlaceholder } from '@/components/module-placeholder';

export default function TvdeContaCorrentePage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <ModulePlaceholder title="Conta corrente" description="Conta corrente TVDE em preparação." />
    </SettingsAccessGuard>
  );
}
