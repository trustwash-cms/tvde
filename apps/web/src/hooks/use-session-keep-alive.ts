'use client';

import { useEffect } from 'react';
import { getStoredToken, refreshStoredAccessToken } from '@/lib/api';

const CHECK_INTERVAL_MS = 60_000;
const REFRESH_BEFORE_EXPIRY_MS = 10 * 60_000;

function getAccessTokenExpiryMs(token: string): number | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const payload = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function refreshSessionIfNeeded() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

  const token = getStoredToken();
  if (!token) return;

  const expiresAt = getAccessTokenExpiryMs(token);
  if (!expiresAt) {
    await refreshStoredAccessToken();
    return;
  }

  if (expiresAt - Date.now() <= REFRESH_BEFORE_EXPIRY_MS) {
    await refreshStoredAccessToken();
  }
}

/** Mantém a sessão activa enquanto o utilizador usa o CMS (renova o token antes de expirar). */
export function useSessionKeepAlive(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    void refreshSessionIfNeeded();

    const intervalId = window.setInterval(() => {
      void refreshSessionIfNeeded();
    }, CHECK_INTERVAL_MS);

    const onActivity = () => {
      void refreshSessionIfNeeded();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSessionIfNeeded();
    };

    window.addEventListener('focus', onActivity);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
