'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsAuditPanel } from '@/components/settings/settings-audit-panel';

export default function SettingsAuditPage() {
  return (
    <SettingsAccessGuard minRole="admin">
      <SettingsAuditPanel />
    </SettingsAccessGuard>
  );
}
