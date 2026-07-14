'use client';

import Link from 'next/link';
import { WEB_ROUTES } from '@tvde/shared';

export function BillingBreadcrumb({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav className="mb-4 text-sm text-slate-500" aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link href={WEB_ROUTES.dashboard.billing.produtosCategorias} className="hover:text-[var(--color-primary)]">
            Painel Principal
          </Link>
        </li>
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            <span aria-hidden>·</span>
            {item.href ? (
              <Link href={item.href} className="hover:text-[var(--color-primary)]">
                {item.label}
              </Link>
            ) : (
              <span className="text-slate-700">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
