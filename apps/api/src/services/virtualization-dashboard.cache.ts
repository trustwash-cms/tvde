import type { VirtualizationDashboardData } from '@tvde/shared';

interface CacheEntry {
  expiresAt: number;
  data: VirtualizationDashboardData;
}

const dashboardCache = new Map<string, CacheEntry>();

export function getCachedVirtualizationDashboard(
  workspaceId: string
): VirtualizationDashboardData | null {
  const entry = dashboardCache.get(workspaceId);
  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.data;
}

export function setCachedVirtualizationDashboard(
  workspaceId: string,
  data: VirtualizationDashboardData,
  ttlSeconds: number
): void {
  dashboardCache.set(workspaceId, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    data,
  });
}

export function invalidateVirtualizationDashboardCache(workspaceId?: string): void {
  if (workspaceId) {
    dashboardCache.delete(workspaceId);
    return;
  }
  dashboardCache.clear();
}
