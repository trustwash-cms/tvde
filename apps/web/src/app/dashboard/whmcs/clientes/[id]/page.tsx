'use client';

import { useParams } from 'next/navigation';
import { WhmcsClientDetailPanel } from '@/components/whmcs/whmcs-client-detail-panel';

export default function WhmcsClienteDetailPage() {
  const params = useParams();
  const id = Number(params?.id);
  if (!Number.isFinite(id) || id < 1) {
    return <p className="text-sm text-slate-500">Cliente inválido</p>;
  }
  return <WhmcsClientDetailPanel clientId={id} />;
}
