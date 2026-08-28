'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role, WhatsappProvider } from '@tvde/shared';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { WhatsappSettingsTabs } from '@/components/whatsapp/whatsapp-settings-tabs';
import { WhatsappProviderSelector } from '@/components/whatsapp/whatsapp-provider-selector';
import { SettingsWhatsappMasterPanel } from '@/components/settings/settings-whatsapp-master-panel';

export const WHATSAPP_PROVIDER_CHANGED_EVENT = 'whatsapp-provider-changed';

export function WhatsappSettingsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<WhatsappProvider>('generic');

  useEffect(() => {
    Promise.all([
      apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()),
      apiFetch<{ provider: WhatsappProvider }>(API_PATHS.whatsappBusiness.provider, {}, getStoredToken()),
    ]).then(([me, providerRes]) => {
      if (me.data?.role) setRole(me.data.role);
      if (providerRes.data?.provider) setProvider(providerRes.data.provider);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && role && role !== 'master') {
      const path = window.location.pathname;
      if (path === WEB_ROUTES.dashboard.settings.whatsapp) {
        router.replace(
          provider === 'generic'
            ? WEB_ROUTES.dashboard.settings.whatsappGeneric
            : WEB_ROUTES.dashboard.settings.whatsappOfficial
        );
      }
    }
  }, [loading, role, router, provider]);

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar…</p>;
  }

  if (role === 'master') {
    return <SettingsWhatsappMasterPanel />;
  }

  return (
    <div className="space-y-4">
      <WhatsappProviderSelector
        provider={provider}
        onChange={(next) => {
          setProvider(next);
          window.dispatchEvent(
            new CustomEvent(WHATSAPP_PROVIDER_CHANGED_EVENT, { detail: next })
          );
        }}
      />
      <WhatsappSettingsTabs activeProvider={provider} />
      {children}
    </div>
  );
}
