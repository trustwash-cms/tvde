import type { Role } from './roles';
import { hasMinRole } from './roles';

/**
 * Cadeia de delegação TVDE:
 *
 * MASTER     → dono da plataforma; vê e acede a tudo
 * superadmin → Gestor de Frota; gere frota, motoristas e staff
 * admin      → Motorista; acede ao que o gestor de frota autorizar
 * staff      → Staff; acede ao que o motorista/gestor autorizar
 */

export const ROLE_MANAGER: Record<Exclude<Role, 'master'>, Role> = {
  superadmin: 'master',
  admin: 'superadmin',
  staff: 'admin',
};

export function canAssignRole(actor: Role, targetRole: Role): boolean {
  if (targetRole === 'master') return false;
  if (actor === 'master') return true;
  if (actor === 'superadmin') return targetRole === 'admin' || targetRole === 'staff';
  if (actor === 'admin') return targetRole === 'staff';
  return false;
}

export function getAssignableRoles(actor: Role): Role[] {
  const all: Role[] = ['superadmin', 'admin', 'staff'];
  return all.filter((r) => canAssignRole(actor, r));
}

export function canManageUser(actor: Role, targetRole: Role): boolean {
  if (actor === 'master') return targetRole !== 'master';
  if (actor === 'superadmin') return targetRole === 'admin' || targetRole === 'staff';
  if (actor === 'admin') return targetRole === 'staff';
  return false;
}

export const DASHBOARD_ACCESS: Record<string, Role> = {
  dashboard: 'staff',
  tenants: 'master',
  workspaces: 'superadmin',
  clients: 'staff',
  billing: 'staff',
  bolt: 'staff',
  calendar: 'staff',
  admin_mgmt: 'staff',
  users: 'admin',
  modules: 'superadmin',
  audit: 'admin',
  settings: 'staff',
};

export function canAccessDashboardArea(actor: Role, area: keyof typeof DASHBOARD_ACCESS): boolean {
  return hasMinRole(actor, DASHBOARD_ACCESS[area]);
}

/** Clientes: motoristas e staff. MASTER → Tenants; Gestor de Frota → Utilizadores. */
export function canAccessClientsDashboard(actor: Role): boolean {
  if (actor === 'master' || actor === 'superadmin') return false;
  return hasMinRole(actor, DASHBOARD_ACCESS.clients);
}

