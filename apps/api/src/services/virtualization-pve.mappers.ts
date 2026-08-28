import type {
  VirtualizationPveDashboardSummary,
  VirtualizationPveStorageSummary,
} from '@tvde/shared';
import type { PveClusterResource, PveStorageResource } from './virtualization-pve.client';

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

export function buildPveDashboardSummary(input: {
  serverId: string;
  serverLabel: string;
  version: string | null;
  storages: PveStorageResource[];
  resources: PveClusterResource[];
  error?: string;
}): VirtualizationPveDashboardSummary {
  const mappedStorages = input.storages.map(mapPveStorageResource);
  const totalBytes = mappedStorages.reduce((sum, storage) => sum + storage.totalBytes, 0);
  const usedBytes = mappedStorages.reduce((sum, storage) => sum + storage.usedBytes, 0);
  const availBytes = mappedStorages.reduce((sum, storage) => sum + storage.availBytes, 0);
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  const nodeCount = new Set(
    input.storages.map((storage) => storage.node).filter((node): node is string => Boolean(node))
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
