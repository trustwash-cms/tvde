'use client';

import { useState } from 'react';
import clsx from 'clsx';
import {
  WHATSAPP_PROVIDER_LABELS,
  type WhatsappProvider,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';

export function WhatsappProviderSelector({
  provider,
  onChange,
}: {
  provider: WhatsappProvider;
  onChange: (next: WhatsappProvider) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function select(next: WhatsappProvider) {
    if (next === provider || loading) return;
    setError('');
    setLoading(true);
    const res = await apiFetch<{ provider: WhatsappProvider }>(
      API_PATHS.whatsappBusiness.provider,
      { method: 'PATCH', body: JSON.stringify({ provider: next }) },
      getStoredToken()
    );
    setLoading(false);
    if (res.success && res.data?.provider) {
      onChange(res.data.provider);
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">API WhatsApp activa</p>
          <p className="text-xs text-slate-500">
            Só uma API pode estar activa de cada vez — Oficial (Meta) ou Genérica (bridge/QR).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['official', 'generic'] as const).map((item) => {
            const active = provider === item;
            return (
              <button
                key={item}
                type="button"
                disabled={loading}
                onClick={() => void select(item)}
                className={clsx(
                  'rounded-lg px-4 py-2 text-sm font-medium transition',
                  active
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
                )}
              >
                {WHATSAPP_PROVIDER_LABELS[item]}
                {active ? ' ✓' : ''}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
