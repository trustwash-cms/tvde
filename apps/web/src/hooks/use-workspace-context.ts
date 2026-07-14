'use client';

import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
  tenant?: { id: string; name: string; siteId: string };
}

export function useWorkspaceContext() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setWorkspaceId = useCallback((id: string) => {
    setWorkspaceIdState(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.activeWorkspaceId, id);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    Promise.all([
      apiFetch<WorkspaceOption[]>(API_PATHS.workspaces.list, {}, token),
      apiFetch<{ workspace?: { id: string } | null }>(API_PATHS.auth.me, {}, token),
    ]).then(([wsRes, meRes]) => {
      const list = wsRes.data ?? [];
      setWorkspaces(list);

      const stored =
        typeof window !== 'undefined'
          ? localStorage.getItem(STORAGE_KEYS.activeWorkspaceId)
          : null;
      const jwtWs = meRes.data?.workspace?.id ?? null;
      const pick =
        (stored && list.some((w) => w.id === stored) ? stored : null) ??
        (jwtWs && list.some((w) => w.id === jwtWs) ? jwtWs : null) ??
        list[0]?.id ??
        null;

      if (pick) setWorkspaceIdState(pick);
      setLoading(false);
    });
  }, [setWorkspaceId]);

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  return {
    workspaces,
    workspaceId,
    activeWorkspace,
    setWorkspaceId,
    loading,
    needsSelection: !loading && workspaces.length > 1 && !workspaceId,
  };
}
