'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsFail2banPanel } from '@/components/settings/settings-fail2ban-panel';

export default function SettingsSecurityPage() {
  return (
    <SettingsAccessGuard minRole="master">
      <SettingsFail2banPanel />
    </SettingsAccessGuard>
  );
}
