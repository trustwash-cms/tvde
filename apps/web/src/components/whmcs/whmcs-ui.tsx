'use client';

import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';

export function WhmcsConnectionBanner({
  error,
  hint,
}: {
  error?: string;
  hint?: string;
}) {
  if (!error && !hint) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">{hint || error}</p>
      {hint && error && hint !== error ? (
        <p className="mt-1 text-amber-800/90">{error}</p>
      ) : null}
      <p className="mt-2">
        <Link href={WEB_ROUTES.dashboard.settings.whmcs} className="underline">
          Configurações → WHMCS
        </Link>
        {' · '}
        confirme API Role (`GetClients`, `GetInvoices`, `GetClientsProducts`, `GetClientsDomains`,{' '}
        `GetProducts`) e IP whitelist.
      </p>
    </div>
  );
}

export function OpenInWhmcsLink({ href, label = 'Abrir no WHMCS' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {label}
    </a>
  );
}

export function WhmcsPagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (nextOffset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) {
    return (
      <p className="text-xs text-slate-500">
        {total} registo{total === 1 ? '' : 's'}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-500">
        {total} registos · página {page}/{pages}
      </span>
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={offset <= 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Anterior
      </button>
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Seguinte
      </button>
    </div>
  );
}
