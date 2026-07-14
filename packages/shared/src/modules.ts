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

export type RemovedModuleKey = (typeof REMOVED_MODULE_KEYS)[number];

export function isRemovedModule(moduleKey: string): boolean {
  return (REMOVED_MODULE_KEYS as readonly string[]).includes(moduleKey);
}

export function filterTvdeModules<T extends { key: string }>(modules: T[]): T[] {
  return modules.filter((m) => !isRemovedModule(m.key));
}
