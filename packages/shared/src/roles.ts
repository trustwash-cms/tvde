export const ROLES = ['master', 'superadmin', 'admin', 'staff'] as const;
export type Role = (typeof ROLES)[number];

/** Hierarquia de permissões TVDE (valores internos inalterados). */
export const ROLE_HIERARCHY: Record<Role, number> = {
  master: 100,
  superadmin: 80,
  admin: 60,
  staff: 40,
};

/** Etiquetas visíveis no TVDE — semântica diferente do CMS. */
export const ROLE_LABELS: Record<Role, string> = {
  master: 'MASTER',
  superadmin: 'Superadmin (Gestor de Frota)',
  admin: 'Admin (Motorista)',
  staff: 'Staff',
};

export function getRoleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export function hasMinRole(userRole: Role, required: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}
