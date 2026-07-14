/** Configuração Moloni — ver docs/MOLONI.md */

export const MOLONI_API_BASE = 'https://api.moloni.pt/v1';

export interface MoloniOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface MoloniTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MoloniConnection extends MoloniOAuthConfig {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt?: Date;
  companyId: number;
  documentSetId?: number;
}

export function buildAuthorizeUrl(config: Pick<MoloniOAuthConfig, 'clientId' | 'redirectUri'>): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
  });
  return `${MOLONI_API_BASE}/authorize/?${params.toString()}`;
}
