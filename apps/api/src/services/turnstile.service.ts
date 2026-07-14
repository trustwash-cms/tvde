import { env } from '../config/env';

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

export function isTurnstileEnabled(): boolean {
  return Boolean(env.turnstileSecretKey);
}

export async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
  const secret = env.turnstileSecretKey;
  if (!secret) return true;

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  // remoteip é opcional — omitir se IP local/proxy evita falha atrás de cloudflared
  if (remoteIp) form.append('remoteip', remoteIp);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    if (!res.ok) return false;

    const data = (await res.json()) as TurnstileVerifyResponse;
    if (data.success !== true) {
      console.warn('[turnstile] Verificação falhou:', data['error-codes']?.join(', ') ?? 'unknown');
    }
    return data.success === true;
  } catch (err) {
    console.error('[turnstile] Falha na verificação:', err);
    return false;
  }
}

export async function assertTurnstileIfEnabled(token: string | undefined, remoteIp?: string): Promise<void> {
  if (!isTurnstileEnabled()) return;

  if (!token) {
    throw new Error('Verificação captcha obrigatória');
  }

  const valid = await verifyTurnstileToken(token, remoteIp);
  if (!valid) {
    throw new Error('Verificação captcha inválida ou expirada');
  }
}
