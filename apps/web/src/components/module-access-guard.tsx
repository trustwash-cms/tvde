'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { getModuleLabel, hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';
import { ModuleInactiveMessage } from '@/components/module-inactive-message';

export function ModuleAccessGuard({
  moduleKey,
  children,
}: {
  moduleKey: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [inactive, setInactive] = useState(false);

  useEffect(() => {
    apiFetch<{ role: Role; capabilities?: ModuleCapabilities }>(API_PATHS.auth.me, {}, getStoredToken()).then(
      (res) => {
        if (!res.success || !res.data) {
          router.replace(WEB_ROUTES.login);
          return;
        }
        if (!hasActiveModule(res.data.role, res.data.capabilities, moduleKey)) {
          setInactive(true);
          return;
        }
        setReady(true);
      }
    );
  }, [moduleKey, router]);

  if (inactive) {
    return <ModuleInactiveMessage moduleLabel={getModuleLabel(moduleKey)} />;
  }

  if (!ready) {
    return <p className="text-sm text-slate-500">A carregar…</p>;
  }

  return <>{children}</>;
}
