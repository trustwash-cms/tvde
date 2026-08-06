'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { WEB_ROUTES } from '@tvde/shared';

const CONSULTA = [
  { href: WEB_ROUTES.dashboard.whmcs.clientes, label: 'Clientes' },
  { href: WEB_ROUTES.dashboard.whmcs.faturasWhmcs, label: 'Faturas' },
  { href: WEB_ROUTES.dashboard.whmcs.servicos, label: 'Serviços' },
  { href: WEB_ROUTES.dashboard.whmcs.dominios, label: 'Domínios' },
  { href: WEB_ROUTES.dashboard.whmcs.produtos, label: 'Produtos' },
];

const MOLONI = [
  { href: WEB_ROUTES.dashboard.whmcs.faturas, label: 'Mapa Moloni' },
];

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active =
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === WEB_ROUTES.dashboard.whmcs.clientes &&
      pathname.startsWith(`${WEB_ROUTES.dashboard.whmcs.clientes}/`));

  return (
    <Link
      href={href}
      className={clsx(
        'block rounded-lg px-3 py-2.5 text-sm font-medium transition',
        active
          ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
          : 'text-slate-600 hover:bg-slate-50'
      )}
    >
      {label}
    </Link>
  );
}

export function WhmcsSubNav() {
  return (
    <nav className="flex flex-col gap-0.5 border-r border-slate-200 pr-6">
      <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Consulta
      </p>
      {CONSULTA.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}

      <p className="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Moloni
      </p>
      {MOLONI.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}
    </nav>
  );
}
