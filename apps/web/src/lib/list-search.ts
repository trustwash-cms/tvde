'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function withSearchQuery(path: string, q: string | null | undefined): string {
  const trimmed = q?.trim();
  if (!trimmed) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}q=${encodeURIComponent(trimmed)}`;
}

export function useListSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const q = searchParams.get('q')?.trim() ?? '';
  const [input, setInput] = useState(q);

  useEffect(() => {
    setInput(q);
  }, [q]);

  const applySearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = value.trim();
      if (trimmed.length >= 2) params.set('q', trimmed);
      else params.delete('q');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return { q, input, setInput, applySearch };
}
