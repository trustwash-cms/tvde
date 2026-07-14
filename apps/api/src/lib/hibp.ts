import { createHash } from 'crypto';
import { env } from '../config/env';

export async function isPasswordPwned(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: {
      'User-Agent': 'CMS-MultiTenant',
      'Add-Padding': 'true',
    },
  });

  if (!res.ok) {
    throw new Error('Não foi possível verificar a password (HIBP indisponível)');
  }

  const body = await res.text();
  return body.split('\n').some((line) => {
    const [hashSuffix] = line.trim().split(':');
    return hashSuffix === suffix;
  });
}

export async function assertPasswordNotPwned(password: string): Promise<void> {
  if (!env.hibpCheckEnabled) return;

  try {
    const pwned = await isPasswordPwned(password);
    if (pwned) {
      throw new Error('Esta password apareceu em leaks conhecidos. Escolha outra.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('leaks conhecidos')) throw err;
    if (env.nodeEnv === 'production') {
      throw new Error('Não foi possível validar a password. Tente novamente.');
    }
    console.warn('[hibp] Verificação ignorada em desenvolvimento:', err);
  }
}
