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
  cpu?: number;
  mem?: number;
  maxmem?: number;
}

export interface PveConsoleProxyResult {
  port: string | number;
  ticket: string;
  user?: string;
  cert?: string;
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
  init?: { method?: string; body?: string; contentType?: string }
): Promise<T> {
  const base = normalizeBaseUrl(config.baseUrl);
  const url = new URL(`${base}/api2/json${path.startsWith('/') ? path : `/${path}`}`);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  const method = init?.method ?? 'GET';
  const requestBody = init?.body;

  const body = await new Promise<string>((resolve, reject) => {
    const headers: Record<string, string> = {
      Authorization: formatPveAuthorizationHeader(config.apiToken),
      Accept: 'application/json',
    };
    if (requestBody != null) {
      headers['Content-Type'] = init?.contentType ?? 'application/x-www-form-urlencoded';
      headers['Content-Length'] = String(Buffer.byteLength(requestBody));
    }

    const req = transport.request(
      url,
      {
        method,
        headers,
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
            resolve(JSON.stringify(payload.data ?? null));
            return;
          }

          resolve(text || 'null');
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
    if (requestBody != null) {
      req.write(requestBody);
    }
    req.end();
  });

  return JSON.parse(body) as T;
}

export function pveNormalizeBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl);
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

function guestApiPath(guestType: 'qemu' | 'lxc', node: string, vmid: number, suffix: string): string {
  return `/nodes/${encodeURIComponent(node)}/${guestType}/${vmid}${suffix}`;
}

export async function pveCreateVncProxy(
  config: PveClientConfig,
  node: string,
  guestType: 'qemu' | 'lxc',
  vmid: number
): Promise<PveConsoleProxyResult> {
  const data = await pveRequest<PveConsoleProxyResult>(
    config,
    guestApiPath(guestType, node, vmid, '/vncproxy'),
    { method: 'POST', body: 'websocket=1' }
  );
  if (!data?.ticket || data.port == null) {
    throw new Error('PVE não devolveu ticket de consola VNC');
  }
  return data;
}

export async function pveCreateTermProxy(
  config: PveClientConfig,
  node: string,
  guestType: 'qemu' | 'lxc',
  vmid: number
): Promise<PveConsoleProxyResult> {
  const data = await pveRequest<PveConsoleProxyResult>(
    config,
    guestApiPath(guestType, node, vmid, '/termproxy'),
    { method: 'POST', body: '' }
  );
  if (!data?.ticket || data.port == null) {
    throw new Error('PVE não devolveu ticket de terminal');
  }
  return data;
}

export async function pveGuestPower(
  config: PveClientConfig,
  node: string,
  guestType: 'qemu' | 'lxc',
  vmid: number,
  action: 'start' | 'stop'
): Promise<void> {
  await pveRequest<unknown>(
    config,
    guestApiPath(guestType, node, vmid, `/status/${action}`),
    { method: 'POST', body: '' }
  );
}

export async function pveGuestAgentNetworkInterfaces(
  config: PveClientConfig,
  node: string,
  vmid: number
): Promise<unknown> {
  return pveRequest<unknown>(
    config,
    guestApiPath('qemu', node, vmid, '/agent/network-get-interfaces')
  );
}

export async function pveLxcInterfaces(
  config: PveClientConfig,
  node: string,
  vmid: number
): Promise<unknown> {
  return pveRequest<unknown>(config, guestApiPath('lxc', node, vmid, '/interfaces'));
}

export async function pveLxcConfig(
  config: PveClientConfig,
  node: string,
  vmid: number
): Promise<Record<string, string>> {
  const data = await pveRequest<Record<string, string>>(
    config,
    guestApiPath('lxc', node, vmid, '/config')
  );
  return data ?? {};
}

export function buildPveConsoleWebsocketUrl(
  config: PveClientConfig,
  node: string,
  guestType: 'qemu' | 'lxc',
  vmid: number,
  port: string | number,
  ticket: string
): string {
  const base = new URL(normalizeBaseUrl(config.baseUrl));
  const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = `/api2/json/nodes/${encodeURIComponent(node)}/${guestType}/${vmid}/vncwebsocket`;
  const url = new URL(`${wsProtocol}//${base.host}${path}`);
  url.searchParams.set('port', String(port));
  url.searchParams.set('vncticket', ticket);
  return url.toString();
}
