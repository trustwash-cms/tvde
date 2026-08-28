'use client';

import { WhatsappSettingsShell } from '@/components/whatsapp/whatsapp-settings-shell';

export default function WhatsappSettingsLayout({ children }: { children: React.ReactNode }) {
  return <WhatsappSettingsShell>{children}</WhatsappSettingsShell>;
}
