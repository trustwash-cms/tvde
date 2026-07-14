'use client';

import { useEffect, useRef } from 'react';

export const BOOKINGS_EMBED_HEIGHT_MESSAGE = 'cms-bookings-embed-height';

/** Envia altura do conteúdo ao parent quando a página corre dentro de um iframe (embed público). */
export function useEmbedAutoHeight<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;

    function postHeight() {
      const target = ref.current;
      if (!target) return;
      const height = Math.ceil(target.scrollHeight);
      window.parent.postMessage({ type: BOOKINGS_EMBED_HEIGHT_MESSAGE, height }, '*');
    }

    postHeight();

    const target = ref.current;
    if (!target) return;

    const observer = new ResizeObserver(postHeight);
    observer.observe(target);

    window.addEventListener('resize', postHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', postHeight);
    };
  }, []);

  return ref;
}
