'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsTvdeStoragePanel } from '@/components/settings/settings-tvde-storage-panel';

export default function TvdeStoragePage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <SettingsTvdeStoragePanel />
    </SettingsAccessGuard>
  );
}
