import type {
  BoltCompany,
  BoltDriverRow,
  BoltOrderRow,
  BoltTokenResponse,
  BoltVehicleRow,
} from './types';
import {
  extractCompaniesFromAccessToken,
  parseCompaniesPayload,
} from './parse-companies';
import { unwrapBoltResponse } from './api-envelope';

const DEFAULT_TOKEN_URL = 'https://oidc.bolt.eu/token';
const DEFAULT_BASE_URL = 'https://node.bolt.eu/fleet-integration-gateway';
const DEFAULT_SCOPE = 'fleet-integration:api';

export interface BoltClientConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  baseUrl?: string;
  scope?: string;
}

export interface BoltTestConnectionOptions {
  companyId?: number;
}

export class BoltFleetClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: BoltClientConfig) {}

  async testConnection(
    options?: BoltTestConnectionOptions
  ): Promise<{ companyId: number; companies: BoltCompany[] }> {
    const token = await this.getAccessToken();
    let companies = await this.getCompanies();

    if (!companies.length) {
      companies = extractCompaniesFromAccessToken(token);
    }

    if (!companies.length && options?.companyId) {
      const valid = await this.validateCompanyAccess(options.companyId);
      if (valid) {
        companies = [{ company_id: options.companyId }];
      }
    }

    if (!companies.length) {
      throw new Error(
        options?.companyId
          ? 'Nenhuma empresa autorizada encontrada na API Bolt. Verifique o ID da empresa indicado.'
          : 'Nenhuma empresa autorizada encontrada na API Bolt. Indique o ID da empresa (Fleet Portal → definições) se souber o número.'
      );
    }

    return { companyId: companies[0].company_id, companies };
  }

  async getCompanies(): Promise<BoltCompany[]> {
    const data = await this.get<{ company_ids?: number[] }>('/fleetIntegration/v1/getCompanies');
    const ids = data.company_ids ?? [];
    if (ids.length) {
      return ids.map((company_id) => ({ company_id }));
    }
    return parseCompaniesPayload(data);
  }

  async validateCompanyAccess(companyId: number): Promise<boolean> {
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - 7 * 24 * 60 * 60;

    try {
      await this.getDrivers({ companyId, startTs, endTs, limit: 1, offset: 0 });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('NOT_AUTHORIZED') ||
        message.includes('FORBIDDEN') ||
        message.includes('401') ||
        message.includes('403')
      ) {
        return false;
      }
      return true;
    }
  }

  async getFleetOrders(input: {
    companyId: number;
    startTs: number;
    endTs: number;
    offset?: number;
    limit?: number;
  }): Promise<BoltOrderRow[]> {
    const rows: BoltOrderRow[] = [];
    let offset = input.offset ?? 0;
    const limit = input.limit ?? 1000;

    for (;;) {
      const data = await this.post<{ orders?: BoltOrderRow[]; total_orders?: number }>(
        '/fleetIntegration/v1/getFleetOrders',
        {
          company_id: input.companyId,
          company_ids: [input.companyId],
          start_ts: input.startTs,
          end_ts: input.endTs,
          time_range_filter_type: 'created',
          offset,
          limit,
        }
      );
      const batch = data.orders ?? [];
      rows.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return rows;
  }

  async getDrivers(input: {
    companyId: number;
    startTs: number;
    endTs: number;
    offset?: number;
    limit?: number;
  }): Promise<BoltDriverRow[]> {
    const rows: BoltDriverRow[] = [];
    let offset = input.offset ?? 0;
    const limit = input.limit ?? 1000;

    for (;;) {
      const data = await this.post<{ drivers?: BoltDriverRow[] }>(
        '/fleetIntegration/v1/getDrivers',
        {
          company_id: input.companyId,
          start_ts: input.startTs,
          end_ts: input.endTs,
          portal_status: 'active',
          offset,
          limit,
        }
      );
      const batch = data.drivers ?? [];
      rows.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return rows;
  }

  async getVehicles(input: {
    companyId: number;
    startTs: number;
    endTs: number;
    offset?: number;
    limit?: number;
  }): Promise<BoltVehicleRow[]> {
    const rows: BoltVehicleRow[] = [];
    let offset = input.offset ?? 0;
    const limit = input.limit ?? 100;

    for (;;) {
      const data = await this.post<{ vehicles?: BoltVehicleRow[] }>(
        '/fleetIntegration/v1/getVehicles',
        {
          company_id: input.companyId,
          start_ts: input.startTs,
          end_ts: input.endTs,
          portal_status: 'active',
          offset,
          limit,
        }
      );
      const batch = data.vehicles ?? [];
      rows.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    return rows;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    const tokenUrl = this.config.tokenUrl ?? DEFAULT_TOKEN_URL;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope ?? DEFAULT_SCOPE,
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bolt OAuth falhou (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as BoltTokenResponse;
    this.accessToken = json.access_token;
    this.tokenExpiresAt = Date.now() + (json.expires_in ?? 600) * 1000;
    return this.accessToken;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.getAccessToken();
    const baseUrl = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bolt API ${path} falhou (${res.status}): ${text.slice(0, 300)}`);
    }

    const json = await res.json();
    return unwrapBoltResponse<T>(path, json);
  }

  private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const token = await this.getAccessToken();
    const baseUrl = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bolt API ${path} falhou (${res.status}): ${text.slice(0, 300)}`);
    }

    const json = await res.json();
    return unwrapBoltResponse<T>(path, json);
  }
}

export function computeSyncWindow(lastSyncAt: Date | null | undefined, now = new Date()) {
  const endTs = Math.floor(now.getTime() / 1000);
  if (!lastSyncAt) {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { startTs: Math.floor(start.getTime() / 1000), endTs };
  }

  if (lastSyncAt.getTime() > now.getTime()) {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { startTs: Math.floor(start.getTime() / 1000), endTs };
  }

  const start = new Date(lastSyncAt.getTime() - 5 * 60_000);
  return { startTs: Math.floor(start.getTime() / 1000), endTs };
}
