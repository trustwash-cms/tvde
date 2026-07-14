'use client';

import { useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useActiveModule } from '@/hooks/use-active-module';

interface StripeStatus {
  configured: boolean;
  moduleAuthorized?: boolean;
  moduleActive?: boolean;
  statusMessage?: string;
}

/** Módulo Stripe activo no workspace + chaves configuradas (por workspace). */
export function useStripeReady(workspaceId: string | null) {
  const moduleActive = useActiveModule('stripe');
  const [configured, setConfigured] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!workspaceId || moduleActive !== true) {
      setConfigured(false);
      setStatusMessage(null);
      setChecking(false);
      return;
    }

    setChecking(true);
    apiFetch<StripeStatus>(
      withWorkspaceQuery(API_PATHS.stripe.status, workspaceId, { probe: '0' }),
      {},
      getStoredToken()
    ).then((res) => {
      setChecking(false);
      if (res.data) {
        setConfigured(Boolean(res.data.configured));
        setStatusMessage(res.data.statusMessage ?? null);
      } else {
        setConfigured(false);
        setStatusMessage(res.error ?? null);
      }
    });
  }, [workspaceId, moduleActive]);

  const loading = moduleActive === null || checking;
  const ready = moduleActive === true && configured;

  return {
    loading,
    moduleActive: moduleActive === true,
    configured,
    ready,
    statusMessage,
  };
}
