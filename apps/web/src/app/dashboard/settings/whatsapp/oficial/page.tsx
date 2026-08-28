'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { WhatsappOfficialPanel } from '@/components/whatsapp/whatsapp-official-panel';

export default function SettingsWhatsappOfficialPage() {
  return (
    <SettingsAccessGuard minRole="superadmin" moduleKey="whatsapp">
      <WhatsappOfficialPanel />
    </SettingsAccessGuard>
  );
}
