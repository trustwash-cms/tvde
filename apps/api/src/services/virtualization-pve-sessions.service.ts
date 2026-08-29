import { randomUUID } from 'node:crypto';
import type {
  VirtualizationPveConsoleSession,
  VirtualizationPveGuestType,
  VirtualizationPveSshSession,
} from '@tvde/shared';
import { decrypt } from '../lib/crypto';
import { prisma } from '@tvde/database';
import {
  buildPveConsoleWebsocketUrl,
  pveCreateTermProxy,
  pveCreateVncProxy,
  type PveClientConfig,
} from './virtualization-pve.client';
import {
  getVirtualizationPveGuestNetwork,
  listVirtualizationPveGuests,
} from './virtualization-pve.service';

const SESSION_TTL_MS = 2 * 60 * 1000;

export interface PveConsoleSessionRecord {
  id: string;
  tenantId: string;
  workspaceId: string;
  serverId: string;
  node: string;
  vmid: number;
  guestType: VirtualizationPveGuestType;
  mode: 'vnc' | 'term';
  name: string;
  port: string;
  ticket: string;
  user: string;
  config: PveClientConfig;
  pveWsUrl: string;
  expiresAt: number;
}

export interface PveSshSessionRecord {
  id: string;
  tenantId: string;
  workspaceId: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  expiresAt: number;
}

const consoleSessions = new Map<string, PveConsoleSessionRecord>();
const sshSessions = new Map<string, PveSshSessionRecord>();

function pruneExpired() {
  const now = Date.now();
  for (const [id, session] of consoleSessions) {
    if (session.expiresAt <= now) consoleSessions.delete(id);
  }
  for (const [id, session] of sshSessions) {
    if (session.expiresAt <= now) sshSessions.delete(id);
  }
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

export async function createVirtualizationPveConsoleSession(
  tenantId: string,
  workspaceId: string,
  serverId: string,
  guestType: VirtualizationPveGuestType,
  vmid: number
): Promise<VirtualizationPveConsoleSession> {
  pruneExpired();

  const server = await prisma.virtualizationPveServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!server) throw new Error('Servidor PVE não encontrado');

  const guests = await listVirtualizationPveGuests(tenantId, workspaceId, serverId);
  const guest = guests.find((item) => item.type === guestType && item.vmid === vmid);
  if (!guest) throw new Error('Guest não encontrado');
  if (guest.status !== 'running') {
    throw new Error('A máquina tem de estar a correr para abrir a consola');
  }

  const config = getClientConfig(server);
  const mode: 'vnc' | 'term' = guestType === 'lxc' ? 'term' : 'vnc';
  const proxy =
    mode === 'vnc'
      ? await pveCreateVncProxy(config, guest.node, guestType, vmid)
      : await pveCreateTermProxy(config, guest.node, guestType, vmid);

  const sessionId = randomUUID();
  const port = String(proxy.port);
  const ticket = proxy.ticket;
  const user = proxy.user ?? 'root@pam';
  const pveWsUrl = buildPveConsoleWebsocketUrl(config, guest.node, guestType, vmid, port, ticket);

  consoleSessions.set(sessionId, {
    id: sessionId,
    tenantId,
    workspaceId,
    serverId,
    node: guest.node,
    vmid,
    guestType,
    mode,
    name: guest.name,
    port,
    ticket,
    user,
    config,
    pveWsUrl,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  return {
    sessionId,
    mode,
    guestType,
    vmid,
    node: guest.node,
    name: guest.name,
    websocketPath: `/virtualization/pve/console-ws/${sessionId}`,
    ...(mode === 'vnc' ? { ticket } : {}),
  };
}

export async function createVirtualizationPveSshSession(
  tenantId: string,
  workspaceId: string,
  serverId: string,
  guestType: VirtualizationPveGuestType,
  vmid: number,
  input: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }
): Promise<VirtualizationPveSshSession> {
  pruneExpired();

  const server = await prisma.virtualizationPveServer.findFirst({
    where: { id: serverId, tenantId, workspaceId },
  });
  if (!server) throw new Error('Servidor PVE não encontrado');

  const guests = await listVirtualizationPveGuests(tenantId, workspaceId, serverId);
  const guest = guests.find((item) => item.type === guestType && item.vmid === vmid);
  if (!guest) throw new Error('Guest não encontrado');
  if (guest.status !== 'running') {
    throw new Error('A máquina tem de estar a correr para abrir SSH');
  }

  const host = input.host.trim();
  const username = input.username.trim();
  if (!host) throw new Error('Indique o IP/host SSH');
  if (!username) throw new Error('Indique o utilizador SSH');
  if (!input.password?.trim() && !input.privateKey?.trim()) {
    throw new Error('Indique password ou chave privada SSH');
  }

  const network = await getVirtualizationPveGuestNetwork(
    tenantId,
    workspaceId,
    serverId,
    guestType,
    vmid
  );
  const allowed = new Set(network.ips.map((ip) => ip.address));
  if (guest.manualIp) allowed.add(guest.manualIp);
  // Se há IPs conhecidos (agent ou manual), o host tem de coincidir; senão permite IP livre.
  if (allowed.size > 0 && !allowed.has(host)) {
    throw new Error('O IP escolhido não corresponde ao IP manual nem às interfaces detectadas');
  }

  const sessionId = randomUUID();
  const port = input.port && Number.isFinite(input.port) ? input.port : 22;

  sshSessions.set(sessionId, {
    id: sessionId,
    tenantId,
    workspaceId,
    host,
    port,
    username,
    password: input.password?.trim() || undefined,
    privateKey: input.privateKey?.trim() || undefined,
    passphrase: input.passphrase?.trim() || undefined,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  return {
    sessionId,
    host,
    port,
    username,
    websocketPath: `/virtualization/pve/ssh-ws/${sessionId}`,
  };
}

export function getPveConsoleSession(
  sessionId: string,
  tenantId: string,
  workspaceId: string
): PveConsoleSessionRecord | null {
  pruneExpired();
  const session = consoleSessions.get(sessionId);
  if (!session) return null;
  if (session.tenantId !== tenantId || session.workspaceId !== workspaceId) return null;
  if (session.expiresAt <= Date.now()) {
    consoleSessions.delete(sessionId);
    return null;
  }
  return session;
}

export function getPveSshSession(
  sessionId: string,
  tenantId: string,
  workspaceId: string
): PveSshSessionRecord | null {
  pruneExpired();
  const session = sshSessions.get(sessionId);
  if (!session) return null;
  if (session.tenantId !== tenantId || session.workspaceId !== workspaceId) return null;
  if (session.expiresAt <= Date.now()) {
    sshSessions.delete(sessionId);
    return null;
  }
  return session;
}

/** One-shot consume after successful WS connect (optional cleanup). */
export function consumePveConsoleSession(sessionId: string): void {
  consoleSessions.delete(sessionId);
}

export function consumePveSshSession(sessionId: string): void {
  sshSessions.delete(sessionId);
}
