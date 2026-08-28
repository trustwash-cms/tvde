import { prisma } from '@tvde/database';
import type {
  VirtualizationPveNodeSummary,
  VirtualizationPveServerDetail,
  VirtualizationPveServerPublic,
} from '@tvde/shared';
import { extractPveApiTokenId, normalizePveApiTokenValue } from '@tvde/shared';
import { decrypt, encrypt } from '../lib/crypto';
import {
  pveListClusterResources,
  pveListNodes,
  pveListStorageResources,
  pveTestConnection,
  type PveClientConfig,
} from './virtualization-pve.client';
import { buildPveDashboardSummary, mapPveStorageResource } from './virtualization-pve.mappers';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function mapServerPublic(row: {
  id: string;
  label: string;
  tags: unknown;
  baseUrl: string;
  verifySsl: boolean;
  isActive: boolean;
  sortOrder: number;
  encryptedApiToken: string;
  apiTokenId: string | null;
  lastError: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): VirtualizationPveServerPublic {
  return {
    id: row.id,
    label: row.label,
    tags: toStringArray(row.tags),
    baseUrl: row.baseUrl,
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
}): PveClientConfig {
  return {
    baseUrl: row.baseUrl,
    apiToken: decrypt(row.encryptedApiToken),
    verifySsl: row.verifySsl,
  };
}

export async function listVirtualizationPveServers(
  tenantId: string,
  workspaceId: string
): Promise<VirtualizationPveServerPublic[]> {
  const rows = await prisma.virtualizationPveServer.findMany({
    where: { tenantId, workspaceId },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  return rows.map(mapServerPublic);
}

export async function createVirtualizationPveServer(
  tenantId: string,
  workspaceId: string,
  input: {
    label: string;
    tags?: string[];
    baseUrl: string;
    apiToken: string;
    apiTokenId?: string | null;
    verifySsl?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }
): Promise<VirtualizationPveServerPublic> {
  const row = await prisma.virtualizationPveServer.create({
    data: {
      tenantId,
      workspaceId,
      label: input.label.trim(),
      tags: input.tags ?? [],
      baseUrl: input.baseUrl.trim(),
      apiTokenId: input.apiTokenId ?? extractPveApiTokenId(input.apiToken),
      encryptedApiToken: encrypt(normalizePveApiTokenValue(input.apiToken)),
      verifySsl: input.verifySsl ?? false,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return mapServerPublic(row);
}

export async function updateVirtualizationPveServer(
  tenantId: string,
  workspaceId: string,
  serverId: string,
  input: {
    label?: string;
    tags?: string[];
    baseUrl?: string;
    apiToken?: string;
    apiTokenId?: string | null;
    verifySsl?: boolean;
    isActive?: boolean;
    sortOrder?: number;
  }
): Promise<VirtualizationPveServerPublic> {
  const existing = await prisma.virtualizationPveServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!existing) {
    throw new Error('Servidor PVE não encontrado');
  }

  const row = await prisma.virtualizationPveServer.update({
    where: { id: serverId },
    data: {
      label: input.label?.trim(),
      tags: input.tags,
      baseUrl: input.baseUrl?.trim(),
      encryptedApiToken: input.apiToken
        ? encrypt(normalizePveApiTokenValue(input.apiToken))
        : undefined,
      apiTokenId: input.apiToken
        ? (input.apiTokenId ?? extractPveApiTokenId(input.apiToken))
        : input.apiTokenId,
      verifySsl: input.verifySsl,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
  return mapServerPublic(row);
}

export async function deleteVirtualizationPveServer(
  tenantId: string,
  workspaceId: string,
  serverId: string
): Promise<void> {
  const existing = await prisma.virtualizationPveServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!existing) {
    throw new Error('Servidor PVE não encontrado');
  }
  await prisma.virtualizationPveServer.delete({ where: { id: serverId } });
}

export async function testVirtualizationPveServer(
  tenantId: string,
  workspaceId: string,
  serverId: string
): Promise<{ ok: true; version: string; nodes: string[] }> {
  const server = await prisma.virtualizationPveServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!server) {
    throw new Error('Servidor PVE não encontrado');
  }

  try {
    const result = await pveTestConnection(getClientConfig(server));
    await prisma.virtualizationPveServer.update({
      where: { id: serverId },
      data: { lastError: null, lastCheckedAt: new Date() },
    });
    return { ok: true, version: result.version, nodes: result.nodes };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro de ligação';
    await prisma.virtualizationPveServer.update({
      where: { id: serverId },
      data: { lastError: message, lastCheckedAt: new Date() },
    });
    throw new Error(message);
  }
}

export async function getVirtualizationPveServerDetail(
  tenantId: string,
  workspaceId: string,
  serverId: string
): Promise<VirtualizationPveServerDetail> {
  const server = await prisma.virtualizationPveServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!server) {
    throw new Error('Servidor PVE não encontrado');
  }

  const base = mapServerPublic(server);
  const config = getClientConfig(server);

  try {
    const [versionData, nodes, resources, storages] = await Promise.all([
      pveTestConnection(config),
      pveListNodes(config),
      pveListClusterResources(config),
      pveListStorageResources(config),
    ]);

    const nodeSummaries: VirtualizationPveNodeSummary[] = nodes.map((node) => ({
      node: node.node,
      status: node.status ?? 'unknown',
      cpu: node.cpu ?? 0,
      maxcpu: node.maxcpu ?? 0,
      mem: node.mem ?? 0,
      maxmem: node.maxmem ?? 0,
      uptime: node.uptime ?? 0,
    }));

    const vmCount = resources.filter((item) => item.type === 'qemu').length;
    const ctCount = resources.filter((item) => item.type === 'lxc').length;

    await prisma.virtualizationPveServer.update({
      where: { id: serverId },
      data: { lastError: null, lastCheckedAt: new Date() },
    });

    return {
      ...base,
      version: versionData.version,
      nodes: nodeSummaries,
      storages: storages.map(mapPveStorageResource),
      vmCount,
      ctCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar PVE';
    await prisma.virtualizationPveServer.update({
      where: { id: serverId },
      data: { lastError: message, lastCheckedAt: new Date() },
    });
    return {
      ...base,
      version: null,
      nodes: [],
      storages: [],
      vmCount: 0,
      ctCount: 0,
    };
  }
}
