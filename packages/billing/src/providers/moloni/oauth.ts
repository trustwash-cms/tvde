import { MOLONI_API_BASE, type MoloniOAuthConfig, type MoloniTokenPair } from './config';

interface GrantResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

async function grantRequest(params: Record<string, string>): Promise<MoloniTokenPair> {
  const url = `${MOLONI_API_BASE}/grant/?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { method: 'GET' });
  const data = (await res.json()) as GrantResponse;

  if (!res.ok || data.error || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? `Moloni OAuth falhou (HTTP ${res.status})`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/** Troca authorization_code por tokens — [Moloni Autenticação](https://www.moloni.pt/dev/autenticacao/) */
export async function exchangeAuthorizationCode(
  config: MoloniOAuthConfig,
  code: string
): Promise<MoloniTokenPair> {
  return grantRequest({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  });
}

/** Renova access_token — chamar antes de expirar */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<MoloniTokenPair> {
  return grantRequest({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
}
