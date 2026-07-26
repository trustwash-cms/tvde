'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES, isDriverRole, type Role } from '@tvde/shared';
import { PagamentosPanel } from '@/components/pagamentos/pagamentos-panel';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

export default function PagamentosPage() {
  const router = useRouter();

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data && isDriverRole(res.data.role)) {
        router.replace(WEB_ROUTES.dashboard.meusPagamentos.root);
      }
    });
  }, [router]);

  return <PagamentosPanel />;
}
