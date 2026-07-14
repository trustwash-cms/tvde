'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsCalendarPanel } from '@/components/settings/settings-calendar-panel';

export default function SettingsCalendarPage() {
  return (
    <SettingsAccessGuard minRole="staff" moduleKey="calendar">
      <SettingsCalendarPanel />
    </SettingsAccessGuard>
  );
}
