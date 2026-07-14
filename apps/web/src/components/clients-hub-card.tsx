'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { WEB_ROUTES } from '@tvde/shared';

export function ClientsHubCard({
  title,
  description,
  icon: Icon,
  children,
  footer,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="card flex h-full flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-[var(--color-primary-light)] p-2.5 text-[var(--color-primary)]">
          <Icon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
      {children && <div className="min-w-0 flex-1">{children}</div>}
      {footer && <div className="border-t border-slate-100 pt-3">{footer}</div>}
    </section>
  );
}

export function BillingHubLinks() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={WEB_ROUTES.dashboard.billing.entidades} className="btn-primary text-sm">
        Clientes e fornecedores
      </Link>
      <Link href={WEB_ROUTES.dashboard.billing.faturas} className="btn-secondary text-sm">
        Criar fatura
      </Link>
    </div>
  );
}
