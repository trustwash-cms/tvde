import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  return createHash('sha256').update(env.encryptionKey).digest();
}

export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Ciphertext inválido');
  }
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** AES-GCM auth-tag failure (wrong ENCRYPTION_KEY or corrupted ciphertext). */
export function isCryptoAuthFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('unsupported state or unable to authenticate data') ||
    msg.includes('unable to authenticate data') ||
    msg.includes('ciphertext inválido') ||
    err.name === 'Error' && msg.includes('auth')
  );
}

/** True when payload looks like iv:tag:data and decrypts with the current key. */
export function canDecrypt(payload: string | null | undefined): boolean {
  if (!payload) return false;
  try {
    decrypt(payload);
    return true;
  } catch {
    return false;
  }
}
