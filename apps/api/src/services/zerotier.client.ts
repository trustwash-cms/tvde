import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

export type ZerotierApiMode = 'legacy' | 'central';

export interface ZerotierClientConfig {
  apiToken: string;
  apiMode: ZerotierApiMode;
  orgId?: string | null;
}

export interface ZerotierRemoteNetworkRaw {
  id: string;
  config?: {
    name?: string;
    description?: string;
  };
  totalMemberCount?: number;
  authorizedMemberCount?: number;
}

export interface ZerotierRemoteMemberRaw {
  id: string;
  nodeId?: string;
  name?: string;
  config?: {
    authorized?: boolean;
    activeBridge?: boolean;
  };
  lastOnline?: number;
}

function getBaseUrl(config: ZerotierClientConfig): string {
  if (config.apiMode === 'central') {
    return 'https://central.zerotier.com/api/v2';
  }
  return 'https://api.zerotier.com/api/v1';
}

function getAuthHeader(config: ZerotierClientConfig): string {
  if (config.apiMode === 'central') {
    return `Bearer ${config.apiToken.trim()}`;
  }
  return `token ${config.apiToken.trim()}`;
}

async function zerotierRequest<T>(
  config: ZerotierClientConfig,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const base = getBaseUrl(config);
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (config.apiMode === 'central' && config.orgId && !url.searchParams.has('org-id')) {
    url.searchParams.set('org-id', config.orgId);
  }

  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  const body = init?.body != null ? JSON.stringify(init.body) : undefined;

  const text = await new Promise<string>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: getAuthHeader(config),
          Accept: 'application/json',
          ...(body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const payload = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`ZeroTier ${status}: ${payload || res.statusMessage}`));
            return;
          }
          resolve(payload || '[]');
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

  return JSON.parse(text) as T;
}

export async function zerotierTestConnection(
  config: ZerotierClientConfig
): Promise<{ networkCount: number }> {
  const networks = await zerotierListNetworks(config);
  return { networkCount: networks.length };
}

export async function zerotierListNetworks(
  config: ZerotierClientConfig
): Promise<ZerotierRemoteNetworkRaw[]> {
  const data = await zerotierRequest<ZerotierRemoteNetworkRaw[] | { items?: ZerotierRemoteNetworkRaw[] }>(
    config,
    '/network'
  );
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}

export async function zerotierListMembers(
  config: ZerotierClientConfig,
  networkId: string
): Promise<ZerotierRemoteMemberRaw[]> {
  const data = await zerotierRequest<ZerotierRemoteMemberRaw[] | { items?: ZerotierRemoteMemberRaw[] }>(
    config,
    `/network/${encodeURIComponent(networkId)}/member`
  );
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}

export async function zerotierGetMember(
  config: ZerotierClientConfig,
  networkId: string,
  memberId: string
): Promise<ZerotierRemoteMemberRaw> {
  return zerotierRequest<ZerotierRemoteMemberRaw>(
    config,
    `/network/${encodeURIComponent(networkId)}/member/${encodeURIComponent(memberId)}`
  );
}

export async function zerotierSetMemberAuthorized(
  config: ZerotierClientConfig,
  networkId: string,
  memberId: string,
  authorized: boolean
): Promise<ZerotierRemoteMemberRaw> {
  if (config.apiMode === 'central') {
    return zerotierRequest<ZerotierRemoteMemberRaw>(
      config,
      `/network/${encodeURIComponent(networkId)}/member/${encodeURIComponent(memberId)}`,
      {
        method: 'PATCH',
        body: { config: { authorized } },
      }
    );
  }

  return zerotierRequest<ZerotierRemoteMemberRaw>(
    config,
    `/network/${encodeURIComponent(networkId)}/member/${encodeURIComponent(memberId)}`,
    {
      method: 'POST',
      body: { config: { authorized } },
    }
  );
}
