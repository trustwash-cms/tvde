'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';
import { getStoredToken } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getStoredToken() ? WEB_ROUTES.dashboard.root : WEB_ROUTES.login);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
    </div>
  );
}
