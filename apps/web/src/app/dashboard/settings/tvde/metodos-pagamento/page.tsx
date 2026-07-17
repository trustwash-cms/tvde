'use client';

import { SettingsAccessGuard } from '@/components/settings/settings-access-guard';
import { ModulePlaceholder } from '@/components/module-placeholder';

export default function TvdeMetodosPagamentoPage() {
  return (
    <SettingsAccessGuard minRole="superadmin">
      <ModulePlaceholder title="Métodos de pagamento" description="Métodos de pagamento TVDE em preparação." />
    </SettingsAccessGuard>
  );
}
