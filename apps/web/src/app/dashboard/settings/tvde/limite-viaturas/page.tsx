'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsTvdeVehicleLimitsPanel } from '@/components/settings/settings-tvde-vehicle-limits-panel';

export default function TvdeLimiteViaturasPage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <SettingsTvdeVehicleLimitsPanel />
    </SettingsAccessGuard>
  );
}
