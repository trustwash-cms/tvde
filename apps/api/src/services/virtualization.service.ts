import { prisma } from '@tvde/database';
import type {
  VirtualizationDashboardData,
  VirtualizationLatestBackup,
  VirtualizationPbsServerDetail,
  VirtualizationPbsServerPublic,
  VirtualizationSettingsPublic,
} from '@tvde/shared';
import { extractPbsApiTokenId, normalizePbsApiTokenValue } from '@tvde/shared';
import { decrypt, encrypt } from '../lib/crypto';
import {
  extractDeduplicationRatio,
  isBackupTask,
  mapTaskStatus,
  parseBackupIdFromTask,
  parseBackupNameFromTask,
  pbsGetDatastoreStatus,
  pbsGetDatastoreUsage,
  pbsListGroups,
  pbsListSnapshots,
  pbsListTasks,
  pbsTestConnection,
  type PbsClientConfig,
  type PbsTask,
} from './virtualization-pbs.client';
import {
  pveListClusterResources,
  pveListStorageResources,
  pveTestConnection,
  type PveClientConfig,
} from './virtualization-pve.client';
import { buildPveDashboardSummary } from './virtualization-pve.mappers';
import {
  getCachedVirtualizationDashboard,
  invalidateVirtualizationDashboardCache,
  setCachedVirtualizationDashboard,
} from './virtualization-dashboard.cache';
import {
  touchPbsServerStatusIfChanged,
  touchPveServerStatusIfChanged,
} from './virtualization-server-status';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function mapServerPublic(
  row: {
    id: string;
    label: string;
    tags: unknown;
    baseUrl: string;
    datastore: string;
    verifySsl: boolean;
    isActive: boolean;
    sortOrder: number;
    encryptedApiToken: string;
    apiTokenId: string | null;
    lastError: string | null;
    lastCheckedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }
): VirtualizationPbsServerPublic {
  return {
    id: row.id,
    label: row.label,
    tags: toStringArray(row.tags),
    baseUrl: row.baseUrl,
    datastore: row.datastore,
    verifySsl: row.verifySsl,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    hasApiToken: Boolean(row.encryptedApiToken),
    apiTokenId: row.apiTokenId,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function getClientConfig(row: {
  baseUrl: string;
  encryptedApiToken: string;
  verifySsl: boolean;
}): PbsClientConfig {
  return {
    baseUrl: row.baseUrl,
    apiToken: decrypt(row.encryptedApiToken),
    verifySsl: row.verifySsl,
  };
}

function getPveClientConfig(row: {
  baseUrl: string;
  encryptedApiToken: string;
  verifySsl: boolean;
}): PveClientConfig {
  return {
    baseUrl: row.baseUrl,
    apiToken: decrypt(row.encryptedApiToken),
    verifySsl: row.verifySsl,
  };
}

async function getOrCreateSettings(tenantId: string, workspaceId: string) {
  const existing = await prisma.virtualizationSetting.findUnique({
    where: { workspaceId },
  });
  if (existing) return existing;

  return prisma.virtualizationSetting.create({
    data: {
      tenantId,
      workspaceId,
    },
  });
}

function mapSettingsPublic(row: {
  notifyOnBackupFailure: boolean;
  notifyWhatsappEnabled: boolean;
  notifyWhatsappPhones: unknown;
  notifyEmailEnabled: boolean;
  notifyEmailAddresses: unknown;
  pollIntervalMinutes: number;
  dashboardRefreshSeconds: number;
  sshDefaultPort: number;
  sshDefaultUsername: string;
  sshAuthMode: string;
  encryptedSshPassword: string | null;
  encryptedSshPrivateKey: string | null;
}): VirtualizationSettingsPublic {
  return {
    notifyOnBackupFailure: row.notifyOnBackupFailure,
    notifyWhatsappEnabled: row.notifyWhatsappEnabled,
    notifyWhatsappPhones: toStringArray(row.notifyWhatsappPhones),
    notifyEmailEnabled: row.notifyEmailEnabled,
    notifyEmailAddresses: toStringArray(row.notifyEmailAddresses),
    pollIntervalMinutes: row.pollIntervalMinutes,
    dashboardRefreshSeconds: row.dashboardRefreshSeconds,
    sshDefaultPort: row.sshDefaultPort,
    sshDefaultUsername: row.sshDefaultUsername,
    sshAuthMode: row.sshAuthMode === 'private_key' ? 'private_key' : 'password',
    hasSshPassword: Boolean(row.encryptedSshPassword),
    hasSshPrivateKey: Boolean(row.encryptedSshPrivateKey),
  };
}

function taskToBackup(
  task: PbsTask,
  server: { id: string; label: string }
): VirtualizationLatestBackup {
  const status = mapTaskStatus(task.status ?? task.exitstatus);
  const backupTime =
    task.endtime != null
      ? new Date(task.endtime * 1000).toISOString()
      : task.starttime != null
        ? new Date(task.starttime * 1000).toISOString()
        : null;

  return {
    serverId: server.id,
    serverLabel: server.label,
    backupId: parseBackupIdFromTask(task),
    name: parseBackupNameFromTask(task),
    backupTime,
    sizeBytes: null,
    status,
    errorMessage: status === 'FAILED' ? task.exitstatus ?? task.status ?? 'Falha no backup' : null,
  };
}

export async function listVirtualizationPbsServers(
  tenantId: string,
  workspaceId: string
): Promise<VirtualizationPbsServerPublic[]> {
  const rows = await prisma.virtualizationPbsServer.findMany({
    where: { tenantId, workspaceId },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  return rows.map(mapServerPublic);
}

export async function getVirtualizationSettings(
  tenantId: string,
  workspaceId: string
): Promise<VirtualizationSettingsPublic> {
  const row = await getOrCreateSettings(tenantId, workspaceId);
  return mapSettingsPublic(row);
}

export async function updateVirtualizationSettings(
  tenantId: string,
  workspaceId: string,
  input: Partial<VirtualizationSettingsPublic> & {
    sshPassword?: string;
    sshPrivateKey?: string;
    sshPassphrase?: string;
  }
): Promise<VirtualizationSettingsPublic> {
  await getOrCreateSettings(tenantId, workspaceId);

  const sshAuthMode = input.sshAuthMode;
  if (sshAuthMode === 'private_key' && input.sshPrivateKey === '') {
    throw new Error('Chave privada SSH é obrigatória ao mudar para este modo');
  }
  if (sshAuthMode === 'password' && input.sshPassword === '') {
    throw new Error('Password SSH é obrigatória ao mudar para este modo');
  }

  const row = await prisma.virtualizationSetting.update({
    where: { workspaceId },
    data: {
      notifyOnBackupFailure: input.notifyOnBackupFailure,
      notifyWhatsappEnabled: input.notifyWhatsappEnabled,
      notifyWhatsappPhones: input.notifyWhatsappPhones,
      notifyEmailEnabled: input.notifyEmailEnabled,
      notifyEmailAddresses: input.notifyEmailAddresses,
      pollIntervalMinutes: input.pollIntervalMinutes,
      dashboardRefreshSeconds: input.dashboardRefreshSeconds,
      sshDefaultPort: input.sshDefaultPort,
      sshDefaultUsername: input.sshDefaultUsername?.trim(),
      sshAuthMode: input.sshAuthMode,
      encryptedSshPassword:
        input.sshPassword !== undefined
          ? input.sshPassword.trim()
            ? encrypt(input.sshPassword.trim())
            : null
          : undefined,
      encryptedSshPrivateKey:
        input.sshPrivateKey !== undefined
          ? input.sshPrivateKey.trim()
            ? encrypt(input.sshPrivateKey.trim())
            : null
          : undefined,
      encryptedSshPassphrase:
        input.sshPassphrase !== undefined
          ? input.sshPassphrase.trim()
            ? encrypt(input.sshPassphrase.trim())
            : null
          : undefined,
    },
  });
  invalidateVirtualizationDashboardCache(workspaceId);
  return mapSettingsPublic(row);
}

export async function getWorkspaceSshCredentials(
  tenantId: string,
  workspaceId: string
): Promise<{
  sshAuthMode: 'password' | 'private_key';
  encryptedSshPassword: string | null;
  encryptedSshPrivateKey: string | null;
  encryptedSshPassphrase: string | null;
  sshDefaultPort: number;
  sshDefaultUsername: string;
}> {
  const settings = await getOrCreateSettings(tenantId, workspaceId);
  return {
    sshAuthMode: settings.sshAuthMode === 'private_key' ? 'private_key' : 'password',
    encryptedSshPassword: settings.encryptedSshPassword,
    encryptedSshPrivateKey: settings.encryptedSshPrivateKey,
    encryptedSshPassphrase: settings.encryptedSshPassphrase,
    sshDefaultPort: settings.sshDefaultPort,
    sshDefaultUsername: settings.sshDefaultUsername,
  };
}

export async function createVirtualizationPbsServer(
  tenantId: string,
  workspaceId: string,
  input: {
    label: string;
    tags?: string[];
    baseUrl: string;
    datastore: string;
    apiToken: string;
    apiTokenId?: string | null;
    verifySsl?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }
): Promise<VirtualizationPbsServerPublic> {
  const row = await prisma.virtualizationPbsServer.create({
    data: {
      tenantId,
      workspaceId,
      label: input.label.trim(),
      tags: input.tags ?? [],
      baseUrl: input.baseUrl.trim(),
      datastore: input.datastore.trim(),
      apiTokenId: input.apiTokenId ?? extractPbsApiTokenId(input.apiToken),
      encryptedApiToken: encrypt(normalizePbsApiTokenValue(input.apiToken)),
      verifySsl: input.verifySsl ?? false,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return mapServerPublic(row);
}

export async function updateVirtualizationPbsServer(
  tenantId: string,
  workspaceId: string,
  serverId: string,
  input: {
    label?: string;
    tags?: string[];
    baseUrl?: string;
    datastore?: string;
    apiToken?: string;
    apiTokenId?: string | null;
    verifySsl?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }
): Promise<VirtualizationPbsServerPublic> {
  const existing = await prisma.virtualizationPbsServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!existing) {
    throw new Error('Servidor PBS não encontrado');
  }

  const row = await prisma.virtualizationPbsServer.update({
    where: { id: serverId },
    data: {
      label: input.label?.trim(),
      tags: input.tags,
      baseUrl: input.baseUrl?.trim(),
      datastore: input.datastore?.trim(),
      encryptedApiToken: input.apiToken
        ? encrypt(normalizePbsApiTokenValue(input.apiToken))
        : undefined,
      apiTokenId: input.apiToken
        ? (input.apiTokenId ?? extractPbsApiTokenId(input.apiToken))
        : input.apiTokenId,
      verifySsl: input.verifySsl,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
  return mapServerPublic(row);
}

export async function deleteVirtualizationPbsServer(
  tenantId: string,
  workspaceId: string,
  serverId: string
): Promise<void> {
  const existing = await prisma.virtualizationPbsServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!existing) {
    throw new Error('Servidor PBS não encontrado');
  }
  await prisma.virtualizationPbsServer.delete({ where: { id: serverId } });
}

export async function testVirtualizationPbsServer(
  tenantId: string,
  workspaceId: string,
  serverId: string
): Promise<{ ok: true; version: string; datastores: string[] }> {
  const server = await prisma.virtualizationPbsServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!server) {
    throw new Error('Servidor PBS não encontrado');
  }

  try {
    const result = await pbsTestConnection(getClientConfig(server));
    await prisma.virtualizationPbsServer.update({
      where: { id: serverId },
      data: { lastError: null, lastCheckedAt: new Date() },
    });
    return { ok: true, version: result.version, datastores: result.datastores };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro de ligação';
    await prisma.virtualizationPbsServer.update({
      where: { id: serverId },
      data: { lastError: message, lastCheckedAt: new Date() },
    });
    throw new Error(message);
  }
}

export async function getVirtualizationPbsServerDetail(
  tenantId: string,
  workspaceId: string,
  serverId: string
): Promise<VirtualizationPbsServerDetail> {
  const server = await prisma.virtualizationPbsServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!server) {
    throw new Error('Servidor PBS não encontrado');
  }

  const base = mapServerPublic(server);
  const config = getClientConfig(server);

  try {
    const [status, groups, snapshots] = await Promise.all([
      pbsGetDatastoreStatus(config, server.datastore),
      pbsListGroups(config, server.datastore),
      pbsListSnapshots(config, server.datastore),
    ]);

    const usedPercent = status.total > 0 ? (status.used / status.total) * 100 : 0;

    await prisma.virtualizationPbsServer.update({
      where: { id: serverId },
      data: { lastError: null, lastCheckedAt: new Date() },
    });

    return {
      ...base,
      groupsCount: groups.length,
      snapshotsCount: snapshots.length,
      datastoreStatus: {
        source: 'pbs',
        serverId: server.id,
        serverLabel: server.label,
        store: status.store ?? server.datastore,
        totalBytes: status.total,
        usedBytes: status.used,
        availBytes: status.avail,
        usedPercent,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar PBS';
    await prisma.virtualizationPbsServer.update({
      where: { id: serverId },
      data: { lastError: message, lastCheckedAt: new Date() },
    });
    return {
      ...base,
      groupsCount: null,
      snapshotsCount: null,
      datastoreStatus: {
        source: 'pbs',
        serverId: server.id,
        serverLabel: server.label,
        store: server.datastore,
        totalBytes: 0,
        usedBytes: 0,
        availBytes: 0,
        usedPercent: 0,
        error: message,
      },
    };
  }
}

export async function getVirtualizationDashboard(
  tenantId: string,
  workspaceId: string
): Promise<VirtualizationDashboardData> {
  const [pbsServers, pveServers] = await Promise.all([
    prisma.virtualizationPbsServer.findMany({
      where: { tenantId, workspaceId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    }),
    prisma.virtualizationPveServer.findMany({
      where: { tenantId, workspaceId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    }),
  ]);

  const datastores: VirtualizationDashboardData['datastores'] = [];
  const pveServerSummaries: VirtualizationDashboardData['pveServers'] = [];
  const latestBackups: VirtualizationLatestBackup[] = [];
  const recentFailures: VirtualizationLatestBackup[] = [];
  let backupCount = 0;
  let dedupSum = 0;
  let dedupCount = 0;
  let serversOnline = 0;
  const serversTotal = pbsServers.length + pveServers.length;

  if (serversTotal === 0) {
    return {
      serversOnline: 0,
      serversTotal: 0,
      storage: { totalBytes: 0, usedBytes: 0, availBytes: 0, usedPercent: 0 },
      backupCount: 0,
      deduplicationRatio: null,
      datastores: [],
      pveServers: [],
      latestBackups: [],
      recentFailures: [],
    };
  }

  await Promise.all([
    ...pbsServers.map(async (server) => {
      const config = getClientConfig(server);
      const meta = { id: server.id, label: server.label };

      try {
        const [status, usage, groups, tasks] = await Promise.all([
          pbsGetDatastoreStatus(config, server.datastore),
          pbsGetDatastoreUsage(config, server.datastore),
          pbsListGroups(config, server.datastore),
          pbsListTasks(config),
        ]);

        backupCount += groups.length;
        const dedup = extractDeduplicationRatio(usage);
        if (dedup != null) {
          dedupSum += dedup;
          dedupCount += 1;
        }

        const usedPercent = status.total > 0 ? (status.used / status.total) * 100 : 0;
        datastores.push({
          source: 'pbs',
          serverId: server.id,
          serverLabel: server.label,
          store: status.store ?? usage?.store ?? server.datastore,
          totalBytes: status.total,
          usedBytes: status.used,
          availBytes: status.avail,
          usedPercent,
        });
        serversOnline += 1;

        const backupTasks = tasks
          .filter(isBackupTask)
          .sort((a, b) => (b.endtime ?? b.starttime ?? 0) - (a.endtime ?? a.starttime ?? 0))
          .slice(0, 10);

        for (const task of backupTasks) {
          const mapped = taskToBackup(task, meta);
          latestBackups.push(mapped);
          if (mapped.status === 'FAILED') {
            recentFailures.push(mapped);
          }
        }

        await touchPbsServerStatusIfChanged(server.id, null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro ao consultar PBS';
        datastores.push({
          source: 'pbs',
          serverId: server.id,
          serverLabel: server.label,
          store: server.datastore,
          totalBytes: 0,
          usedBytes: 0,
          availBytes: 0,
          usedPercent: 0,
          error: message,
        });
        await touchPbsServerStatusIfChanged(server.id, message);
      }
    }),
    ...pveServers.map(async (server) => {
      const config = getPveClientConfig(server);

      try {
        const [versionData, storages, resources] = await Promise.all([
          pveTestConnection(config),
          pveListStorageResources(config),
          pveListClusterResources(config),
        ]);

        pveServerSummaries.push(
          buildPveDashboardSummary({
            serverId: server.id,
            serverLabel: server.label,
            version: versionData.version,
            storages,
            resources,
            error:
              storages.length === 0 ? 'Nenhum storage encontrado no cluster PVE.' : undefined,
          })
        );

        serversOnline += 1;
        await touchPveServerStatusIfChanged(server.id, null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro ao consultar PVE';
        pveServerSummaries.push(
          buildPveDashboardSummary({
            serverId: server.id,
            serverLabel: server.label,
            version: null,
            storages: [],
            resources: [],
            error: message,
          })
        );
        await touchPveServerStatusIfChanged(server.id, message);
      }
    }),
  ]);

  const healthyPveServers = pveServerSummaries.filter((server) => !server.error);
  const healthyDatastores = [...datastores.filter((ds) => !ds.error), ...healthyPveServers];
  const totalBytes = healthyDatastores.reduce((sum, ds) => sum + ds.totalBytes, 0);
  const usedBytes = healthyDatastores.reduce((sum, ds) => sum + ds.usedBytes, 0);
  const availBytes = healthyDatastores.reduce((sum, ds) => sum + ds.availBytes, 0);
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  latestBackups.sort((a, b) => {
    const ta = a.backupTime ? Date.parse(a.backupTime) : 0;
    const tb = b.backupTime ? Date.parse(b.backupTime) : 0;
    return tb - ta;
  });

  datastores.sort((a, b) => {
    const labelCmp = a.serverLabel.localeCompare(b.serverLabel, 'pt');
    if (labelCmp !== 0) return labelCmp;
    return a.store.localeCompare(b.store, 'pt');
  });

  pveServerSummaries.sort((a, b) => a.serverLabel.localeCompare(b.serverLabel, 'pt'));

  return {
    serversOnline,
    serversTotal,
    storage: { totalBytes, usedBytes, availBytes, usedPercent },
    backupCount,
    deduplicationRatio: dedupCount > 0 ? dedupSum / dedupCount : null,
    datastores,
    pveServers: pveServerSummaries,
    latestBackups: latestBackups.slice(0, 40),
    recentFailures: recentFailures.slice(0, 10),
  };
}

export async function getVirtualizationDashboardCached(
  tenantId: string,
  workspaceId: string,
  options?: { bypassCache?: boolean }
): Promise<VirtualizationDashboardData> {
  const settings = await getVirtualizationSettings(tenantId, workspaceId);
  const ttlSeconds = settings.dashboardRefreshSeconds;

  if (!options?.bypassCache) {
    const cached = getCachedVirtualizationDashboard(workspaceId);
    if (cached) return cached;
  }

  const data = await getVirtualizationDashboard(tenantId, workspaceId);
  setCachedVirtualizationDashboard(workspaceId, data, ttlSeconds);
  return data;
}
