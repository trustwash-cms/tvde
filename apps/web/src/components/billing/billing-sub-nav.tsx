'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { WEB_ROUTES } from '@tvde/shared';

const ROOT_HREF = WEB_ROUTES.dashboard.billing.root;

const ENTIDADES = [
  { href: WEB_ROUTES.dashboard.billing.entidades, label: 'Clientes e Fornecedores' },
];

const VENDA = [
  { href: WEB_ROUTES.dashboard.billing.documentos, label: 'Documentos' },
  { href: WEB_ROUTES.dashboard.billing.faturas, label: 'Faturas' },
  { href: WEB_ROUTES.dashboard.billing.faturasSimplificadas, label: 'Faturas Simplificadas' },
  { href: WEB_ROUTES.dashboard.billing.faturasRecibo, label: 'Faturas-Recibo' },
  { href: WEB_ROUTES.dashboard.billing.notasDebito, label: 'Notas de Débito' },
];

const PRODUTOS = [
  { href: WEB_ROUTES.dashboard.billing.produtosCategorias, label: 'Categorias de artigos' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === ROOT_HREF) return pathname === ROOT_HREF;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();

  return (
    <Link
      href={href}
      className={clsx(
        'block rounded-lg px-3 py-2.5 text-sm font-medium transition',
        isActive(pathname, href)
          ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
          : 'text-slate-600 hover:bg-slate-50'
      )}
    >
      {label}
    </Link>
  );
}

export function BillingSubNav() {
  return (
    <nav className="flex flex-col gap-0.5 border-r border-slate-200 pr-6">
      <NavLink href={ROOT_HREF} label="Dashboard" />

      <p className="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Entidades
      </p>
      {ENTIDADES.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}

      <p className="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Venda
      </p>
      {VENDA.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}

      <p className="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Produtos
      </p>
      {PRODUTOS.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}
    </nav>
  );
}
