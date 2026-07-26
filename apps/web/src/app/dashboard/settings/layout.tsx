'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES, canAccessDashboardArea, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import type { ModuleCapabilities } from '@/lib/module-access';
import { SettingsSubNav } from '@/components/settings/settings-sub-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [capabilities, setCapabilities] = useState<ModuleCapabilities | undefined>();

  useEffect(() => {
    apiFetch<{ role: Role; capabilities?: ModuleCapabilities }>(API_PATHS.auth.me, {}, getStoredToken()).then(
      (res) => {
        if (!res.data?.role) return;
        if (!canAccessDashboardArea(res.data.role, 'settings')) {
          router.replace(WEB_ROUTES.dashboard.root);
          return;
        }
        setRole(res.data.role);
        if (res.data.capabilities) setCapabilities(res.data.capabilities);
      }
    );
  }, [router]);

  if (!role) {
    return <p className="text-sm text-slate-500">A carregar…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-slate-500">Segurança, integrações e comunicações da plataforma.</p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:w-64">
          <SettingsSubNav role={role} capabilities={capabilities} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
