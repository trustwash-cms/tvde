import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '@tvde/database';
import type {
  VirtualizationPveGuest,
  VirtualizationPveGuestNetwork,
  VirtualizationPveGuestNetworkAddress,
  VirtualizationPveGuestPingResult,
  VirtualizationPveGuestType,
  VirtualizationPveNodeSummary,
  VirtualizationPveServerDetail,
  VirtualizationPveServerPublic,
  VirtualizationPveStorageSummary,
} from '@tvde/shared';
import { extractPveApiTokenId, normalizePveApiTokenValue } from '@tvde/shared';
import { decrypt, encrypt } from '../lib/crypto';
import {
  pveGuestAgentNetworkInterfaces,
  pveGuestPower,
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

export async function getVirtualizationPveAlertContext(
  tenantId: string,
  workspaceId: string,
  serverId: string
): Promise<{
  serverLabel: string;
  error?: string;
  nodes: VirtualizationPveNodeSummary[];
  storages: VirtualizationPveStorageSummary[];
  guests: VirtualizationPveGuest[];
}> {
  const server = await prisma.virtualizationPveServer.findFirst({
    where: { id: serverId, tenantId, workspaceId, isActive: true },
  });
  if (!server) {
    return { serverLabel: serverId, error: 'Servidor PVE não encontrado', nodes: [], storages: [], guests: [] };
  }

  const config = getClientConfig(server);
  try {
    const [nodes, resources, storages] = await Promise.all([
      pveListNodes(config),
      pveListClusterResources(config),
      pveListStorageResources(config),
    ]);
    const guests = resources
      .map(mapPveGuestResource)
      .filter((guest): guest is VirtualizationPveGuest => guest != null);

    return {
      serverLabel: server.label,
      nodes: nodes.map((node) => ({
        node: node.node,
        status: node.status ?? 'unknown',
        cpu: node.cpu ?? 0,
        maxcpu: node.maxcpu ?? 0,
        mem: node.mem ?? 0,
        maxmem: node.maxmem ?? 0,
        uptime: node.uptime ?? 0,
      })),
      storages: filterLocalPveStorages(storages).map(mapPveStorageResource),
      guests,
    };
  } catch (err) {
    return {
      serverLabel: server.label,
      error: err instanceof Error ? err.message : 'Erro ao consultar PVE',
      nodes: [],
      storages: [],
      guests: [],
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
  const manualIps = parseGuestManualIps(server.guestManualIps);
  const resources = await pveListClusterResources(getClientConfig(server));
  return resources
    .map(mapPveGuestResource)
    .filter((guest): guest is VirtualizationPveGuest => guest != null)
    .map((guest) => ({
      ...guest,
      manualIp: manualIps[guestManualIpKey(guest.type, guest.vmid)] ?? null,
    }))
    .sort((a, b) => a.vmid - b.vmid || a.name.localeCompare(b.name, 'pt'));
}

function guestManualIpKey(guestType: VirtualizationPveGuestType, vmid: number): string {
  return `${guestType}:${vmid}`;
}

function parseGuestManualIps(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) out[key] = raw.trim();
  }
  return out;
}

export async function setVirtualizationPveGuestManualIp(
  tenantId: string,
  workspaceId: string,
  serverId: string,
  guestType: VirtualizationPveGuestType,
  vmid: number,
  ip: string | null
): Promise<VirtualizationPveGuest> {
  const server = await loadPveServerOrThrow(tenantId, workspaceId, serverId);
  const key = guestManualIpKey(guestType, vmid);
  const next = parseGuestManualIps(server.guestManualIps);
  const cleaned = (ip ?? '').trim();
  if (cleaned) {
    // Validação leve IPv4/IPv6
    if (!/^[\d.:a-fA-F]+$/.test(cleaned) || cleaned.length > 45) {
      throw new Error('IP inválido');
    }
    next[key] = cleaned;
  } else {
    delete next[key];
  }

  await prisma.virtualizationPveServer.update({
    where: { id: serverId },
    data: { guestManualIps: next },
  });

  const guests = await listVirtualizationPveGuests(tenantId, workspaceId, serverId);
  const guest = guests.find((item) => item.type === guestType && item.vmid === vmid);
  if (!guest) throw new Error('Guest não encontrado');
  return guest;
}

export async function powerVirtualizationPveGuest(
  tenantId: string,
  workspaceId: string,
  serverId: string,
  guestType: VirtualizationPveGuestType,
  vmid: number,
  action: 'start' | 'stop'
): Promise<{ ok: true }> {
  const server = await loadPveServerOrThrow(tenantId, workspaceId, serverId);
  const guests = await listVirtualizationPveGuests(tenantId, workspaceId, serverId);
  const guest = guests.find((item) => item.type === guestType && item.vmid === vmid);
  if (!guest) throw new Error('Guest não encontrado');

  const running = guest.status.toLowerCase() === 'running';
  if (action === 'start' && running) {
    throw new Error('A máquina já está a correr');
  }
  if (action === 'stop' && !running) {
    throw new Error('A máquina já está parada');
  }

  await pveGuestPower(getClientConfig(server), guest.node, guestType, vmid, action);
  return { ok: true };
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

const execFileAsync = promisify(execFile);
const PING_HOST_PATTERN = /^[\d.:a-fA-F]+$/;

function parsePingOutput(output: string, host: string): VirtualizationPveGuestPingResult {
  const lines = output.split('\n');
  const statsLine = lines.find(
    (line) => line.includes('packet loss') || line.includes('packets transmitted')
  );

  let packetsSent = 0;
  let packetsReceived = 0;
  let packetLossPercent = 100;

  const txRx = statsLine?.match(/(\d+)\s+packets transmitted,\s*(\d+)\s+(?:packets )?received/);
  if (txRx) {
    packetsSent = Number(txRx[1]);
    packetsReceived = Number(txRx[2]);
  }
  const loss = statsLine?.match(/([\d.]+)%\s*packet loss/);
  if (loss) packetLossPercent = Number(loss[1]);

  let minMs: number | undefined;
  let avgMs: number | undefined;
  let maxMs: number | undefined;

  const rttLine = lines.find(
    (line) => line.includes('min/avg/max') || line.includes('round-trip')
  );
  const rtt = rttLine?.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)/);
  if (rtt) {
    minMs = Number(rtt[1]);
    avgMs = Number(rtt[2]);
    maxMs = Number(rtt[3]);
  }

  return {
    host,
    success: packetsReceived > 0,
    packetsSent,
    packetsReceived,
    packetLossPercent,
    minMs,
    avgMs,
    maxMs,
    output: output.trim(),
  };
}

export async function pingVirtualizationPveGuest(
  tenantId: string,
  workspaceId: string,
  serverId: string,
  guestType: VirtualizationPveGuestType,
  vmid: number
): Promise<VirtualizationPveGuestPingResult> {
  const server = await loadPveServerOrThrow(tenantId, workspaceId, serverId);
  const host = parseGuestManualIps(server.guestManualIps)[guestManualIpKey(guestType, vmid)];
  if (!host) {
    throw new Error('Defina um IP manual antes de fazer ping');
  }
  if (!PING_HOST_PATTERN.test(host) || host.length > 45) {
    throw new Error('IP manual inválido');
  }

  const isDarwin = process.platform === 'darwin';
  const args = isDarwin ? ['-c', '4', '-W', '2000', host] : ['-c', '4', '-W', '2', host];

  try {
    const { stdout, stderr } = await execFileAsync('ping', args, {
      timeout: 20_000,
      maxBuffer: 64 * 1024,
    });
    return parsePingOutput(`${stdout}\n${stderr}`.trim(), host);
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = [execErr.stdout, execErr.stderr].filter(Boolean).join('\n').trim();
    if (output) {
      const parsed = parsePingOutput(output, host);
      return {
        ...parsed,
        error: parsed.success ? undefined : 'Sem resposta ao ping',
      };
    }
    throw new Error(execErr.message || 'Falha ao executar ping no servidor API');
  }
}

