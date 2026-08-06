/**
 * Public egress IP of this API process (outbound to the internet).
 * Used for WHMCS API IP Access Restriction guidance.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // ~1h
const FETCH_TIMEOUT_MS = 4_000;

const LOOKUP_URLS = [
  'https://api.ipify.org?format=json',
  'https://api64.ipify.org?format=json',
] as const;

let cached: { ip: string; fetchedAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

function parseIpFromBody(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed) as { ip?: unknown };
    if (typeof json.ip === 'string' && isPlausibleIpv4OrV6(json.ip)) {
      return json.ip.trim();
    }
  } catch {
    /* plain text body */
  }
  const plain = trimmed.split(/\s/)[0]?.trim() ?? '';
  return isPlausibleIpv4OrV6(plain) ? plain : null;
}

function isPlausibleIpv4OrV6(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return true;
  // loose IPv6 check
  if (value.includes(':') && /^[0-9a-fA-F:]+$/.test(value) && value.length >= 3) return true;
  return false;
}

async function fetchEgressIpOnce(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return parseIpFromBody(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the server's public egress IP, or null if lookup fails.
 * Result is cached for ~1 hour.
 */
export async function getEgressPublicIp(): Promise<string | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.ip;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    for (const url of LOOKUP_URLS) {
      const ip = await fetchEgressIpOnce(url);
      if (ip) {
        cached = { ip, fetchedAt: Date.now() };
        return ip;
      }
    }
    return cached?.ip ?? null;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** Test helper / cache bust (not used in production paths). */
export function clearEgressIpCache(): void {
  cached = null;
}
