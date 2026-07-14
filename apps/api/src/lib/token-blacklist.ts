import { getJwtAccessExpires, parseDurationMs } from '@tvde/shared/server';
import { hashToken } from './crypto';
import { blacklistToken, isTokenBlacklisted } from './redis';

function accessTokenTtlSeconds(rawToken: string): number {
  try {
    const payloadPart = rawToken.split('.')[1];
    if (!payloadPart) throw new Error('invalid token');
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { exp?: number };
    if (payload.exp) {
      return Math.max(payload.exp - Math.floor(Date.now() / 1000), 1);
    }
  } catch {
    // fallback below
  }
  return Math.ceil(parseDurationMs(getJwtAccessExpires()) / 1000);
}

export async function revokeAccessToken(rawToken: string): Promise<void> {
  const ttl = accessTokenTtlSeconds(rawToken);
  await blacklistToken(hashToken(rawToken), ttl);
}

export async function isAccessTokenBlacklisted(rawToken: string): Promise<boolean> {
  try {
    return await isTokenBlacklisted(hashToken(rawToken));
  } catch (err) {
    console.error('[blacklist] Redis indisponível — verificação ignorada:', err);
    return false;
  }
}
