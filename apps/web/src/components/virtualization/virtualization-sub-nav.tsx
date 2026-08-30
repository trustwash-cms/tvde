'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { WEB_ROUTES, type VirtualizationAlertSummary } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';

const ROOT_HREF = WEB_ROUTES.dashboard.virtualization.root;

const ITEMS = [
  { href: ROOT_HREF, label: 'Dashboard' },
  { href: WEB_ROUTES.dashboard.virtualization.pve, label: 'PVE' },
  { href: WEB_ROUTES.dashboard.virtualization.pbs, label: 'PBS' },
  { href: WEB_ROUTES.dashboard.virtualization.alertas, label: 'Alertas' },
  { href: WEB_ROUTES.dashboard.virtualization.configuracao, label: 'Configuração' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === ROOT_HREF) return pathname === ROOT_HREF;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function VirtualizationSubNav() {
  const pathname = usePathname();
  const { workspaceId } = useWorkspaceContext();
  const [summary, setSummary] = useState<VirtualizationAlertSummary | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    const load = () => {
      void apiFetch<VirtualizationAlertSummary>(
        withWorkspaceQuery(API_PATHS.virtualization.alertsSummary, workspaceId),
        {},
        getStoredToken()
      ).then((res) => {
        if (res.data) setSummary(res.data);
      });
    };
    load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [workspaceId]);

  return (
    <nav className="flex flex-col gap-0.5 border-r border-slate-200 pr-6">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={clsx(
            'flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition',
            isActive(pathname, item.href)
              ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
              : 'text-slate-600 hover:bg-slate-50'
          )}
        >
          <span>{item.label}</span>
          {item.href === WEB_ROUTES.dashboard.virtualization.alertas && summary && summary.openCount > 0 ? (
            <span
              className={clsx(
                'min-w-[1.25rem] rounded-full px-1.5 text-center text-[10px] font-semibold',
                summary.critical > 0 || summary.security > 0
                  ? 'bg-red-100 text-red-800'
                  : summary.high > 0
                    ? 'bg-orange-100 text-orange-900'
                    : 'bg-amber-100 text-amber-900'
              )}
            >
              {summary.openCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
