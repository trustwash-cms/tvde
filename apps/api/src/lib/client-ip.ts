import type { FastifyRequest } from 'fastify';

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
}

function isLoopbackOrPrivate(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) return true;
  return false;
}

/** IP do visitante para Turnstile / audit — atrás de Cloudflare ou cloudflared. */
export function getClientIp(request: FastifyRequest): string | undefined {
  const cfConnecting = headerValue(request.headers['cf-connecting-ip']);
  if (cfConnecting && !isLoopbackOrPrivate(cfConnecting)) {
    return cfConnecting;
  }

  const forwarded = headerValue(request.headers['x-forwarded-for']);
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first && !isLoopbackOrPrivate(first)) return first;
  }

  const ip = request.ip?.trim();
  if (ip && !isLoopbackOrPrivate(ip)) return ip;

  return undefined;
}
