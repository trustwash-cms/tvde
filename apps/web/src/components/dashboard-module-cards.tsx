'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  CalendarDays,
  ChevronRight,
  Receipt,
  UserCircle,
} from 'lucide-react';
import {
  ADMIN_MGMT_MODULE_NAME,
  DASHBOARD_ACCESS,
  WEB_ROUTES,
  canAccessClientsDashboard,
  canAccessDashboardArea,
  type Role,
} from '@tvde/shared';
import { hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';

export interface DashboardStatCard {
  id: string;
  label: string;
  value: number;
  href: string;
  icon: LucideIcon;
  iconClass: string;
  iconBgClass: string;
}

interface ModuleCardConfig {
  moduleKey: string;
  area: keyof typeof DASHBOARD_ACCESS;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  iconClass: string;
  iconBgClass: string;
  canShow: (role: Role) => boolean;
}

const MODULE_CARDS: ModuleCardConfig[] = [
  {
    moduleKey: 'billing',
    area: 'billing',
    href: WEB_ROUTES.dashboard.billing.root,
    label: 'Facturação',
    description: 'Faturas Moloni, entidades fiscais e documentos de venda.',
    icon: Receipt,
    iconClass: 'text-[var(--color-primary)]',
    iconBgClass: 'bg-[var(--color-primary-light)]',
    canShow: (role) => canAccessDashboardArea(role, 'billing'),
  },
  {
    moduleKey: 'calendar',
    area: 'calendar',
    href: WEB_ROUTES.dashboard.calendar,
    label: 'Calendário',
    description: 'Agenda partilhada, eventos e lembretes.',
    icon: CalendarDays,
    iconClass: 'text-sky-600',
    iconBgClass: 'bg-sky-50',
    canShow: (role) => canAccessDashboardArea(role, 'calendar'),
  },
  {
    moduleKey: 'admin_mgmt',
    area: 'admin_mgmt',
    href: WEB_ROUTES.dashboard.adminMgmt.root,
    label: ADMIN_MGMT_MODULE_NAME,
    description: 'Seguros, contratos, faturas internas e vencimentos.',
    icon: Briefcase,
    iconClass: 'text-amber-700',
    iconBgClass: 'bg-amber-50',
    canShow: (role) => canAccessDashboardArea(role, 'admin_mgmt'),
  },
  {
    moduleKey: 'clients',
    area: 'clients',
    href: WEB_ROUTES.dashboard.clients,
    label: 'Clientes',
    description: 'Contactos e equipas da frota.',
    icon: UserCircle,
    iconClass: 'text-[var(--color-teal)]',
    iconBgClass: 'bg-teal-50',
    canShow: (role) => canAccessClientsDashboard(role),
  },
];

export function DashboardModuleCards({
  role,
  capabilities,
  statCards = [],
}: {
  role: Role;
  capabilities?: ModuleCapabilities;
  statCards?: DashboardStatCard[];
}) {
  const modules = MODULE_CARDS.filter(
    (card) => card.canShow(role) && hasActiveModule(role, capabilities, card.moduleKey)
  );

  if (modules.length === 0 && statCards.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Nenhum módulo activo neste workspace. Peça ao gestor de frota para activar módulos em
        Configurações → Workspaces.
      </p>
    );
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {statCards.map((stat) => {
        const Icon = stat.icon;
        return (
          <Link
            key={stat.id}
            href={stat.href}
            className="card group flex items-center gap-2.5 !p-3 transition hover:border-[var(--color-primary)] hover:shadow-sm"
          >
            <div className={`shrink-0 rounded-lg p-2 ${stat.iconBgClass} ${stat.iconClass}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold leading-tight text-slate-900">{stat.value}</div>
              <div className="text-xs text-slate-500">{stat.label}</div>
            </div>
            <ChevronRight
              size={14}
              className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]"
            />
          </Link>
        );
      })}

      {modules.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.moduleKey}
            href={card.href}
            className="card group flex items-center gap-2.5 !p-3 transition hover:border-[var(--color-primary)] hover:shadow-sm"
          >
            <div className={`shrink-0 rounded-lg p-2 ${card.iconBgClass} ${card.iconClass}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold leading-tight text-slate-900 group-hover:text-[var(--color-primary)]">
                {card.label}
              </h3>
              <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{card.description}</p>
            </div>
            <ChevronRight
              size={14}
              className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]"
            />
          </Link>
        );
      })}
    </div>
  );
}
