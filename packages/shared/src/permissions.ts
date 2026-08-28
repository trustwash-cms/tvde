import type { Role } from './roles';
import { hasMinRole } from './roles';

/**
 * Cadeia de delegação TVDE:
 *
 * MASTER     → dono da plataforma; vê e acede a tudo
 * superadmin → Gestor de Frota; gere frota, motoristas e staff
 * admin      → Motorista; self-service (próprios dados / UUIDs / viaturas)
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

/** Apenas MASTER e Gestor de Frota podem criar utilizadores. */
export function canCreateUsers(actor: Role): boolean {
  return actor === 'master' || actor === 'superadmin';
}

/** Apenas MASTER e Gestor de Frota podem activar/desactivar utilizadores. */
export function canToggleUserStatus(actor: Role): boolean {
  return actor === 'master' || actor === 'superadmin';
}

/** Role interno `admin` = Motorista (self-service). */
export function isDriverRole(role: Role): boolean {
  return role === 'admin';
}

/**
 * Áreas do dashboard e role mínimo.
 * Motorista (`admin`) só passa em dashboard + módulos operacionais self-service + meus_pagamentos.
 * Gestão (users, billing, admin_mgmt, settings, audit, pagamentos gestão) → superadmin+.
 */
export const DASHBOARD_ACCESS: Record<string, Role> = {
  dashboard: 'staff',
  tenants: 'master',
  workspaces: 'superadmin',
  clients: 'staff',
  billing: 'superadmin',
  whmcs: 'superadmin',
  bolt: 'staff',
  uber: 'staff',
  via_verde: 'staff',
  eletricidade: 'staff',
  combustivel: 'staff',
  /** Gestão completa de pagamentos (calculadora / sync) — só gestor+ */
  pagamentos: 'superadmin',
  /** Conta corrente dos motoristas (créditos/débitos) — só gestor+ */
  conta_corrente: 'superadmin',
  /** Lista dos próprios payment_reports — motorista e acima */
  meus_pagamentos: 'admin',
  /** Documentos pessoais do motorista (consulta) */
  documentos: 'admin',
  calendar: 'staff',
  admin_mgmt: 'superadmin',
  virtualization: 'superadmin',
  users: 'superadmin',
  modules: 'superadmin',
  audit: 'superadmin',
  settings: 'superadmin',
};

export function canAccessDashboardArea(actor: Role, area: keyof typeof DASHBOARD_ACCESS): boolean {
  return hasMinRole(actor, DASHBOARD_ACCESS[area]);
}

/** Clientes: staff (não motorista). MASTER → Tenants; Gestor → Utilizadores. */
export function canAccessClientsDashboard(actor: Role): boolean {
  if (actor === 'master' || actor === 'superadmin' || isDriverRole(actor)) return false;
  return hasMinRole(actor, DASHBOARD_ACCESS.clients);
}

/** Motorista: self-service (Uber/Bolt/VV/etc. filtrados + meus pagamentos + perfil). */
export function canAccessDriverSelfService(actor: Role): boolean {
  return isDriverRole(actor);
}

/**
 * Eventos «Fatura agendada» no calendário — gestores/staff (não motoristas).
 * A feature também depende de autofaturação activa + Moloni no workspace.
 */
export function canCreateCalendarScheduledInvoice(actor: Role): boolean {
  return !isDriverRole(actor);
}
