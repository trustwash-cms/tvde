import { prisma } from '@tvde/database';
import type {
  VirtualizationPveGuest,
  VirtualizationPveGuestNetwork,
  VirtualizationPveGuestNetworkAddress,
  VirtualizationPveGuestType,
  VirtualizationPveNodeSummary,
  VirtualizationPveServerDetail,
  VirtualizationPveServerPublic,
} from '@tvde/shared';
import { extractPveApiTokenId, normalizePveApiTokenValue } from '@tvde/shared';
import { decrypt, encrypt } from '../lib/crypto';
import {
  pveGuestAgentNetworkInterfaces,
  pveListClusterResources,
  pveListNodes,
  pveListStorageResources,
  pveLxcConfig,
  pveLxcInterfaces,
  pveTestConnection,
  type PveClientConfig,
} from './virtualization-pve.client';
import { filterLocalPveStorages, mapPveGuestResource, mapPveStorageResource } from './virtualization-pve.mappers';

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
      storages: filterLocalPveStorages(storages).map(mapPveStorageResource),
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

async function loadPveServerOrThrow(tenantId: string, workspaceId: string, serverId: string) {
  const server = await prisma.virtualizationPveServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!server) {
    throw new Error('Servidor PVE não encontrado');
  }
  return server;
}

export async function listVirtualizationPveGuests(
  tenantId: string,
  workspaceId: string,
  serverId: string
): Promise<VirtualizationPveGuest[]> {
  const server = await loadPveServerOrThrow(tenantId, workspaceId, serverId);
  const resources = await pveListClusterResources(getClientConfig(server));
  return resources
    .map(mapPveGuestResource)
    .filter((guest): guest is VirtualizationPveGuest => guest != null)
    .sort((a, b) => a.vmid - b.vmid || a.name.localeCompare(b.name, 'pt'));
}

function extractIpv4FromAgentPayload(payload: unknown): VirtualizationPveGuestNetworkAddress[] {
  const root = payload as { result?: unknown } | unknown[];
  const list = Array.isArray(root)
    ? root
    : Array.isArray((root as { result?: unknown }).result)
      ? ((root as { result: unknown[] }).result)
      : [];

  const ips: VirtualizationPveGuestNetworkAddress[] = [];
  for (const iface of list) {
    if (!iface || typeof iface !== 'object') continue;
    const row = iface as {
      name?: string;
      'ip-addresses'?: Array<{ 'ip-address'?: string; 'ip-address-type'?: string }>;
    };
    const addresses = row['ip-addresses'] ?? [];
    for (const addr of addresses) {
      const ip = addr['ip-address']?.trim();
      const familyRaw = (addr['ip-address-type'] ?? '').toLowerCase();
      if (!ip || ip.startsWith('127.') || ip === '::1') continue;
      if (familyRaw.includes('ipv6') || ip.includes(':')) {
        ips.push({ address: ip, family: 'ipv6', interfaceName: row.name });
      } else {
        ips.push({ address: ip, family: 'ipv4', interfaceName: row.name });
      }
    }
  }
  return ips;
}

function extractIpsFromLxcInterfaces(payload: unknown): VirtualizationPveGuestNetworkAddress[] {
  const list = Array.isArray(payload) ? payload : [];
  const ips: VirtualizationPveGuestNetworkAddress[] = [];
  for (const iface of list) {
    if (!iface || typeof iface !== 'object') continue;
    const row = iface as { name?: string; inet?: string; inet6?: string; hwaddr?: string };
    if (row.inet) {
      const ip = row.inet.split('/')[0]?.trim();
      if (ip && !ip.startsWith('127.')) {
        ips.push({ address: ip, family: 'ipv4', interfaceName: row.name });
      }
    }
    if (row.inet6) {
      const ip = row.inet6.split('/')[0]?.trim();
      if (ip && ip !== '::1') {
        ips.push({ address: ip, family: 'ipv6', interfaceName: row.name });
      }
    }
  }
  return ips;
}

function extractIpsFromLxcConfig(config: Record<string, string>): VirtualizationPveGuestNetworkAddress[] {
  const ips: VirtualizationPveGuestNetworkAddress[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (!/^net\d+$/i.test(key) || typeof value !== 'string') continue;
    const ipMatch = value.match(/(?:^|,)ip=([^,]+)/i);
    const raw = ipMatch?.[1]?.trim();
    if (!raw || raw.toLowerCase() === 'dhcp' || raw.toLowerCase() === 'manual') continue;
    const ip = raw.split('/')[0]?.trim();
    if (ip && !ip.startsWith('127.')) {
      ips.push({ address: ip, family: ip.includes(':') ? 'ipv6' : 'ipv4', interfaceName: key });
    }
  }
  return ips;
}

export async function getVirtualizationPveGuestNetwork(
  tenantId: string,
  workspaceId: string,
  serverId: string,
  guestType: VirtualizationPveGuestType,
  vmid: number
): Promise<VirtualizationPveGuestNetwork> {
  const server = await loadPveServerOrThrow(tenantId, workspaceId, serverId);
  const config = getClientConfig(server);
  const guests = await listVirtualizationPveGuests(tenantId, workspaceId, serverId);
  const guest = guests.find((item) => item.type === guestType && item.vmid === vmid);
  if (!guest) {
    return { ips: [], reason: 'Guest não encontrado neste servidor PVE.' };
  }
  if (guest.status !== 'running') {
    return { ips: [], reason: 'A máquina está parada — ligue-a para obter IPs.' };
  }

  try {
    if (guestType === 'qemu') {
      const payload = await pveGuestAgentNetworkInterfaces(config, guest.node, vmid);
      const ips = extractIpv4FromAgentPayload(payload);
      if (ips.length === 0) {
        return {
          ips: [],
          reason:
            'Sem IPs via qemu-guest-agent. Confirme que o agent está instalado e a correr na VM.',
        };
      }
      return { ips };
    }

    try {
      const ifaces = await pveLxcInterfaces(config, guest.node, vmid);
      const fromIfaces = extractIpsFromLxcInterfaces(ifaces);
      if (fromIfaces.length > 0) return { ips: fromIfaces };
    } catch {
      // fallback to config
    }

    const lxcConfig = await pveLxcConfig(config, guest.node, vmid);
    const fromConfig = extractIpsFromLxcConfig(lxcConfig);
    if (fromConfig.length === 0) {
      return { ips: [], reason: 'Sem IPs nas interfaces/config do CT.' };
    }
    return { ips: fromConfig };
  } catch (err) {
    return {
      ips: [],
      reason: err instanceof Error ? err.message : 'Não foi possível obter a rede do guest.',
    };
  }
}

