'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { WEB_ROUTES } from '@tvde/shared';

const ROOT_HREF = WEB_ROUTES.dashboard.adminMgmt.root;

const ITEMS = [
  { href: ROOT_HREF, label: 'Dashboard' },
  { href: WEB_ROUTES.dashboard.adminMgmt.seguros, label: 'Seguros' },
  { href: WEB_ROUTES.dashboard.adminMgmt.contratos, label: 'Contratos' },
  { href: WEB_ROUTES.dashboard.adminMgmt.segurancaSocial, label: 'Segurança Social' },
  { href: WEB_ROUTES.dashboard.adminMgmt.recibosVerdes, label: 'Recibos Verdes' },
  { href: WEB_ROUTES.dashboard.adminMgmt.faturas, label: 'Faturas' },
  { href: WEB_ROUTES.dashboard.adminMgmt.prestacoes, label: 'Prestações' },
  { href: WEB_ROUTES.dashboard.adminMgmt.clientes, label: 'Clientes' },
  { href: WEB_ROUTES.dashboard.adminMgmt.configuracoes, label: 'Configurações' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === ROOT_HREF) return pathname === ROOT_HREF;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminMgmtSubNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 border-r border-slate-200 pr-6">
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
