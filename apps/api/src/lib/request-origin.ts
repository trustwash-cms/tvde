import type { FastifyRequest } from 'fastify';

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
}

/** Origem pública do pedido (atrás de Cloudflare / cloudflared). */
export function resolveRequestPublicOrigin(request: FastifyRequest): string {
  const proto =
    headerValue(request.headers['x-forwarded-proto'])?.split(',')[0]?.trim() ||
    request.protocol ||
    'https';
  const host =
    headerValue(request.headers['x-forwarded-host'])?.split(',')[0]?.trim() ||
    headerValue(request.headers.host);

  if (!host) return 'http://localhost:3000';
  return `${proto}://${host}`;
}
