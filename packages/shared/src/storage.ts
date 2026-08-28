export const STORAGE_GB_BYTES = 1_000_000_000;

export interface TenantStorageBreakdown {
  userDocuments: number;
  calendarAttachments: number;
  ecommerceProductImages: number;
  ecommerceMediaAssets: number;
  branding: number;
}

export interface TenantStorageSummary {
  limitBytes: number;
  limitGb: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  breakdown: TenantStorageBreakdown;
  plan: string;
  siteId: string | null;
  tenantName: string | null;
  /** Presente na listagem MASTER */
  tenantId?: string;
}

export function gbToStorageBytes(gb: number): number {
  return Math.round(gb * STORAGE_GB_BYTES);
}

export function storageBytesToGb(bytes: number): number {
  return bytes / STORAGE_GB_BYTES;
}

export function formatStorageBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  if (value < 1000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}

export function storageUsagePercent(usedBytes: number, limitBytes: number): number {
  if (limitBytes <= 0) return 100;
  return Math.min(100, Math.round((usedBytes / limitBytes) * 100));
}

export function storageLimitAlertLevel(
  usagePercent: number
): 'success' | 'info' | 'warning' | 'danger' {
  if (usagePercent >= 90) return 'danger';
  if (usagePercent >= 75) return 'warning';
  if (usagePercent >= 50) return 'info';
  return 'success';
}
