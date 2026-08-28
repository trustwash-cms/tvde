/** Módulos legado CMS removidos do TVDE — não aparecem na UI nem na API. */
export const REMOVED_MODULE_KEYS = [
  'bookings',
  'shopify',
  'woocommerce',
  'carwash',
  'products',
  'services',
  'ecommerce',
] as const;

/**
 * Módulos mantidos na BD/API mas ocultos nos toggles de activação
 * (tenant / workspace / painel de módulos). Reaparecem ao remover da lista.
 */
export const HIDDEN_ACTIVATION_MODULE_KEYS = [
  'stripe',
  'sms',
  'clients',
] as const;

export type RemovedModuleKey = (typeof REMOVED_MODULE_KEYS)[number];
export type HiddenActivationModuleKey = (typeof HIDDEN_ACTIVATION_MODULE_KEYS)[number];

export function isRemovedModule(moduleKey: string): boolean {
  return (REMOVED_MODULE_KEYS as readonly string[]).includes(moduleKey);
}

export function isHiddenActivationModule(moduleKey: string): boolean {
  return (HIDDEN_ACTIVATION_MODULE_KEYS as readonly string[]).includes(moduleKey);
}

export function filterTvdeModules<T extends { key: string }>(modules: T[]): T[] {
  return modules.filter((m) => !isRemovedModule(m.key));
}

/** Lista para toggles / cards de activação (exclui removidos + ocultos). */
export function filterActivatableModules<T extends { key: string }>(modules: T[]): T[] {
  return filterTvdeModules(modules).filter((m) => !isHiddenActivationModule(m.key));
}
