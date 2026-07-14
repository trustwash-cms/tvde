'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsModulesPanel } from '@/components/settings/settings-modules-panel';

export default function SettingsModulesPage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <SettingsModulesPanel />
    </SettingsAccessGuard>
  );
}
