'use client';

import { useState } from 'react';
import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsAlerts } from '@/components/settings/settings-alerts';
import { WhmcsSettingsPanel } from '@/components/whmcs/whmcs-settings-panel';

export default function SettingsWhmcsPage() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  return (
    <SettingsAccessGuard minRole="superadmin" moduleKey="whmcs">
      <SettingsAlerts
        error={error}
        success={success}
        onDismissError={() => setError('')}
        onDismissSuccess={() => setSuccess('')}
      />
      <WhmcsSettingsPanel onSuccess={setSuccess} onError={setError} />
    </SettingsAccessGuard>
  );
}
