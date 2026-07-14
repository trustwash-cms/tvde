import type { BoltCompany } from './types';

export function coerceCompanyId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
  }
  return null;
}

export function normalizeCompany(row: unknown): BoltCompany | null {
  if (typeof row === 'number' || typeof row === 'string') {
    const company_id = coerceCompanyId(row);
    return company_id != null ? { company_id } : null;
  }

  if (typeof row !== 'object' || row === null) return null;

  const obj = row as Record<string, unknown>;
  const company_id = coerceCompanyId(obj.company_id ?? obj.companyId ?? obj.id);
  if (company_id == null) return null;

  const name = [obj.company_name, obj.companyName, obj.name].find((v) => typeof v === 'string');
  return {
    company_id,
    company_name: name as string | undefined,
  };
}

function dedupeCompanies(companies: BoltCompany[]): BoltCompany[] {
  const seen = new Set<number>();
  const out: BoltCompany[] = [];
  for (const company of companies) {
    if (seen.has(company.company_id)) continue;
    seen.add(company.company_id);
    out.push(company);
  }
  return out;
}

export function parseCompaniesPayload(data: unknown): BoltCompany[] {
  if (data == null) return [];

  const candidates: unknown[] = [];

  if (Array.isArray(data)) {
    candidates.push(data);
  } else if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    candidates.push(
      obj.companies,
      obj.data,
      (obj.data as Record<string, unknown> | undefined)?.companies,
      (obj.data as Record<string, unknown> | undefined)?.company_ids,
      obj.result,
      (obj.result as Record<string, unknown> | undefined)?.companies,
      (obj.result as Record<string, unknown> | undefined)?.company_ids,
      obj.items,
      obj.company_ids,
      obj.companyIds
    );

    const single = normalizeCompany(obj);
    if (single) candidates.push([single]);
  }

  const parsed: BoltCompany[] = [];
  for (const candidate of candidates) {
    if (candidate == null) continue;

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const company = normalizeCompany(item);
        if (company) parsed.push(company);
      }
      continue;
    }

    if (typeof candidate === 'object' && candidate !== null) {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.company_ids)) {
        for (const item of nested.company_ids) {
          const company = normalizeCompany(item);
          if (company) parsed.push(company);
        }
        continue;
      }
    }

    const company = normalizeCompany(candidate);
    if (company) parsed.push(company);
  }

  return dedupeCompanies(parsed);
}

export function extractCompaniesFromAccessToken(token: string): BoltCompany[] {
  const parts = token.split('.');
  if (parts.length < 2) return [];

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as Record<string, unknown>;

    const ids: unknown[] = [
      payload.company_id,
      payload.companyId,
      payload.fleet_company_id,
      payload.fleetCompanyId,
    ];

    if (Array.isArray(payload.company_ids)) ids.push(...payload.company_ids);
    if (Array.isArray(payload.companyIds)) ids.push(...payload.companyIds);
    if (Array.isArray(payload.fleet_company_ids)) ids.push(...payload.fleet_company_ids);

    const auth = payload.authorization;
    if (auth && typeof auth === 'object') {
      const authObj = auth as Record<string, unknown>;
      ids.push(authObj.company_id, authObj.companyId);
      if (Array.isArray(authObj.company_ids)) ids.push(...authObj.company_ids);
    }

    const resourceAccess = payload.resource_access;
    if (resourceAccess && typeof resourceAccess === 'object') {
      for (const value of Object.values(resourceAccess as Record<string, unknown>)) {
        if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).roles)) {
          ids.push(...((value as Record<string, unknown>).roles as unknown[]));
        }
      }
    }

    return dedupeCompanies(
      ids
        .map((id) => normalizeCompany(id))
        .filter((company): company is BoltCompany => company !== null)
    );
  } catch {
    return [];
  }
}
