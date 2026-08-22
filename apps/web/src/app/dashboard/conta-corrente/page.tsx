'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ContaCorrentePanel } from '@/components/conta-corrente/conta-corrente-panel';

function ContaCorrentePageInner() {
  const searchParams = useSearchParams();
  const driverId = searchParams.get('driverId') ?? undefined;
  return <ContaCorrentePanel initialDriverId={driverId} />;
}

export default function ContaCorrentePage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">A carregar…</div>}>
      <ContaCorrentePageInner />
    </Suspense>
  );
}
