'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { WhmcsLiveInvoiceDetailPanel } from '@/components/whmcs/whmcs-live-invoice-detail-panel';

export default function WhmcsFaturaWhmcsDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const id = Number(params?.id);
  if (!Number.isFinite(id) || id < 1) {
    return <p className="text-sm text-slate-500">Fatura inválida</p>;
  }
  return (
    <WhmcsLiveInvoiceDetailPanel invoiceId={id} initialEdit={search?.get('edit') === '1'} />
  );
}
