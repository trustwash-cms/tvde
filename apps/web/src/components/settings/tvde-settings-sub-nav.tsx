'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { WEB_ROUTES } from '@tvde/shared';

const ROOT = WEB_ROUTES.dashboard.settings.tvde.root;

const ITEMS = [
  { href: WEB_ROUTES.dashboard.settings.tvde.sessions, label: 'Sessions' },
  { href: WEB_ROUTES.dashboard.settings.tvde.storage, label: 'Storage' },
  { href: WEB_ROUTES.dashboard.settings.tvde.limiteViaturas, label: 'Limite de viaturas' },
  { href: WEB_ROUTES.dashboard.settings.tvde.contratos, label: 'Contratos' },
  { href: WEB_ROUTES.dashboard.settings.tvde.metodosPagamento, label: 'Métodos de pagamento' },
  { href: WEB_ROUTES.dashboard.settings.tvde.contaCorrente, label: 'Conta corrente' },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TvdeSettingsSubNav() {
  const pathname = usePathname();

  return (
    <nav className="flex w-full shrink-0 flex-col gap-0.5 border-r border-slate-200 pr-6 lg:w-56">
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">TVDE</p>
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={clsx(
            'rounded-lg px-3 py-2.5 text-sm font-medium transition',
            isActive(pathname, item.href)
              ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
              : 'text-slate-600 hover:bg-slate-50'
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
