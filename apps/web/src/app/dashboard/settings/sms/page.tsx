'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsSmsPanel } from '@/components/settings/settings-sms-panel';

export default function SettingsSmsPage() {
  return (
    <SettingsAccessGuard minRole="superadmin" moduleKey="sms">
      <SettingsSmsPanel />
    </SettingsAccessGuard>
  );
}
