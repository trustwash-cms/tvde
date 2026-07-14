'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Building2,
  Layers,
  UserCircle,
  LogOut,
  Mail,
  Receipt,
  CalendarDays,
  Menu,
  X,
  Briefcase,
} from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { WEB_ROUTES, canAccessDashboardArea, canAccessClientsDashboard, type Role, ADMIN_MGMT_MODULE_NAME, getRoleLabel } from '@tvde/shared';
import { apiFetch, clearTokens, getStoredToken, getStoredRefreshToken, API_PATHS, appName, getApiUrl } from '@/lib/api';
import { useSessionKeepAlive } from '@/hooks/use-session-keep-alive';
import { hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';

const navItems = [
  { href: WEB_ROUTES.dashboard.root, label: 'Dashboard', icon: LayoutDashboard, area: 'dashboard' as const },
  { href: WEB_ROUTES.dashboard.tenants, label: 'Tenants', icon: Building2, area: 'tenants' as const },
  { href: WEB_ROUTES.dashboard.workspaces, label: 'Workspaces', icon: Layers, area: 'workspaces' as const },
  { href: WEB_ROUTES.dashboard.clients, label: 'Clientes', icon: UserCircle, area: 'clients' as const, moduleKey: 'clients' },
  { href: WEB_ROUTES.dashboard.billing.root, label: 'Facturação', icon: Receipt, area: 'billing' as const, moduleKey: 'billing' },
  { href: WEB_ROUTES.dashboard.calendar, label: 'Calendário', icon: CalendarDays, area: 'calendar' as const, moduleKey: 'calendar' },
  { href: WEB_ROUTES.dashboard.adminMgmt.root, label: ADMIN_MGMT_MODULE_NAME, icon: Briefcase, area: 'admin_mgmt' as const, moduleKey: 'admin_mgmt' },
  { href: WEB_ROUTES.dashboard.users, label: 'Utilizadores', icon: Users, area: 'users' as const },
  { href: WEB_ROUTES.dashboard.settings.root, label: 'Configurações', icon: Mail, area: 'settings' as const },
];

interface User {
  email: string;
  role: Role;
  mustChangePassword?: boolean;
  tenant?: { siteId: string; name: string } | null;
  capabilities?: ModuleCapabilities;
}

interface TenantBrandingInfo {
  companyName: string;
  logo: { hasLogo: boolean; updatedAt?: string };
}

function userInitials(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function isNavActive(pathname: string, href: string, area: string) {
  if (pathname === href) return true;
  if (area === 'settings' && pathname.startsWith('/dashboard/settings')) return true;
  if (area === 'billing' && pathname.startsWith('/dashboard/billing')) return true;
  if (area === 'calendar' && pathname.startsWith('/dashboard/calendar')) return true;
  if (area === 'admin_mgmt' && pathname.startsWith('/dashboard/admin-mgmt')) return true;
  return false;
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [branding, setBranding] = useState<TenantBrandingInfo | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useSessionKeepAlive(Boolean(getStoredToken()));

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      router.replace(WEB_ROUTES.login);
      return;
    }

    apiFetch<User>(API_PATHS.auth.me, {}, token).then((res) => {
      if (res.success && res.data) {
        const me = res.data as User;
        setUser(me);
        if (me.mustChangePassword && pathname !== WEB_ROUTES.changePassword) {
          router.replace(WEB_ROUTES.changePassword);
        }
      } else if (res.statusCode === 401 || !getStoredRefreshToken()) {
        clearTokens();
        router.replace(WEB_ROUTES.login);
      }
    });
  }, [router, pathname]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!user?.tenant) {
      setBranding(null);
      setLogoUrl(null);
      return;
    }

    const token = getStoredToken();
    apiFetch<TenantBrandingInfo>(API_PATHS.tenantBranding.info, {}, token).then((res) => {
      if (res.data) setBranding(res.data);
    });
  }, [user?.tenant?.siteId]);

  useEffect(() => {
    if (!branding?.logo.hasLogo) {
      setLogoUrl(null);
      return;
    }

    const token = getStoredToken();
    const logoVersion = branding.logo.updatedAt ?? String(Date.now());
    const url = `${getApiUrl()}${API_PATHS.tenantBranding.logo(logoVersion)}`;
    let objectUrl: string | null = null;

    fetch(url, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setLogoUrl(objectUrl);
        }
      })
      .catch(() => setLogoUrl(null));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [branding?.logo.hasLogo, branding?.logo.updatedAt]);

  function logout() {
    const token = getStoredToken();
    if (token) apiFetch(API_PATHS.auth.logout, { method: 'POST' }, token);
    clearTokens();
    router.replace(WEB_ROUTES.login);
  }

  const visibleNav = navItems.filter((item) => {
    if (!user) return false;
    if (item.area === 'workspaces' && user.role !== 'master') return false;
    if (item.area === 'clients' && !canAccessClientsDashboard(user.role)) return false;
    if (!canAccessDashboardArea(user.role, item.area)) return false;
    if (item.moduleKey && !hasActiveModule(user.role, user.capabilities, item.moduleKey)) return false;
    return true;
  });

  const companyLabel = branding?.companyName ?? user?.tenant?.name ?? appName;

  if (user?.mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ width: 'var(--sidebar-width)' }}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={companyLabel}
                  className="h-10 w-auto max-w-[180px] object-contain object-left"
                />
              ) : (
                <div className="text-lg font-bold leading-tight text-[var(--color-primary)]">{appName}</div>
              )}
              {user?.tenant && (
                <div className="mt-1 truncate text-xs text-slate-500">{companyLabel}</div>
              )}
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
              aria-label="Fechar menu"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {visibleNav.map(({ href, label, icon: Icon, area }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                isNavActive(pathname, href, area)
                  ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                  : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4">
          {user && (
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-sm font-semibold text-[var(--color-primary)]"
                title={user.email}
              >
                {userInitials(user.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-500">{user.email}</div>
                <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                  {getRoleLabel(user.role)}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:ml-[var(--sidebar-width)]">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Abrir menu"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="min-w-0 flex-1">
            {logoUrl ? (
              <img src={logoUrl} alt={companyLabel} className="h-8 w-auto max-w-[140px] object-contain object-left" />
            ) : (
              <span className="truncate text-sm font-semibold text-[var(--color-primary)]">{companyLabel}</span>
            )}
          </div>
        </header>

        <main className="flex-1">
          <div className="p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
