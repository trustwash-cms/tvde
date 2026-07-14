'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsSmtpPanel } from '@/components/settings/settings-smtp-panel';

export default function SettingsSmtpPage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <SettingsSmtpPanel />
    </SettingsAccessGuard>
  );
}
