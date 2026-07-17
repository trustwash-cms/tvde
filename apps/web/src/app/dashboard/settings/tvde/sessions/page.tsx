'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsTvdeSessionsPanel } from '@/components/settings/settings-tvde-sessions-panel';

export default function TvdeSessionsPage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <SettingsTvdeSessionsPanel />
    </SettingsAccessGuard>
  );
}
