import type {
  VirtualizationPveDashboardSummary,
  VirtualizationPveGuest,
  VirtualizationPveStorageSummary,
} from '@tvde/shared';
import type { PveClusterResource, PveStorageResource } from './virtualization-pve.client';

/** Storages PBS montados no PVE (já contam nos cards PBS). */
export function isPveAttachedPbsStorage(storage: {
  plugintype?: string | null;
}): boolean {
  return (storage.plugintype ?? '').toLowerCase() === 'pbs';
}

export function filterLocalPveStorages<T extends { plugintype?: string | null }>(
  storages: T[]
): T[] {
  return storages.filter((storage) => !isPveAttachedPbsStorage(storage));
}

export function mapPveStorageResource(
  storage: PveStorageResource
): VirtualizationPveStorageSummary {
  const totalBytes = storage.maxdisk;
  const usedBytes = storage.disk;
  const availBytes = Math.max(0, totalBytes - usedBytes);
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  return {
    storage: storage.storage,
    node: storage.node,
    totalBytes,
    usedBytes,
    availBytes,
    usedPercent,
    status: storage.status,
    plugintype: storage.plugintype,
  };
}

export function mapPveGuestResource(resource: PveClusterResource): VirtualizationPveGuest | null {
  if (resource.type !== 'qemu' && resource.type !== 'lxc') return null;
  const vmid = resource.vmid;
  if (typeof vmid !== 'number' || !Number.isFinite(vmid)) return null;
  const node = resource.node?.trim();
  if (!node) return null;

  return {
    vmid,
    name: resource.name?.trim() || `guest-${vmid}`,
    node,
    type: resource.type,
    status: (resource.status ?? 'unknown').toLowerCase(),
    cpu: typeof resource.cpu === 'number' ? resource.cpu : undefined,
    mem: typeof resource.mem === 'number' ? resource.mem : undefined,
    maxmem: typeof resource.maxmem === 'number' ? resource.maxmem : undefined,
  };
}

export function buildPveDashboardSummary(input: {
  serverId: string;
  serverLabel: string;
  version: string | null;
  storages: PveStorageResource[];
  resources: PveClusterResource[];
  error?: string;
}): VirtualizationPveDashboardSummary {
  const localStorages = filterLocalPveStorages(input.storages);
  const mappedStorages = localStorages.map(mapPveStorageResource);
  const totalBytes = mappedStorages.reduce((sum, storage) => sum + storage.totalBytes, 0);
  const usedBytes = mappedStorages.reduce((sum, storage) => sum + storage.usedBytes, 0);
  const availBytes = mappedStorages.reduce((sum, storage) => sum + storage.availBytes, 0);
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  const nodeCount = new Set(
    localStorages.map((storage) => storage.node).filter((node): node is string => Boolean(node))
  ).size;

  return {
    serverId: input.serverId,
    serverLabel: input.serverLabel,
    version: input.version,
    nodeCount,
    vmCount: input.resources.filter((item) => item.type === 'qemu').length,
    ctCount: input.resources.filter((item) => item.type === 'lxc').length,
    storageCount: mappedStorages.length,
    totalBytes,
    usedBytes,
    availBytes,
    usedPercent,
    error: input.error,
  };
}
