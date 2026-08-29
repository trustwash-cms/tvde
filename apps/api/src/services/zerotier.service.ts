import { prisma } from '@tvde/database';
import type {
  VirtualizationZerotierAccountPublic,
  VirtualizationZerotierJoinTargetPublic,
  VirtualizationZerotierMemberPublic,
  VirtualizationZerotierNetworkPublic,
  VirtualizationZerotierRemoteNetwork,
} from '@tvde/shared';
import {
  ZEROTIER_NETWORK_MEMBER_LIMIT,
  extractHostFromServerUrl,
  parseSshEndpoint,
} from '@tvde/shared';
import { decrypt, encrypt } from '../lib/crypto';
import { touchZerotierAccountStatusIfChanged,
  touchZerotierNetworkStatusIfChanged,
} from './virtualization-server-status';
import { getWorkspaceSshCredentials } from './virtualization.service';
import {
  zerotierListMembers,
  zerotierListNetworks,
  zerotierSetMemberAuthorized,
  zerotierTestConnection,
  type ZerotierApiMode,
  type ZerotierClientConfig,
} from './zerotier.client';

function getClientConfig(row: {
  encryptedApiToken: string;
  apiMode: string;
  orgId: string | null;
}): ZerotierClientConfig {
  return {
    apiToken: decrypt(row.encryptedApiToken),
    apiMode: row.apiMode === 'central' ? 'central' : 'legacy',
    orgId: row.orgId,
  };
}

function mapNetworkPublic(
  row: {
    id: string;
    accountId: string;
    networkId: string;
    label: string;
    description: string | null;
    isActive: boolean;
    memberLimit: number;
    lastMemberCount: number | null;
    lastAuthorizedCount: number | null;
    lastError: string | null;
    lastCheckedAt: Date | null;
    sortOrder: number;
  },
  accountLabel: string
): VirtualizationZerotierNetworkPublic {
  const memberCount = row.lastMemberCount ?? 0;
  const slotsRemaining =
    row.lastMemberCount == null ? null : Math.max(0, row.memberLimit - memberCount);

  return {
    id: row.id,
    accountId: row.accountId,
    accountLabel,
    networkId: row.networkId,
    label: row.label,
    description: row.description,
    isActive: row.isActive,
    memberLimit: row.memberLimit,
    lastMemberCount: row.lastMemberCount,
    lastAuthorizedCount: row.lastAuthorizedCount,
    slotsRemaining,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    sortOrder: row.sortOrder,
  };
}

export async function listVirtualizationZerotierAccounts(
  tenantId: string,
  workspaceId: string
): Promise<VirtualizationZerotierAccountPublic[]> {
  const rows = await prisma.virtualizationZerotierAccount.findMany({
    where: { tenantId, workspaceId },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    include: { _count: { select: { networks: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    email: row.email,
    apiMode: row.apiMode === 'central' ? 'central' : 'legacy',
    orgId: row.orgId,
    hasApiToken: Boolean(row.encryptedApiToken),
    sortOrder: row.sortOrder,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    networkCount: row._count.networks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createVirtualizationZerotierAccount(
  tenantId: string,
  workspaceId: string,
  input: {
    label: string;
    email?: string | null;
    apiToken: string;
    apiMode?: ZerotierApiMode;
    orgId?: string | null;
    sortOrder?: number;
  }
): Promise<VirtualizationZerotierAccountPublic> {
  const row = await prisma.virtualizationZerotierAccount.create({
    data: {
      tenantId,
      workspaceId,
      label: input.label.trim(),
      email: input.email?.trim() || null,
      encryptedApiToken: encrypt(input.apiToken.trim()),
      apiMode: input.apiMode ?? 'legacy',
      orgId: input.orgId?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
    },
    include: { _count: { select: { networks: true } } },
  });

  return {
    id: row.id,
    label: row.label,
    email: row.email,
    apiMode: row.apiMode === 'central' ? 'central' : 'legacy',
    orgId: row.orgId,
    hasApiToken: true,
    sortOrder: row.sortOrder,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    networkCount: row._count.networks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateVirtualizationZerotierAccount(
  tenantId: string,
  workspaceId: string,
  accountId: string,
  input: {
    label?: string;
    email?: string | null;
    apiToken?: string;
    apiMode?: ZerotierApiMode;
    orgId?: string | null;
    sortOrder?: number;
  }
): Promise<VirtualizationZerotierAccountPublic> {
  const existing = await prisma.virtualizationZerotierAccount.findFirst({
    where: { id: accountId, tenantId, workspaceId },
  });
  if (!existing) throw new Error('Conta ZeroTier não encontrada');

  const row = await prisma.virtualizationZerotierAccount.update({
    where: { id: accountId },
    data: {
      label: input.label?.trim(),
      email: input.email === undefined ? undefined : input.email?.trim() || null,
      encryptedApiToken: input.apiToken ? encrypt(input.apiToken.trim()) : undefined,
      apiMode: input.apiMode,
      orgId: input.orgId === undefined ? undefined : input.orgId?.trim() || null,
      sortOrder: input.sortOrder,
    },
    include: { _count: { select: { networks: true } } },
  });

  return {
    id: row.id,
    label: row.label,
    email: row.email,
    apiMode: row.apiMode === 'central' ? 'central' : 'legacy',
    orgId: row.orgId,
    hasApiToken: Boolean(row.encryptedApiToken),
    sortOrder: row.sortOrder,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    networkCount: row._count.networks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deleteVirtualizationZerotierAccount(
  tenantId: string,
  workspaceId: string,
  accountId: string
): Promise<void> {
  const existing = await prisma.virtualizationZerotierAccount.findFirst({
    where: { id: accountId, tenantId, workspaceId },
  });
  if (!existing) throw new Error('Conta ZeroTier não encontrada');
  await prisma.virtualizationZerotierAccount.delete({ where: { id: accountId } });
}

export async function testVirtualizationZerotierAccount(
  tenantId: string,
  workspaceId: string,
  accountId: string
): Promise<{ ok: true; networkCount: number }> {
  const account = await prisma.virtualizationZerotierAccount.findFirst({
    where: { id: accountId, tenantId, workspaceId },
  });
  if (!account) throw new Error('Conta ZeroTier não encontrada');

  try {
    const result = await zerotierTestConnection(getClientConfig(account));
    await touchZerotierAccountStatusIfChanged(accountId, null);
    return { ok: true, networkCount: result.networkCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro de ligação';
    await touchZerotierAccountStatusIfChanged(accountId, message);
    throw new Error(message);
  }
}

export async function listVirtualizationZerotierRemoteNetworks(
  tenantId: string,
  workspaceId: string,
  accountId: string
): Promise<VirtualizationZerotierRemoteNetwork[]> {
  const account = await prisma.virtualizationZerotierAccount.findFirst({
    where: { id: accountId, tenantId, workspaceId },
    include: { networks: { select: { networkId: true } } },
  });
  if (!account) throw new Error('Conta ZeroTier não encontrada');

  const linked = new Set(account.networks.map((network) => network.networkId));
  const remote = await zerotierListNetworks(getClientConfig(account));

  return remote.map((network) => ({
    networkId: network.id,
    name: network.config?.name?.trim() || network.id,
    description: network.config?.description?.trim() || null,
    totalMemberCount: network.totalMemberCount ?? 0,
    authorizedMemberCount: network.authorizedMemberCount ?? 0,
    alreadyLinked: linked.has(network.id),
  }));
}

export async function listVirtualizationZerotierNetworks(
  tenantId: string,
  workspaceId: string
): Promise<VirtualizationZerotierNetworkPublic[]> {
  const rows = await prisma.virtualizationZerotierNetwork.findMany({
    where: { tenantId, workspaceId },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    include: { account: { select: { label: true } } },
  });

  return rows.map((row) => mapNetworkPublic(row, row.account.label));
}

export async function linkVirtualizationZerotierNetwork(
  tenantId: string,
  workspaceId: string,
  accountId: string,
  input: {
    networkId: string;
    label?: string;
    description?: string | null;
    memberLimit?: number;
    isActive?: boolean;
    sortOrder?: number;
  }
): Promise<VirtualizationZerotierNetworkPublic> {
  const account = await prisma.virtualizationZerotierAccount.findFirst({
    where: { id: accountId, tenantId, workspaceId },
  });
  if (!account) throw new Error('Conta ZeroTier não encontrada');

  const networkId = input.networkId.trim().toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(networkId)) {
    throw new Error('Network ID inválido — deve ter 16 caracteres hexadecimais');
  }

  const remoteNetworks = await zerotierListNetworks(getClientConfig(account));
  const remote = remoteNetworks.find((item) => item.id === networkId);
  if (!remote) {
    throw new Error('Network ID não encontrado nesta conta ZeroTier');
  }

  const row = await prisma.virtualizationZerotierNetwork.upsert({
    where: {
      accountId_networkId: {
        accountId,
        networkId,
      },
    },
    create: {
      tenantId,
      workspaceId,
      accountId,
      networkId,
      label: input.label?.trim() || remote.config?.name?.trim() || networkId,
      description: input.description ?? remote.config?.description ?? null,
      memberLimit: input.memberLimit ?? ZEROTIER_NETWORK_MEMBER_LIMIT,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
      lastMemberCount: remote.totalMemberCount ?? 0,
      lastAuthorizedCount: remote.authorizedMemberCount ?? 0,
      lastCheckedAt: new Date(),
    },
    update: {
      label: input.label?.trim() || undefined,
      description: input.description ?? undefined,
      memberLimit: input.memberLimit,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      lastMemberCount: remote.totalMemberCount ?? 0,
      lastAuthorizedCount: remote.authorizedMemberCount ?? 0,
      lastCheckedAt: new Date(),
      lastError: null,
    },
    include: { account: { select: { label: true } } },
  });

  return mapNetworkPublic(row, row.account.label);
}

export async function unlinkVirtualizationZerotierNetwork(
  tenantId: string,
  workspaceId: string,
  networkRowId: string
): Promise<void> {
  const existing = await prisma.virtualizationZerotierNetwork.findFirst({
    where: { id: networkRowId, tenantId, workspaceId },
  });
  if (!existing) throw new Error('Rede ZeroTier não encontrada');
  await prisma.virtualizationZerotierNetwork.delete({ where: { id: networkRowId } });
}

export async function refreshVirtualizationZerotierNetwork(
  tenantId: string,
  workspaceId: string,
  networkRowId: string
): Promise<VirtualizationZerotierNetworkPublic> {
  const row = await prisma.virtualizationZerotierNetwork.findFirst({
    where: { id: networkRowId, tenantId, workspaceId },
    include: { account: true },
  });
  if (!row) throw new Error('Rede ZeroTier não encontrada');

  try {
    const members = await zerotierListMembers(getClientConfig(row.account), row.networkId);
    const authorizedCount = members.filter((member) => member.config?.authorized).length;
    const counts = {
      lastMemberCount: members.length,
      lastAuthorizedCount: authorizedCount,
    };
    await touchZerotierNetworkStatusIfChanged(networkRowId, null, counts);
    const updated = await prisma.virtualizationZerotierNetwork.findUniqueOrThrow({
      where: { id: networkRowId },
      include: { account: { select: { label: true } } },
    });
    return mapNetworkPublic(updated, updated.account.label);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao actualizar rede';
    await touchZerotierNetworkStatusIfChanged(networkRowId, message);
    throw new Error(message);
  }
}

export async function refreshAllVirtualizationZerotierNetworks(
  tenantId: string,
  workspaceId: string
): Promise<number> {
  const networks = await prisma.virtualizationZerotierNetwork.findMany({
    where: { tenantId, workspaceId, isActive: true },
    select: { id: true },
  });

  let refreshed = 0;
  for (const network of networks) {
    try {
      await refreshVirtualizationZerotierNetwork(tenantId, workspaceId, network.id);
      refreshed += 1;
    } catch {
      // keep going
    }
  }
  return refreshed;
}

function mapMemberPublic(member: {
  id: string;
  nodeId?: string;
  name?: string;
  config?: { authorized?: boolean };
  lastOnline?: number;
}): VirtualizationZerotierMemberPublic {
  const memberId = member.id;
  const nodeId = member.nodeId ?? member.id;
  return {
    memberId,
    nodeId,
    name: member.name?.trim() || null,
    authorized: Boolean(member.config?.authorized),
    lastOnline:
      member.lastOnline != null && member.lastOnline > 0
        ? new Date(member.lastOnline).toISOString()
        : null,
  };
}

function mapJoinTargetPublic(row: {
  id: string;
  accountId: string;
  networkRowId: string;
  label: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  useWorkspaceSsh: boolean;
  sshAuthMode: string;
  encryptedSshPassword: string | null;
  encryptedSshPrivateKey: string | null;
  targetKind: string;
  pbsServerId: string | null;
  pveServerId: string | null;
  nodeId: string | null;
  joinStatus: string;
  lastError: string | null;
  provisionLog: string | null;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  network: { networkId: string; label: string };
  account: { label: string; email: string | null };
}): VirtualizationZerotierJoinTargetPublic {
  return {
    id: row.id,
    accountId: row.accountId,
    accountLabel: row.account.label,
    accountEmail: row.account.email,
    networkRowId: row.networkRowId,
    networkId: row.network.networkId,
    networkLabel: row.network.label,
    label: row.label,
    sshHost: row.sshHost,
    sshPort: row.sshPort,
    sshUsername: row.sshUsername,
    useWorkspaceSsh: row.useWorkspaceSsh,
    sshAuthMode: row.sshAuthMode === 'private_key' ? 'private_key' : 'password',
    hasSshPassword: Boolean(row.encryptedSshPassword),
    hasSshPrivateKey: Boolean(row.encryptedSshPrivateKey),
    targetKind: row.targetKind as VirtualizationZerotierJoinTargetPublic['targetKind'],
    pbsServerId: row.pbsServerId,
    pveServerId: row.pveServerId,
    nodeId: row.nodeId,
    joinStatus: row.joinStatus as VirtualizationZerotierJoinTargetPublic['joinStatus'],
    lastError: row.lastError,
    provisionLog: row.provisionLog,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listVirtualizationZerotierNetworkMembers(
  tenantId: string,
  workspaceId: string,
  networkRowId: string
): Promise<VirtualizationZerotierMemberPublic[]> {
  const row = await prisma.virtualizationZerotierNetwork.findFirst({
    where: { id: networkRowId, tenantId, workspaceId },
    include: { account: true },
  });
  if (!row) throw new Error('Rede ZeroTier não encontrada');

  const members = await zerotierListMembers(getClientConfig(row.account), row.networkId);
  return members.map(mapMemberPublic);
}

export async function setVirtualizationZerotierMemberAuthorized(
  tenantId: string,
  workspaceId: string,
  networkRowId: string,
  memberId: string,
  authorized: boolean
): Promise<VirtualizationZerotierMemberPublic> {
  const row = await prisma.virtualizationZerotierNetwork.findFirst({
    where: { id: networkRowId, tenantId, workspaceId },
    include: { account: true },
  });
  if (!row) throw new Error('Rede ZeroTier não encontrada');

  const updated = await zerotierSetMemberAuthorized(
    getClientConfig(row.account),
    row.networkId,
    memberId,
    authorized
  );
  await refreshVirtualizationZerotierNetwork(tenantId, workspaceId, networkRowId);
  return mapMemberPublic(updated);
}

export async function listVirtualizationZerotierJoinTargets(
  tenantId: string,
  workspaceId: string
): Promise<VirtualizationZerotierJoinTargetPublic[]> {
  const rows = await prisma.virtualizationZerotierJoinTarget.findMany({
    where: { tenantId, workspaceId },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      network: { select: { networkId: true, label: true } },
      account: { select: { label: true, email: true } },
    },
  });
  return rows.map(mapJoinTargetPublic);
}

export async function createVirtualizationZerotierJoinTarget(
  tenantId: string,
  workspaceId: string,
  input: {
    networkRowId: string;
    label: string;
    sshHost?: string;
    sshPort?: number;
    sshUsername?: string;
    useWorkspaceSsh?: boolean;
    sshAuthMode?: 'password' | 'private_key';
    sshPassword?: string;
    sshPrivateKey?: string;
    sshPassphrase?: string;
    targetKind?: 'pbs' | 'pve' | 'custom';
    pbsServerId?: string | null;
    pveServerId?: string | null;
  }
): Promise<VirtualizationZerotierJoinTargetPublic> {
  const network = await prisma.virtualizationZerotierNetwork.findFirst({
    where: { id: input.networkRowId, tenantId, workspaceId },
    include: { account: true },
  });
  if (!network) throw new Error('Rede ZeroTier não encontrada');

  let sshHost = input.sshHost?.trim() ?? '';
  const targetKind = input.targetKind ?? 'custom';

  if (!sshHost && input.pbsServerId) {
    const pbs = await prisma.virtualizationPbsServer.findFirst({
      where: { id: input.pbsServerId, tenantId, workspaceId },
    });
    if (!pbs) throw new Error('Servidor PBS não encontrado');
    sshHost = extractHostFromServerUrl(pbs.baseUrl);
  }

  if (!sshHost && input.pveServerId) {
    const pve = await prisma.virtualizationPveServer.findFirst({
      where: { id: input.pveServerId, tenantId, workspaceId },
    });
    if (!pve) throw new Error('Servidor PVE não encontrado');
    sshHost = extractHostFromServerUrl(pve.baseUrl);
  }

  if (!sshHost) throw new Error('Host SSH é obrigatório');

  const useWorkspaceSsh = input.useWorkspaceSsh ?? true;
  const workspaceSsh = useWorkspaceSsh
    ? await getWorkspaceSshCredentials(tenantId, workspaceId)
    : null;

  const defaultSshPort = input.sshPort ?? workspaceSsh?.sshDefaultPort ?? 22;
  const endpoint = parseSshEndpoint(sshHost, defaultSshPort);
  sshHost = endpoint.host;
  const sshPort =
    input.sshPort != null && Number.isFinite(input.sshPort) && input.sshPort > 0
      ? input.sshPort
      : endpoint.port;

  if (!sshHost) throw new Error('Host SSH é obrigatório');

  const sshAuthMode = useWorkspaceSsh
    ? workspaceSsh!.sshAuthMode
    : input.sshAuthMode ?? 'password';

  if (useWorkspaceSsh) {
    if (sshAuthMode === 'private_key' && !workspaceSsh!.encryptedSshPrivateKey) {
      throw new Error('Configure a chave privada SSH nas definições de virtualização');
    }
    if (sshAuthMode === 'password' && !workspaceSsh!.encryptedSshPassword) {
      throw new Error('Configure a password SSH nas definições de virtualização');
    }
  } else if (sshAuthMode === 'private_key') {
    if (!input.sshPrivateKey?.trim()) {
      throw new Error('Chave privada SSH é obrigatória neste modo');
    }
  } else if (!input.sshPassword?.trim()) {
    throw new Error('Password SSH é obrigatória neste modo');
  }

  const row = await prisma.virtualizationZerotierJoinTarget.create({
    data: {
      tenantId,
      workspaceId,
      accountId: network.accountId,
      networkRowId: network.id,
      label: input.label.trim(),
      sshHost,
      sshPort,
      sshUsername: input.sshUsername?.trim() || workspaceSsh?.sshDefaultUsername || 'root',
      useWorkspaceSsh,
      sshAuthMode,
      encryptedSshPassword:
        !useWorkspaceSsh && sshAuthMode === 'password'
          ? encrypt(input.sshPassword!.trim())
          : null,
      encryptedSshPrivateKey:
        !useWorkspaceSsh && sshAuthMode === 'private_key'
          ? encrypt(input.sshPrivateKey!.trim())
          : null,
      encryptedSshPassphrase:
        !useWorkspaceSsh && sshAuthMode === 'private_key' && input.sshPassphrase?.trim()
          ? encrypt(input.sshPassphrase.trim())
          : null,
      targetKind,
      pbsServerId: input.pbsServerId ?? null,
      pveServerId: input.pveServerId ?? null,
    },
    include: {
      network: { select: { networkId: true, label: true } },
      account: { select: { label: true, email: true } },
    },
  });

  return mapJoinTargetPublic(row);
}

export async function getVirtualizationZerotierJoinTarget(
  tenantId: string,
  workspaceId: string,
  targetId: string
): Promise<VirtualizationZerotierJoinTargetPublic> {
  const row = await prisma.virtualizationZerotierJoinTarget.findFirst({
    where: { id: targetId, tenantId, workspaceId },
    include: {
      network: { select: { networkId: true, label: true } },
      account: { select: { label: true, email: true } },
    },
  });
  if (!row) throw new Error('Alvo de join não encontrado');
  return mapJoinTargetPublic(row);
}

export async function deleteVirtualizationZerotierJoinTarget(
  tenantId: string,
  workspaceId: string,
  targetId: string
): Promise<void> {
  const existing = await prisma.virtualizationZerotierJoinTarget.findFirst({
    where: { id: targetId, tenantId, workspaceId },
  });
  if (!existing) throw new Error('Alvo de join não encontrado');
  await prisma.virtualizationZerotierJoinTarget.delete({ where: { id: targetId } });
}
