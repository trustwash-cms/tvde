'use client';

import { Suspense } from 'react';
import { BillingDocumentsPanel } from '@/components/billing/billing-documents-panel';

export default function BillingDocumentosPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">A carregar documentos…</p>}>
      <BillingDocumentsPanel />
    </Suspense>
  );
}
