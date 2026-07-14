'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsAlerts } from '@/components/settings/settings-alerts';
import { MoloniSettingsPanel } from '@/components/moloni-settings-panel';

export default function SettingsMoloniPage() {
  const searchParams = useSearchParams();
  const moloniParam = searchParams.get('moloni');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (moloniParam === 'connected') setSuccess('Moloni ligado com sucesso');
    if (moloniParam === 'error') setError('Falha ao ligar Moloni — tente novamente');
  }, [moloniParam]);

  return (
    <SettingsAccessGuard minRole="superadmin" moduleKey="billing">
      <div className="space-y-4">
        <SettingsAlerts error={error} success={success} onDismissError={() => setError('')} onDismissSuccess={() => setSuccess('')} />
        <MoloniSettingsPanel
          onSuccess={(message) => {
            setError('');
            setSuccess(message);
          }}
          onError={(message) => {
            setSuccess('');
            setError(message);
          }}
        />
      </div>
    </SettingsAccessGuard>
  );
}
