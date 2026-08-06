'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { SettingsAlerts } from '@/components/settings/settings-alerts';
import { MoloniSettingsPanel } from '@/components/moloni-settings-panel';

function moloniErrorFromQuery(reason: string | null): string {
  switch (reason) {
    case 'crypto':
      return (
        'Credenciais Moloni ilegíveis (ENCRYPTION_KEY alterada ou dados corrompidos). ' +
        'Guarde novamente o Client Secret e volte a ligar a conta Moloni (OAuth).'
      );
    case 'state_expired':
      return 'Ligação Moloni expirou — volte a clicar em «Ligar conta Moloni».';
    case 'state_invalid':
      return 'Estado OAuth inválido — volte a ligar a conta Moloni.';
    case 'oauth_denied':
      return 'Autorização Moloni cancelada ou incompleta — tente novamente.';
    default:
      return 'Falha ao ligar Moloni — tente novamente';
  }
}

export default function SettingsMoloniPage() {
  const searchParams = useSearchParams();
  const moloniParam = searchParams.get('moloni');
  const reason = searchParams.get('reason');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (moloniParam === 'connected') setSuccess('Moloni ligado com sucesso');
    if (moloniParam === 'error') setError(moloniErrorFromQuery(reason));
  }, [moloniParam, reason]);

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
