'use client';

import { DocumentosPanel } from '@/components/documentos/documentos-panel';

export default function DocumentosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Documentos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Consulte e descarregue os documentos associados à sua conta.
        </p>
      </div>
      <DocumentosPanel />
    </div>
  );
}
