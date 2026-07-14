import Redis from 'ioredis';
import { env } from '../config/env';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redis;
}

export async function disconnectRedis(): Promise<void> {
  if (!redis) return;
  const client = redis;
  redis = null;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

export const FAIL2BAN_MAX = 5;
export const FAIL2BAN_TTL_SECONDS = 15 * 60;

const FAIL2BAN_KEY_PREFIX = 'fail2ban:';

export interface Fail2banEntry {
  ip: string;
  attempts: number;
  blocked: boolean;
  ttlSeconds: number;
}

export async function checkFail2ban(ip: string): Promise<{ blocked: boolean; attempts: number }> {
  try {
    const r = getRedis();
    const key = `fail2ban:${ip}`;
    const attempts = parseInt((await r.get(key)) ?? '0', 10);
    return { blocked: attempts >= FAIL2BAN_MAX, attempts };
  } catch {
    return { blocked: false, attempts: 0 };
  }
}

export async function recordFailedLogin(ip: string): Promise<number> {
  try {
    const r = getRedis();
    const key = `fail2ban:${ip}`;
    const attempts = await r.incr(key);
    if (attempts === 1) await r.expire(key, FAIL2BAN_TTL_SECONDS);
    return attempts;
  } catch {
    return 0;
  }
}

export async function clearFail2ban(ip: string): Promise<void> {
  try {
    await getRedis().del(`${FAIL2BAN_KEY_PREFIX}${ip}`);
  } catch {
    /* Redis indisponível — ignorar */
  }
}

/** IPs com contador de tentativas falhadas activo no Redis (MASTER). */
export async function listFail2banEntries(): Promise<Fail2banEntry[]> {
  const r = getRedis();
  const entries: Fail2banEntry[] = [];
  let cursor = '0';

  do {
    const [nextCursor, keys] = await r.scan(cursor, 'MATCH', `${FAIL2BAN_KEY_PREFIX}*`, 'COUNT', 100);
    cursor = nextCursor;

    for (const key of keys) {
      const ip = key.slice(FAIL2BAN_KEY_PREFIX.length);
      if (!ip) continue;

      const [rawAttempts, ttl] = await Promise.all([r.get(key), r.ttl(key)]);
      const attempts = parseInt(rawAttempts ?? '0', 10);

      entries.push({
        ip,
        attempts,
        blocked: attempts >= FAIL2BAN_MAX,
        ttlSeconds: ttl > 0 ? ttl : 0,
      });
    }
  } while (cursor !== '0');

  return entries.sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
    return b.attempts - a.attempts;
  });
}

export async function blacklistToken(tokenHash: string, ttlSeconds: number): Promise<void> {
  await getRedis().setex(`blacklist:${tokenHash}`, ttlSeconds, '1');
}

export async function isTokenBlacklisted(tokenHash: string): Promise<boolean> {
  return (await getRedis().exists(`blacklist:${tokenHash}`)) === 1;
}
