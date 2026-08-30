export const VIRTUALIZATION_MODULE_KEY = 'virtualization';
export const VIRTUALIZATION_MODULE_NAME = 'Virtualização';

export const VIRTUALIZATION_POLL_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;
export const VIRTUALIZATION_DASHBOARD_REFRESH_OPTIONS = [15, 30, 60, 120] as const;
export const ZEROTIER_NETWORK_MEMBER_LIMIT = 10;

export type VirtualizationBackupStatus = 'OK' | 'FAILED' | 'RUNNING' | 'UNKNOWN';

export interface VirtualizationPbsServerPublic {
  id: string;
  label: string;
  tags: string[];
  baseUrl: string;
  datastore: string;
  verifySsl: boolean;
  isActive: boolean;
  sortOrder: number;
  hasApiToken: boolean;
  apiTokenId: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VirtualizationSettingsPublic {
  notifyOnBackupFailure: boolean;
  notifyWhatsappEnabled: boolean;
  notifyWhatsappPhones: string[];
  notifyEmailEnabled: boolean;
  notifyEmailAddresses: string[];
  pollIntervalMinutes: number;
  dashboardRefreshSeconds: number;
  sshDefaultPort: number;
  sshDefaultUsername: string;
  sshAuthMode: VirtualizationZerotierSshAuthMode;
  hasSshPassword: boolean;
  hasSshPrivateKey: boolean;
}

export interface VirtualizationDatastoreSummary {
  source: 'pbs';
  serverId: string;
  serverLabel: string;
  store: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  usedPercent: number;
  error?: string;
}

export interface VirtualizationPveStorageSummary {
  storage: string;
  node?: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  usedPercent: number;
  status?: string;
  plugintype?: string;
}

export type VirtualizationPveGuestType = 'qemu' | 'lxc';

export interface VirtualizationPveGuest {
  vmid: number;
  name: string;
  node: string;
  type: VirtualizationPveGuestType;
  status: string;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  /** IP guardado manualmente na app (preferido para SSH). */
  manualIp?: string | null;
}

export interface VirtualizationPveGuestNetworkAddress {
  address: string;
  family: 'ipv4' | 'ipv6';
  interfaceName?: string;
}

export interface VirtualizationPveGuestNetwork {
  ips: VirtualizationPveGuestNetworkAddress[];
  reason?: string;
}

export interface VirtualizationPveConsoleSession {
  sessionId: string;
  mode: 'vnc' | 'term';
  guestType: VirtualizationPveGuestType;
  vmid: number;
  node: string;
  name: string;
  websocketPath: string;
  /** Ticket VNC (password RFB). Só para mode=vnc; TTL curto. */
  ticket?: string;
}

export interface VirtualizationPveSshSession {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  websocketPath: string;
}

export interface VirtualizationPveGuestPingResult {
  host: string;
  success: boolean;
  packetsSent: number;
  packetsReceived: number;
  packetLossPercent: number;
  minMs?: number;
  avgMs?: number;
  maxMs?: number;
  output: string;
  error?: string;
}

export interface VirtualizationPveDashboardSummary {
  serverId: string;
  serverLabel: string;
  version: string | null;
  nodeCount: number;
  vmCount: number;
  ctCount: number;
  storageCount: number;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  usedPercent: number;
  error?: string;
}

export interface VirtualizationLatestBackup {
  serverId: string;
  serverLabel: string;
  backupId: string;
  name: string;
  backupTime: string | null;
  sizeBytes: number | null;
  status: VirtualizationBackupStatus;
  errorMessage: string | null;
}

export interface VirtualizationDashboardData {
  serversOnline: number;
  serversTotal: number;
  storage: {
    totalBytes: number;
    usedBytes: number;
    availBytes: number;
    usedPercent: number;
  };
  backupCount: number;
  deduplicationRatio: number | null;
  datastores: VirtualizationDatastoreSummary[];
  pveServers: VirtualizationPveDashboardSummary[];
  latestBackups: VirtualizationLatestBackup[];
  recentFailures: VirtualizationLatestBackup[];
}

export interface VirtualizationPbsServerDetail extends VirtualizationPbsServerPublic {
  groupsCount: number | null;
  snapshotsCount: number | null;
  datastoreStatus: VirtualizationDatastoreSummary | null;
}

export interface VirtualizationPveServerPublic {
  id: string;
  label: string;
  tags: string[];
  baseUrl: string;
  verifySsl: boolean;
  isActive: boolean;
  sortOrder: number;
  hasApiToken: boolean;
  apiTokenId: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VirtualizationPveNodeSummary {
  node: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  uptime: number;
}

export interface VirtualizationPveServerDetail extends VirtualizationPveServerPublic {
  version: string | null;
  nodes: VirtualizationPveNodeSummary[];
  storages: VirtualizationPveStorageSummary[];
  vmCount: number;
  ctCount: number;
}

export interface VirtualizationZerotierAccountPublic {
  id: string;
  label: string;
  email: string | null;
  apiMode: 'legacy' | 'central';
  orgId: string | null;
  hasApiToken: boolean;
  sortOrder: number;
  lastError: string | null;
  lastCheckedAt: string | null;
  networkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VirtualizationZerotierNetworkPublic {
  id: string;
  accountId: string;
  accountLabel: string;
  networkId: string;
  label: string;
  description: string | null;
  isActive: boolean;
  memberLimit: number;
  lastMemberCount: number | null;
  lastAuthorizedCount: number | null;
  slotsRemaining: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  sortOrder: number;
}

export interface VirtualizationZerotierRemoteNetwork {
  networkId: string;
  name: string;
  description: string | null;
  totalMemberCount: number;
  authorizedMemberCount: number;
  alreadyLinked: boolean;
}

export interface VirtualizationZerotierMemberPublic {
  memberId: string;
  nodeId: string;
  name: string | null;
  authorized: boolean;
  ipAssignments: string[];
  lastOnline: string | null;
}

export type VirtualizationZerotierJoinTargetKind = 'pbs' | 'pve' | 'custom';
export type VirtualizationZerotierSshAuthMode = 'password' | 'private_key';
export type VirtualizationZerotierJoinStatus =
  | 'idle'
  | 'running'
  | 'joined'
  | 'authorized'
  | 'failed';

export interface VirtualizationZerotierLocalHostPublic {
  hostname: string;
  username: string;
  isRoot: boolean;
  sudoPasswordless: boolean;
  cliPath: string | null;
  installed: boolean;
  online: boolean;
  nodeId: string | null;
  version: string | null;
  networks: Array<{
    networkId: string;
    status: string;
    name: string | null;
  }>;
  lastError: string | null;
  hint: string | null;
}

export interface VirtualizationZerotierJoinTargetPublic {
  id: string;
  accountId: string;
  accountLabel: string;
  accountEmail: string | null;
  networkRowId: string;
  networkId: string;
  networkLabel: string;
  label: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  useWorkspaceSsh: boolean;
  sshAuthMode: VirtualizationZerotierSshAuthMode;
  hasSshPassword: boolean;
  hasSshPrivateKey: boolean;
  targetKind: VirtualizationZerotierJoinTargetKind;
  pbsServerId: string | null;
  pveServerId: string | null;
  nodeId: string | null;
  joinStatus: VirtualizationZerotierJoinStatus;
  lastError: string | null;
  provisionLog: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Portas da API Proxmox — nunca são porta SSH. */
const PROXMOX_API_PORTS = new Set([8006, 8007]);

/**
 * Normaliza host/porta SSH a partir de URL PBS/PVE, IP, ou "host:porta".
 * Se a porta embutida for 8006/8007 (API), ignora-a e usa defaultPort (SSH).
 */
export function parseSshEndpoint(
  input: string,
  defaultPort = 22
): { host: string; port: number } {
  let raw = input.trim();
  if (!raw) return { host: '', port: defaultPort };

  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withScheme);
    if (url.hostname) {
      const urlPort = url.port ? Number(url.port) : NaN;
      if (Number.isFinite(urlPort) && urlPort > 0 && !PROXMOX_API_PORTS.has(urlPort)) {
        return { host: url.hostname, port: urlPort };
      }
      return { host: url.hostname, port: defaultPort };
    }
  } catch {
    // fall through
  }

  raw = raw.replace(/^https?:\/\//i, '');
  raw = raw.split('/')[0] ?? raw;

  const ipv6 = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6) {
    const port = ipv6[2] ? Number(ipv6[2]) : defaultPort;
    if (PROXMOX_API_PORTS.has(port)) return { host: ipv6[1], port: defaultPort };
    return { host: ipv6[1], port: Number.isFinite(port) && port > 0 ? port : defaultPort };
  }

  const lastColon = raw.lastIndexOf(':');
  if (lastColon > 0) {
    const maybePort = raw.slice(lastColon + 1);
    if (/^\d{1,5}$/.test(maybePort)) {
      const port = Number(maybePort);
      const host = raw.slice(0, lastColon);
      if (PROXMOX_API_PORTS.has(port)) return { host, port: defaultPort };
      return { host, port };
    }
  }

  return { host: raw, port: defaultPort };
}

export function extractHostFromServerUrl(baseUrl: string): string {
  return parseSshEndpoint(baseUrl).host;
}

export function normalizePbsApiTokenSecret(secret: string): string {
  return secret.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}

export function extractPbsApiTokenId(token: string): string | null {
  const normalized = normalizePbsApiTokenValue(token);
  const idx = normalized.lastIndexOf(':');
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

export function buildPbsApiToken(tokenId: string, tokenSecret: string): string {
  let id = tokenId.trim();
  const secret = normalizePbsApiTokenSecret(tokenSecret);

  id = id.replace(/^PBSAPIToken=/i, '').replace(/^PVEAPIToken=/i, '');

  if (!id) {
    throw new Error('Token ID é obrigatório');
  }

  if ((id.includes(':') || id.includes('=')) && !secret) {
    return normalizePbsApiTokenValue(id);
  }

  if (!secret) {
    throw new Error('Secret do token é obrigatório');
  }

  return `${id}:${secret}`;
}

/** Formato PBS: TOKENID:TOKENSECRET (dois pontos, não igual). */
export function normalizePbsApiTokenValue(token: string): string {
  const trimmed = token.trim().replace(/^PBSAPIToken=/i, '').replace(/^PVEAPIToken=/i, '');
  const colonIdx = trimmed.lastIndexOf(':');
  const eqIdx = trimmed.lastIndexOf('=');
  const sepIdx = colonIdx > eqIdx ? colonIdx : eqIdx;
  if (sepIdx <= 0) return trimmed;
  const id = trimmed.slice(0, sepIdx);
  const secret = trimmed.slice(sepIdx + 1);
  return `${id}:${secret}`;
}

export function formatPbsAuthorizationHeader(apiToken: string): string {
  return `PBSAPIToken=${normalizePbsApiTokenValue(apiToken)}`;
}

export function normalizePveApiTokenSecret(secret: string): string {
  return normalizePbsApiTokenSecret(secret);
}

export function extractPveApiTokenId(token: string): string | null {
  const normalized = normalizePveApiTokenValue(token);
  const idx = normalized.lastIndexOf('=');
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

/** Formato PVE: USER@realm!token=secret (igual, não dois pontos). */
export function buildPveApiToken(tokenId: string, tokenSecret: string): string {
  let id = tokenId.trim();
  const secret = normalizePveApiTokenSecret(tokenSecret);

  id = id.replace(/^PVEAPIToken=/i, '').replace(/^PBSAPIToken=/i, '');

  if (!id) {
    throw new Error('Token ID é obrigatório');
  }

  if (id.includes('=') && !secret) {
    return normalizePveApiTokenValue(id);
  }

  if (!secret) {
    throw new Error('Secret do token é obrigatório');
  }

  return `${id}=${secret}`;
}

export function normalizePveApiTokenValue(token: string): string {
  const trimmed = token.trim().replace(/^PVEAPIToken=/i, '').replace(/^PBSAPIToken=/i, '');
  const eqIdx = trimmed.lastIndexOf('=');
  const colonIdx = trimmed.lastIndexOf(':');
  const sepIdx = eqIdx >= 0 ? eqIdx : colonIdx;
  if (sepIdx <= 0) return trimmed;
  const id = trimmed.slice(0, sepIdx);
  const secret = trimmed.slice(sepIdx + 1);
  return `${id}=${secret}`;
}

export function formatPveAuthorizationHeader(apiToken: string): string {
  return `PVEAPIToken=${normalizePveApiTokenValue(apiToken)}`;
}

export function isLikelyPveBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return url.port === '8006' || /:8006(?:\/|$)/.test(baseUrl);
  } catch {
    return /:8006(?:\/|$)/.test(baseUrl);
  }
}

export function isLikelyPbsBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return url.port === '8007' || /:8007(?:\/|$)/.test(baseUrl);
  } catch {
    return /:8007(?:\/|$)/.test(baseUrl);
  }
}

export function formatProxmoxAuthError(message: string, product: 'pbs' | 'pve' = 'pbs'): string {
  const normalized = message.toLowerCase();
  const authHint =
    product === 'pve'
      ? 'Formato correcto: PVEAPIToken=root@pam!token=secret (igual entre ID e secret).'
      : 'Formato correcto: PBSAPIToken=root@pam!token:secret (dois pontos entre ID e secret).';
  const aclHint =
    product === 'pve'
      ? 'No PVE: Datacenter → Permissions → Add → Path /, API Token root@pam!SEU_TOKEN, Role conforme necessidade, Propagate Yes.'
      : 'No PBS: Configuration → Access Control → Permissions → Add → Path / ou /datastore/NOME, API Token root@pam!SEU_TOKEN, Role Admin ou DatastoreAudit, Propagate Yes.';

  if (normalized.includes('no ticket')) {
    return [
      'Este servidor parece ser Proxmox VE (PVE), não Proxmox Backup Server (PBS).',
      'Remova-o em Configuração (PBS) e adicione-o no separador PVE.',
      'PVE usa porta 8006 e PVEAPIToken=root@pam!token=secret (igual entre ID e secret).',
    ].join(' ');
  }
  if (normalized.includes('401') || normalized.includes('authentication failed')) {
    return [
      'Autenticação recusada pelo servidor.',
      'Confirme Token ID + Secret e permissões ACL.',
      authHint,
    ].join(' ');
  }
  if (normalized.includes('403') || normalized.includes('permission') || normalized.includes('forbidden')) {
    return ['Token válido mas sem permissões.', aclHint].join(' ');
  }
  if (
    normalized.includes('certificate') ||
    normalized.includes('self signed') ||
    normalized.includes('ssl não confiável')
  ) {
    return 'Erro de certificado SSL — desactive «Verificar certificado SSL» se usar HTTPS interno com IP.';
  }
  return message;
}

export function formatVirtualizationBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export function formatVirtualizationRatio(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return '—';
  return `${ratio.toFixed(1)}x`;
}

export function formatVirtualizationPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

export function getVirtualizationBackupStatusLabel(status: VirtualizationBackupStatus): string {
  switch (status) {
    case 'OK':
      return 'OK';
    case 'FAILED':
      return 'Falhou';
    case 'RUNNING':
      return 'A correr';
    default:
      return 'Desconhecido';
  }
}

export function virtualizationBackupStatusClass(status: VirtualizationBackupStatus): string {
  switch (status) {
    case 'OK':
      return 'text-emerald-700 font-semibold';
    case 'FAILED':
      return 'text-red-700 font-semibold';
    case 'RUNNING':
      return 'text-blue-700 font-semibold';
    default:
      return 'text-slate-600';
  }
}

export const VIRTUALIZATION_ALERT_LEVELS = [
  'info',
  'notice',
  'warning',
  'high',
  'critical',
  'security',
] as const;
export type VirtualizationAlertLevel = (typeof VIRTUALIZATION_ALERT_LEVELS)[number];

export const VIRTUALIZATION_ALERT_STATUSES = [
  'open',
  'acknowledged',
  'silenced',
  'resolved',
] as const;
export type VirtualizationAlertStatus = (typeof VIRTUALIZATION_ALERT_STATUSES)[number];

export const VIRTUALIZATION_ALERT_KINDS = [
  'server_unreachable',
  'node_offline',
  'node_cpu_high',
  'node_ram_high',
  'storage_unavailable',
  'storage_usage',
  'backup_failed',
  'backup_stale',
  'vm_unexpected_stop',
] as const;
export type VirtualizationAlertKind = (typeof VIRTUALIZATION_ALERT_KINDS)[number];

export const VIRTUALIZATION_ALERT_LEVEL_RANK: Record<VirtualizationAlertLevel, number> = {
  info: 0,
  notice: 1,
  warning: 2,
  high: 3,
  critical: 4,
  security: 5,
};

export const VIRTUALIZATION_ALERT_COOLDOWN_MINUTES: Record<VirtualizationAlertLevel, number> = {
  info: 1440,
  notice: 720,
  warning: 240,
  high: 60,
  critical: 30,
  security: 15,
};

export interface VirtualizationAlertIncidentPublic {
  id: string;
  fingerprint: string;
  kind: VirtualizationAlertKind;
  level: VirtualizationAlertLevel;
  status: VirtualizationAlertStatus;
  title: string;
  message: string;
  sourceType: 'pve' | 'pbs' | 'app';
  sourceId: string | null;
  sourceLabel: string;
  metricValue: number | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastNotifiedAt: string | null;
  acknowledgedAt: string | null;
  silencedUntil: string | null;
  resolvedAt: string | null;
}

export interface VirtualizationAlertSummary {
  openCount: number;
  critical: number;
  high: number;
  warning: number;
  security: number;
  worstLevel: VirtualizationAlertLevel | null;
}

export function getVirtualizationAlertLevelLabel(level: VirtualizationAlertLevel): string {
  switch (level) {
    case 'info':
      return 'Info';
    case 'notice':
      return 'Notice';
    case 'warning':
      return 'Warning';
    case 'high':
      return 'High';
    case 'critical':
      return 'Critical';
    case 'security':
      return 'Security';
  }
}

export function getVirtualizationAlertKindLabel(kind: VirtualizationAlertKind): string {
  switch (kind) {
    case 'server_unreachable':
      return 'Servidor inacessível';
    case 'node_offline':
      return 'Node offline';
    case 'node_cpu_high':
      return 'CPU elevado';
    case 'node_ram_high':
      return 'RAM elevada';
    case 'storage_unavailable':
      return 'Storage indisponível';
    case 'storage_usage':
      return 'Storage cheio';
    case 'backup_failed':
      return 'Backup falhou';
    case 'backup_stale':
      return 'Backup atrasado';
    case 'vm_unexpected_stop':
      return 'VM parada inesperadamente';
  }
}

export function virtualizationAlertLevelClass(level: VirtualizationAlertLevel): string {
  switch (level) {
    case 'info':
      return 'bg-emerald-100 text-emerald-800';
    case 'notice':
      return 'bg-blue-100 text-blue-800';
    case 'warning':
      return 'bg-amber-100 text-amber-900';
    case 'high':
      return 'bg-orange-100 text-orange-900';
    case 'critical':
      return 'bg-red-100 text-red-800';
    case 'security':
      return 'bg-violet-100 text-violet-900';
  }
}

export function virtualizationAlertLevelDotClass(level: VirtualizationAlertLevel): string {
  switch (level) {
    case 'info':
      return 'bg-emerald-500';
    case 'notice':
      return 'bg-blue-500';
    case 'warning':
      return 'bg-amber-400';
    case 'high':
      return 'bg-orange-500';
    case 'critical':
      return 'bg-red-600';
    case 'security':
      return 'bg-violet-600';
  }
}
