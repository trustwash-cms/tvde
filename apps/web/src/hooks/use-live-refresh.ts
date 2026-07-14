'use client';

import { useEffect, useRef } from 'react';

/** Actualiza dados em intervalo enquanto o separador está visível (padrão do projecto — ver WhatsApp QR). */
export function useLiveRefresh(callback: () => void, intervalMs = 15000, enabled = true) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs < 1000) return;

    function tick() {
      if (document.visibilityState === 'visible') {
        savedCallback.current();
      }
    }

    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
}
