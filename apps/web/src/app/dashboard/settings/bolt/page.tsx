'use client';

import { useState } from 'react';
import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsAlerts } from '@/components/settings/settings-alerts';
import { BoltSettingsPanel } from '@/components/bolt/bolt-settings-panel';

export default function SettingsBoltPage() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  return (
    <SettingsAccessGuard minRole="superadmin" moduleKey="bolt">
      <SettingsAlerts error={error} success={success} onDismissError={() => setError('')} onDismissSuccess={() => setSuccess('')} />
      <BoltSettingsPanel onSuccess={setSuccess} onError={setError} />
    </SettingsAccessGuard>
  );
}
