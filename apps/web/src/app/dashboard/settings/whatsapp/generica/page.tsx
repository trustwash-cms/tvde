'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsWhatsappPanel } from '@/components/settings/settings-whatsapp-panel';

export default function SettingsWhatsappGenericPage() {
  return (
    <SettingsAccessGuard minRole="superadmin" moduleKey="whatsapp">
      <SettingsWhatsappPanel />
    </SettingsAccessGuard>
  );
}
