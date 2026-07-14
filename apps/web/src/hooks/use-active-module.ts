'use client';

import { useEffect, useState } from 'react';
import type { Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';

/** `null` = a carregar; `false` / `true` = módulo inactivo ou activo no workspace. */
export function useActiveModule(moduleKey: string): boolean | null {
  const [active, setActive] = useState<boolean | null>(null);

  useEffect(() => {
    apiFetch<{ role: Role; capabilities?: ModuleCapabilities }>(API_PATHS.auth.me, {}, getStoredToken()).then(
      (res) => {
        if (res.data) {
          setActive(hasActiveModule(res.data.role, res.data.capabilities, moduleKey));
        } else {
          setActive(false);
        }
      }
    );
  }, [moduleKey]);

  return active;
}
