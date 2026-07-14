'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES, canAccessClientsDashboard, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { ModuleAccessGuard } from '@/components/module-access-guard';

export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      const role = res.data?.role;
      if (role && !canAccessClientsDashboard(role)) {
        router.replace(role === 'master' ? WEB_ROUTES.dashboard.tenants : WEB_ROUTES.dashboard.users);
        return;
      }
      setReady(true);
    });
  }, [router]);

  if (!ready) {
    return <p className="text-sm text-slate-500">A carregar…</p>;
  }

  return <ModuleAccessGuard moduleKey="clients">{children}</ModuleAccessGuard>;
}
