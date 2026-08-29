import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { formatPbsAuthorizationHeader } from '@tvde/shared';
import { applyHttpRequestTimeout } from './virtualization-http.util';

export interface PbsClientConfig {
  baseUrl: string;
  apiToken: string;
  verifySsl: boolean;
}

export interface PbsDatastoreStatus {
  store: string;
  total: number;
  used: number;
  avail: number;
}

export interface PbsDatastoreGcStatus {
  'disk-bytes'?: number;
  'disk-chunks'?: number;
  'index-data-bytes'?: number;
  'index-file-count'?: number;
  'pending-bytes'?: number;
  'pending-chunks'?: number;
  'removed-bad'?: number;
  'removed-bytes'?: number;
  'removed-chunks'?: number;
  'still-bad'?: number;
  upid?: string | null;
}

export interface PbsDatastoreUsageEntry {
  store: string;
  total?: number;
  used?: number;
  avail?: number;
  'backend-type'?: string;
  'gc-status'?: PbsDatastoreGcStatus;
  deduplication?: number;
  'deduplication-factor'?: number;
  'unique-bytes'?: number;
  'disk-bytes'?: number;
}

export interface PbsGroup {
  'backup-id'?: string;
  'backup-type'?: string;
  'group-id'?: string;
  comment?: string;
}

export interface PbsSnapshot {
  'backup-id'?: string;
  'backup-time'?: number;
  'backup-type'?: string;
  comment?: string;
  protected?: boolean | number;
  size?: number;
}

export interface PbsTask {
  upid?: string;
  type?: string;
  worker_type?: string;
  id?: string;
  user?: string;
  status?: string;
  starttime?: number;
  endtime?: number;
  duration?: number;
  exitstatus?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

async function pbsRequest<T>(
  config: PbsClientConfig,
  path: string,
  init?: { method?: string }
): Promise<T> {
  const base = normalizeBaseUrl(config.baseUrl);
  const url = new URL(`${base}/api2/json${path.startsWith('/') ? path : `/${path}`}`);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  const body = await new Promise<string>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: formatPbsAuthorizationHeader(config.apiToken),
          Accept: 'application/json',
        },
        ...(isHttps && !config.verifySsl ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          let payload: { data?: T; errors?: unknown } | null = null;
          try {
            payload = text ? (JSON.parse(text) as { data?: T; errors?: unknown }) : null;
          } catch {
            payload = null;
          }

          if (status < 200 || status >= 300) {
            const detail =
              payload?.errors != null ? JSON.stringify(payload.errors) : text || res.statusMessage;
            reject(new Error(`PBS ${status}: ${detail}`));
            return;
          }

          if (payload && 'data' in payload) {
            resolve(JSON.stringify(payload.data));
            return;
          }

          resolve(text || '{}');
        });
      }
    );

    req.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('self-signed certificate') ||
        message.includes('SELF_SIGNED_CERT') ||
        message.includes('unable to verify the first certificate')
      ) {
        reject(
          new Error(
            'Certificado SSL não confiável — desactive «Verificar certificado SSL» para IPs internos com HTTPS auto-assinado.'
          )
        );
        return;
      }
      reject(err);
    });
    applyHttpRequestTimeout(req, 'PBS');
    req.end();
  });

  return JSON.parse(body) as T;
}

export async function pbsListDatastoreNames(config: PbsClientConfig): Promise<string[]> {
  const data = await pbsRequest<
    string[] | Array<{ store?: string }> | Record<string, unknown>
  >(config, '/admin/datastore');
  if (Array.isArray(data)) {
    return data
      .map((entry) => (typeof entry === 'string' ? entry : entry?.store))
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  }
  return Object.keys(data ?? {});
}

export async function pbsTestConnection(
  config: PbsClientConfig
): Promise<{ version: string; datastores: string[] }> {
  const data = await pbsRequest<{ version?: string; release?: string }>(config, '/version');
  const version = data.version ?? data.release ?? 'desconhecida';
  let datastores: string[] = [];
  try {
    datastores = await pbsListDatastoreNames(config);
  } catch {
    datastores = [];
  }
  return { version, datastores };
}

export async function pbsGetDatastoreStatus(
  config: PbsClientConfig,
  store: string
): Promise<PbsDatastoreStatus> {
  return pbsRequest<PbsDatastoreStatus>(
    config,
    `/admin/datastore/${encodeURIComponent(store)}/status`
  );
}

export async function pbsListDatastoreUsage(
  config: PbsClientConfig
): Promise<PbsDatastoreUsageEntry[]> {
  const data = await pbsRequest<PbsDatastoreUsageEntry[] | Record<string, PbsDatastoreUsageEntry>>(
    config,
    '/status/datastore-usage'
  );
  if (Array.isArray(data)) return data;
  return Object.values(data ?? {});
}

export async function pbsGetDatastoreUsage(
  config: PbsClientConfig,
  store: string
): Promise<PbsDatastoreUsageEntry | null> {
  const entries = await pbsListDatastoreUsage(config);
  return entries.find((entry) => entry.store === store) ?? null;
}

export async function pbsListGroups(
  config: PbsClientConfig,
  store: string
): Promise<PbsGroup[]> {
  const data = await pbsRequest<PbsGroup[] | Record<string, PbsGroup>>(
    config,
    `/admin/datastore/${encodeURIComponent(store)}/groups`
  );
  if (Array.isArray(data)) return data;
  return Object.values(data ?? {});
}

export async function pbsListSnapshots(
  config: PbsClientConfig,
  store: string
): Promise<PbsSnapshot[]> {
  const data = await pbsRequest<PbsSnapshot[] | Record<string, PbsSnapshot>>(
    config,
    `/admin/datastore/${encodeURIComponent(store)}/snapshots`
  );
  if (Array.isArray(data)) return data;
  return Object.values(data ?? {});
}

export async function pbsListTasks(config: PbsClientConfig): Promise<PbsTask[]> {
  const data = await pbsRequest<PbsTask[] | Record<string, PbsTask>>(
    config,
    '/nodes/localhost/tasks'
  );
  if (Array.isArray(data)) return data;
  return Object.values(data ?? {});
}

export function extractDeduplicationRatio(usage: PbsDatastoreUsageEntry | null): number | null {
  if (!usage) return null;

  const direct = usage.deduplication ?? usage['deduplication-factor'];
  if (typeof direct === 'number' && direct > 0) return direct;

  const unique = usage['unique-bytes'];
  const disk = usage['disk-bytes'] ?? usage['gc-status']?.['disk-bytes'];
  if (typeof unique === 'number' && typeof disk === 'number' && unique > 0) {
    return disk / unique;
  }

  if (typeof disk === 'number' && disk > 0 && typeof usage.used === 'number' && usage.used > disk) {
    return usage.used / disk;
  }

  return null;
}

export function parseBackupGuestFromTask(task: PbsTask): {
  kind: 'vm' | 'ct' | 'unknown';
  vmid: string | null;
  label: string;
} {
  const raw = `${task.id ?? ''} ${task.upid ?? ''}`;
  const decoded = raw.replace(/\\x3a/gi, ':').replace(/%3[Aa]/g, ':');
  const match = decoded.match(/\b(vm|ct)[_:\-/]?(\d{1,8})\b/i);
  if (match) {
    const kind = match[1].toLowerCase() as 'vm' | 'ct';
    return {
      kind,
      vmid: match[2],
      label: `${kind.toUpperCase()} ${match[2]}`,
    };
  }
  return { kind: 'unknown', vmid: null, label: '—' };
}

export function parseBackupNameFromTask(task: PbsTask): string {
  const guest = parseBackupGuestFromTask(task);
  if (guest.kind !== 'unknown') return guest.label;

  const raw = (task.id ?? '').replace(/\\x3a/gi, ':').replace(/%3[Aa]/g, ':');
  const parts = raw.split('/');
  const last = parts[parts.length - 1] ?? raw;
  if (last && last !== raw) return last;
  return raw.replace(/^backup:/, '') || '—';
}

export function parseBackupIdFromTask(task: PbsTask): string {
  const guest = parseBackupGuestFromTask(task);
  if (guest.vmid) return guest.vmid;

  const raw = task.id ?? task.upid ?? 'unknown';
  const match = raw.match(/\/(\d+)(?:\/|$)/);
  if (match?.[1]) return match[1];
  return raw;
}

export function mapTaskStatus(status: string | undefined): 'OK' | 'FAILED' | 'RUNNING' | 'UNKNOWN' {
  const normalized = (status ?? '').toUpperCase();
  if (normalized === 'OK' || normalized === 'WARNINGS') return 'OK';
  if (normalized === 'RUNNING' || normalized === 'ACTIVE') return 'RUNNING';
  if (
    normalized === 'ERROR' ||
    normalized === 'FAILED' ||
    normalized.includes('FAIL') ||
    normalized.includes('ERR')
  ) {
    return 'FAILED';
  }
  return 'UNKNOWN';
}

export function isBackupTask(task: PbsTask): boolean {
  const type = `${task.type ?? ''} ${task.worker_type ?? ''} ${task.id ?? ''}`.toLowerCase();
  return type.includes('backup');
}
