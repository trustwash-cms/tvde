import { getWebConfig, API_PATHS, STORAGE_KEYS } from '@tvde/shared';
import { formatValidationDetails, formatZodErrorJson } from '@/lib/validation-errors';

const { apiUrl, showDemoHint, appName } = getWebConfig();

/** Acesso estático — Next.js só faz inline de process.env.NEXT_PUBLIC_* directo */
export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export { showDemoHint, appName };

export function getApiUrl(): string {
  if (!apiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not configured');
  }
  return apiUrl.replace(/\/$/, '');
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  details?: unknown;
  statusCode?: number;
}

function looksLikeHtmlBody(raw: string): boolean {
  const head = raw.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<html');
}

/** Evita mostrar páginas HTML (Cloudflare, proxy, etc.) como mensagem de erro. */
export function sanitizeApiRawError(raw: string, status: number): string {
  if (status === 429) {
    return 'Demasiados pedidos — aguarde alguns segundos e tente novamente.';
  }
  if (looksLikeHtmlBody(raw)) {
    return `Resposta inválida do servidor (HTTP ${status}). Verifique se a API está acessível.`;
  }
  return raw.slice(0, 300) || `Resposta inválida (HTTP ${status})`;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
  retried = false
): Promise<ApiResponse<T>> {
  const method = (options.method ?? 'GET').toUpperCase();
  let body = options.body;

  if (['POST', 'PUT', 'PATCH'].includes(method) && (body === undefined || body === null || body === '')) {
    body = '{}';
  }

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (body !== undefined && body !== null && body !== '') {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  const accessToken = token ?? getStoredToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${getApiUrl()}${path}`, { ...options, method, body, headers });
  const raw = await res.text();

  let parsed: ApiResponse<T> & { statusCode?: number };
  if (!raw.trim()) {
    parsed = res.ok ? { success: true } : { success: false, error: `Erro HTTP ${res.status}` };
  } else {
    try {
      parsed = JSON.parse(raw) as ApiResponse<T> & { statusCode?: number };
    } catch {
      return {
        success: false,
        error: sanitizeApiRawError(raw, res.status),
        statusCode: res.status,
      };
    }
  }

  if (!parsed.statusCode && !res.ok) {
    parsed.statusCode = res.status;
  }

  if (
    !retried &&
    (parsed.statusCode === 401 || res.status === 401) &&
    path !== API_PATHS.auth.refresh &&
    getStoredRefreshToken()
  ) {
    const refreshed = await refreshStoredAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, options, refreshed, true);
    }
  }

  return parsed;
}

let refreshInFlight: Promise<string | null> | null = null;

/** Renova o access token com o refresh token guardado no browser. */
export async function refreshStoredAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${getApiUrl()}${API_PATHS.auth.refresh}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const raw = await res.text();
    if (!raw.trim() || !res.ok) {
      clearTokens();
      return null;
    }
    const parsed = JSON.parse(raw) as ApiResponse<{ accessToken: string }>;
    if (parsed.success && parsed.data?.accessToken) {
      storeTokens(parsed.data.accessToken, refreshToken);
      return parsed.data.accessToken;
    }
  } catch {
    /* ignore */
  }
  clearTokens();
  return null;
}

/** Mensagem legível a partir de respostas API ou erros Fastify/Zod. */
export function getApiErrorMessage(
  res: ApiResponse & { statusCode?: number; message?: string; error_description?: string; details?: unknown }
): string {
  const fromDetails = formatValidationDetails(res.details);
  if (fromDetails) return fromDetails;

  if (res.error) {
    const fromZodJson = formatZodErrorJson(res.error);
    if (fromZodJson) return fromZodJson;
  }

  if (res.error_description) return res.error_description;
  if (res.statusCode === 403 || res.error === 'Forbidden') {
    return res.message && res.message !== 'Forbidden'
      ? res.message
      : 'Sem permissão para esta acção';
  }
  if (res.success === false && res.error && res.error !== 'Forbidden') {
    if (looksLikeHtmlBody(res.error)) {
      return res.statusCode === 429
        ? 'Demasiados pedidos — aguarde alguns segundos e tente novamente.'
        : 'Erro de ligação à API — resposta inválida do servidor.';
    }
    return res.error;
  }
  if (res.message && res.message !== 'Forbidden' && !res.message.includes('Invalid `')) {
    return res.message;
  }
  if (res.message?.includes('Unique constraint')) {
    return 'Registo duplicado — slug ou email já existe';
  }
  if (res.error && res.error !== 'Internal Server Error' && res.error !== 'Forbidden') {
    return res.error;
  }
  return 'Erro inesperado — tenta novamente';
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEYS.accessToken);
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEYS.refreshToken);
}

export function storeTokens(access: string, refresh?: string) {
  localStorage.setItem(STORAGE_KEYS.accessToken, access);
  if (refresh) localStorage.setItem(STORAGE_KEYS.refreshToken, refresh);
}

export function clearTokens() {
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
}

export { API_PATHS, STORAGE_KEYS };
