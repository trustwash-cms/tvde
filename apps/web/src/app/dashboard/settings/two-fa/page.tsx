'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsTwoFaPanel } from '@/components/settings/settings-two-fa-panel';

export default function SettingsTwoFaPage() {
  return (
    <SettingsAccessGuard minRole="staff">
      <SettingsTwoFaPanel />
    </SettingsAccessGuard>
  );
}
