'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  WEB_ROUTES,
  canAccessClientsDashboard,
  canAccessDashboardArea,
  isDriverRole,
  type Role,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';
import { Building2, Layers, Users } from 'lucide-react';
import DashboardGlobalSearch from '@/components/dashboard-global-search';
import {
  DashboardModuleCards,
  type DashboardStatCard,
} from '@/components/dashboard-module-cards';
import { DashboardUpcomingPanel } from '@/components/dashboard-upcoming-panel';
import { DriverDashboard } from '@/components/driver-dashboard';

interface MeUser {
  role: Role;
  email: string;
  fullName?: string | null;
  username?: string | null;
  capabilities?: ModuleCapabilities;
  tenant?: { siteId: string; name: string } | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState({
    workspaces: 0,
    users: 0,
    clients: 0,
  });
  const [me, setMe] = useState<MeUser | null>(null);

  const showClients =
    me != null &&
    canAccessClientsDashboard(me.role) &&
    hasActiveModule(me.role, me.capabilities, 'clients');
  const showWorkspaces = me != null && canAccessDashboardArea(me.role, 'workspaces');
  const showUsers = me != null && canAccessDashboardArea(me.role, 'users');
  const calendarActive =
    me != null && hasActiveModule(me.role, me.capabilities, 'calendar');
  const adminMgmtActive =
    me != null &&
    canAccessDashboardArea(me.role, 'admin_mgmt') &&
    hasActiveModule(me.role, me.capabilities, 'admin_mgmt');

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    apiFetch<MeUser>(API_PATHS.auth.me, {}, token).then((meRes) => {
      if (meRes.data?.role) setMe(meRes.data);
    });
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token || me == null || isDriverRole(me.role)) return;

    const fetches: Promise<{ data?: unknown[] }>[] = [];
    if (showWorkspaces) fetches.push(apiFetch<unknown[]>(API_PATHS.workspaces.list, {}, token));
    if (showUsers) fetches.push(apiFetch<unknown[]>(API_PATHS.users.list, {}, token));
    if (showClients) fetches.push(apiFetch<unknown[]>(API_PATHS.clients.list, {}, token));

    if (fetches.length === 0) return;

    Promise.all(fetches).then((responses) => {
      let i = 0;
      const ws = showWorkspaces ? responses[i++] : undefined;
      const us = showUsers ? responses[i++] : undefined;
      const cl = showClients ? responses[i++] : undefined;

      setStats({
        workspaces: ws?.data?.length ?? 0,
        users: us?.data?.length ?? 0,
        clients: cl?.data?.length ?? 0,
      });
    });
  }, [me, showClients, showUsers, showWorkspaces]);

  const statCards = useMemo((): DashboardStatCard[] => {
    const items: DashboardStatCard[] = [];
    if (showWorkspaces) {
      items.push({
        id: 'workspaces',
        label: 'Workspaces',
        value: stats.workspaces,
        href: WEB_ROUTES.dashboard.workspaces,
        icon: Layers,
        iconClass: 'text-[var(--color-teal)]',
        iconBgClass: 'bg-teal-50',
      });
    }
    if (showUsers) {
      items.push({
        id: 'users',
        label: 'Utilizadores',
        value: stats.users,
        href: WEB_ROUTES.dashboard.users,
        icon: Users,
        iconClass: 'text-[var(--color-blue)]',
        iconBgClass: 'bg-sky-50',
      });
    }
    if (showClients) {
      items.push({
        id: 'clients',
        label: 'Clientes',
        value: stats.clients,
        href: WEB_ROUTES.dashboard.clients,
        icon: Building2,
        iconClass: 'text-[var(--color-primary)]',
        iconBgClass: 'bg-[var(--color-primary-light)]',
      });
    }
    return items;
  }, [showClients, showUsers, showWorkspaces, stats]);

  const showUpcoming = calendarActive || adminMgmtActive;

  if (me && isDriverRole(me.role)) {
    return <DriverDashboard role={me.role} capabilities={me.capabilities} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-slate-500">
          {me?.tenant?.name ? (
            <>
              <span className="font-medium text-slate-700">{me.tenant.name}</span>
              {me.tenant.siteId ? (
                <span className="text-slate-400"> · {me.tenant.siteId}</span>
              ) : null}
            </>
          ) : (
            'Visão geral dos módulos activos no seu workspace'
          )}
        </p>
      </div>

      <DashboardGlobalSearch showClients={showClients} />

      {me && <DashboardModuleCards role={me.role} capabilities={me.capabilities} statCards={statCards} />}

      {showUpcoming && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Próximos eventos
          </h2>
          <DashboardUpcomingPanel
            calendarActive={calendarActive}
            adminMgmtActive={adminMgmtActive}
          />
        </section>
      )}
    </div>
  );
}
