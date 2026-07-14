import { envOr } from '@tvde/shared/server';

export interface WhatsappBridgeStatus {
  connected: boolean;
  state: 'disconnected' | 'initializing' | 'qr' | 'ready' | 'auth_failure';
  phoneNumber?: string;
  qrAvailable: boolean;
}

export interface WhatsappBridgeQr {
  qr: string | null;
  qrDataUrl: string | null;
}

function getBridgeConfig() {
  return {
    baseUrl: envOr('WHATSAPP_BRIDGE_URL', 'http://localhost:3002').replace(/\/$/, ''),
    secret: envOr('WHATSAPP_BRIDGE_SECRET', 'dev-whatsapp-bridge-secret'),
  };
}

function tenantPath(tenantId: string, suffix: string) {
  return `/tenants/${encodeURIComponent(tenantId)}${suffix}`;
}

async function bridgeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, secret } = getBridgeConfig();
  const method = (init?.method ?? 'GET').toUpperCase();
  let body = init?.body;

  if (['POST', 'PUT', 'PATCH'].includes(method) && (body === undefined || body === null || body === '')) {
    body = '{}';
  }

  const headers: Record<string, string> = {
    'X-Bridge-Secret': secret,
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (body !== undefined && body !== null && body !== '') {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  const res = await fetch(`${baseUrl}${path}`, { ...init, method, body, headers });

  const json = (await res.json()) as { success?: boolean; data?: T; error?: string };
  if (!res.ok || json.success === false) {
    throw new Error(json.error ?? `WhatsApp bridge error (${res.status})`);
  }
  return json.data as T;
}

export async function getWhatsappBridgeStatus(tenantId: string): Promise<WhatsappBridgeStatus> {
  try {
    return await bridgeFetch<WhatsappBridgeStatus>(tenantPath(tenantId, '/status'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bridge indisponível';
    if (/fetch failed|ECONNREFUSED|indisponível|Body cannot be empty/i.test(message)) {
      return {
        connected: false,
        state: 'disconnected',
        qrAvailable: false,
      };
    }
    throw err;
  }
}

export async function getWhatsappBridgeQr(tenantId: string): Promise<WhatsappBridgeQr> {
  try {
    return await bridgeFetch<WhatsappBridgeQr>(tenantPath(tenantId, '/qr'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bridge indisponível';
    if (/fetch failed|ECONNREFUSED|indisponível|bridge error/i.test(message)) {
      return { qr: null, qrDataUrl: null };
    }
    throw err;
  }
}

export async function sendWhatsappMessage(tenantId: string, to: string, body: string) {
  return sendFormattedWhatsappMessage(tenantId, to, { template: 'plain', text: body });
}

export interface WhatsappMessagePayload {
  template?: 'otp' | 'plain';
  text?: string;
  code?: string;
  appName?: string;
  link?: string;
  mediaUrl?: string;
  caption?: string;
}

export async function sendFormattedWhatsappMessage(
  tenantId: string,
  to: string,
  payload: WhatsappMessagePayload
) {
  return bridgeFetch<{
    messageId: string;
    normalizedTo?: string;
    selfSend?: boolean;
    warning?: string;
  }>(tenantPath(tenantId, '/send'), {
    method: 'POST',
    body: JSON.stringify({ to, ...payload }),
  });
}

export async function logoutWhatsappBridge(tenantId: string) {
  return bridgeFetch<{ success: boolean }>(tenantPath(tenantId, '/logout'), { method: 'POST' });
}

export async function restartWhatsappBridge(tenantId: string) {
  return bridgeFetch<{ success: boolean }>(tenantPath(tenantId, '/restart'), { method: 'POST' });
}

export async function sendOtpWhatsapp(
  tenantId: string,
  to: string,
  code: string,
  appName: string,
  link?: string
) {
  return sendFormattedWhatsappMessage(tenantId, to, {
    template: 'otp',
    code,
    appName,
    link,
  });
}
