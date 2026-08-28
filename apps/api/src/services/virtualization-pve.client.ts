import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { formatPveAuthorizationHeader } from '@tvde/shared';
import { applyHttpRequestTimeout } from './virtualization-http.util';

export interface PveClientConfig {
  baseUrl: string;
  apiToken: string;
  verifySsl: boolean;
}

export interface PveNode {
  node: string;
  status?: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  uptime?: number;
  type?: string;
}

export interface PveClusterResource {
  id?: string;
  type?: string;
  node?: string;
  name?: string;
  status?: string;
  vmid?: number;
  storage?: string;
  maxdisk?: number;
  disk?: number;
  plugintype?: string;
  content?: string;
  shared?: number;
}

export interface PveStorageResource {
  storage: string;
  node?: string;
  maxdisk: number;
  disk: number;
  status?: string;
  plugintype?: string;
  content?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

async function pveRequest<T>(
  config: PveClientConfig,
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
          Authorization: formatPveAuthorizationHeader(config.apiToken),
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
            reject(new Error(`PVE ${status}: ${detail}`));
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
    applyHttpRequestTimeout(req, 'PVE');
    req.end();
  });

  return JSON.parse(body) as T;
}

export async function pveTestConnection(
  config: PveClientConfig
): Promise<{ version: string; nodes: string[] }> {
  const data = await pveRequest<{ version?: string; release?: string }>(config, '/version');
  const version = data.version ?? data.release ?? 'desconhecida';
  const nodes = await pveListNodeNames(config);
  return { version, nodes };
}

export async function pveListNodes(config: PveClientConfig): Promise<PveNode[]> {
  const data = await pveRequest<PveNode[] | Record<string, PveNode>>(config, '/nodes');
  if (Array.isArray(data)) return data;
  return Object.values(data ?? {});
}

export async function pveListNodeNames(config: PveClientConfig): Promise<string[]> {
  const nodes = await pveListNodes(config);
  return nodes
    .map((node) => node.node)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

export async function pveListClusterResources(config: PveClientConfig): Promise<PveClusterResource[]> {
  const data = await pveRequest<PveClusterResource[] | Record<string, PveClusterResource>>(
    config,
    '/cluster/resources'
  );
  if (Array.isArray(data)) return data;
  return Object.values(data ?? {});
}

export async function pveListStorageResources(config: PveClientConfig): Promise<PveStorageResource[]> {
  const resources = await pveListClusterResources(config);
  return resources
    .filter(
      (resource): resource is PveClusterResource & { storage: string } =>
        resource.type === 'storage' && typeof resource.storage === 'string' && resource.storage.length > 0
    )
    .map((resource) => ({
      storage: resource.storage,
      node: resource.node,
      maxdisk: resource.maxdisk ?? 0,
      disk: resource.disk ?? 0,
      status: resource.status,
      plugintype: resource.plugintype,
      content: resource.content,
    }));
}
