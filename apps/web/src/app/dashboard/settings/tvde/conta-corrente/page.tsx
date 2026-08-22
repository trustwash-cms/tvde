'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';
import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';

export default function TvdeContaCorrentePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(WEB_ROUTES.dashboard.contaCorrente.root);
  }, [router]);

  return (
    <SettingsAccessGuard minRole="superadmin">
      <p className="text-sm text-slate-500">A redireccionar para Conta corrente…</p>
    </SettingsAccessGuard>
  );
}
