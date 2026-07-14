import { API_PATHS } from './routes';

/**
 * URI OAuth Moloni — deve ser URL público (HTTPS).
 * Moloni não aceita localhost; em dev use túnel (ngrok, cloudflared, etc.).
 *
 * Prioridade:
 * 1. NEXT_PUBLIC_MOLONI_REDIRECT_URI (URI completo)
 * 2. NEXT_PUBLIC_API_PUBLIC_URL + /billing/moloni/callback
 * 3. NEXT_PUBLIC_API_URL + /billing/moloni/callback
 */
export function getMoloniRedirectUri(): string {
  const explicit = process.env.NEXT_PUBLIC_MOLONI_REDIRECT_URI?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const base = (
    process.env.NEXT_PUBLIC_API_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    ''
  ).replace(/\/$/, '');

  if (!base) return '';
  return `${base}${API_PATHS.billing.moloniCallback}`;
}

export function isMoloniLocalRedirect(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  } catch {
    return false;
  }
}
