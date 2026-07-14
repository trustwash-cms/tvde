'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsGeneralPanel } from '@/components/settings/settings-general-panel';

export default function SettingsGeneralPage() {
  return (
    <SettingsAccessGuard minRole="staff">
      <SettingsGeneralPanel />
    </SettingsAccessGuard>
  );
}
