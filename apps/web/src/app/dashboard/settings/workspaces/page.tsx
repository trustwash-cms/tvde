'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsWorkspacesPanel } from '@/components/settings/settings-workspaces-panel';

export default function SettingsWorkspacesPage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <SettingsWorkspacesPanel />
    </SettingsAccessGuard>
  );
}
