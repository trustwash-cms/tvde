import type { Role } from '@tvde/shared';

export interface ModuleCapabilities {
  allowedModules: string[];
  activeModules: string[];
}

const MODULE_LABELS: Record<string, string> = {
  billing: 'Facturação',
  clients: 'Clientes',
  sms: 'SMS',
  calendar: 'Calendário',
  bolt: 'Bolt',
  uber: 'Uber',
  via_verde: 'Via Verde',
  eletricidade: 'Eletricidade',
  combustivel: 'Combustível',
  pagamentos: 'Pagamentos',
  admin_mgmt: 'Gestão Administrativa',
};

export function getModuleLabel(moduleKey: string): string {
  return MODULE_LABELS[moduleKey] ?? moduleKey;
}

/** Módulo activo no workspace do utilizador (tenant autorizado + workspace enabled). MASTER vê tudo. */
export function hasActiveModule(
  role: Role,
  capabilities: ModuleCapabilities | undefined,
  moduleKey: string
): boolean {
  if (role === 'master') return true;
  return capabilities?.activeModules.includes(moduleKey) ?? false;
}
