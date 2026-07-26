'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { WEB_ROUTES, hasMinRole, type Role } from '@tvde/shared';
import { hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  minRole: Role;
  moduleKey?: string;
}> = [
  { href: WEB_ROUTES.dashboard.settings.geral, label: 'Geral', minRole: 'superadmin' },
  { href: WEB_ROUTES.dashboard.settings.workspaces, label: 'Workspaces', minRole: 'superadmin' },
  { href: WEB_ROUTES.dashboard.settings.modules, label: 'Módulos', minRole: 'superadmin' },
  { href: WEB_ROUTES.dashboard.settings.sms, label: 'SMS', minRole: 'superadmin', moduleKey: 'sms' },
  { href: WEB_ROUTES.dashboard.settings.moloni, label: 'Moloni', minRole: 'superadmin', moduleKey: 'billing' },
  { href: WEB_ROUTES.dashboard.settings.bolt, label: 'Bolt API', minRole: 'superadmin', moduleKey: 'bolt' },
  { href: WEB_ROUTES.dashboard.settings.tvde.root, label: 'TVDE', minRole: 'superadmin' },
  { href: WEB_ROUTES.dashboard.settings.calendar, label: 'Calendário', minRole: 'superadmin', moduleKey: 'calendar' },
  { href: WEB_ROUTES.dashboard.settings.smtp, label: 'SMTP', minRole: 'superadmin' },
  { href: WEB_ROUTES.dashboard.settings.security, label: 'Segurança', minRole: 'master' },
  { href: WEB_ROUTES.dashboard.settings.audit, label: 'Audit Log', minRole: 'superadmin' },
];

export function SettingsSubNav({
  role,
  capabilities,
}: {
  role: Role | null;
  capabilities?: ModuleCapabilities;
}) {
  const pathname = usePathname();

  const visible = NAV_ITEMS.filter((item) => {
    if (!role || !hasMinRole(role, item.minRole)) return false;
    if (item.href === WEB_ROUTES.dashboard.settings.workspaces && role === 'master') return false;
    if (item.moduleKey && !hasActiveModule(role, capabilities, item.moduleKey)) return false;
    return true;
  });

  return (
    <nav className="flex flex-col gap-0.5 border-r border-slate-200 pr-6">
      {visible.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={clsx(
            'rounded-md px-3 py-2 text-sm transition',
            pathname === item.href || pathname.startsWith(`${item.href}/`)
              ? 'bg-[var(--color-primary-light)] font-medium text-[var(--color-primary)]'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}