import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { assertPasswordNotPwned } from './hibp';

const BCRYPT_ROUNDS = 12;
const MIN_LENGTH = 12;

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*-_+=?';
const ALL_CHARS = LOWER + UPPER + DIGITS + SYMBOLS;

export const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

export function computeTempPasswordExpiresAt(from = Date.now()): Date {
  return new Date(from + TEMP_PASSWORD_TTL_MS);
}

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < MIN_LENGTH) {
    errors.push(`Mínimo ${MIN_LENGTH} caracteres`);
  }
  if (!PASSWORD_REGEX.test(password)) {
    errors.push('Deve conter maiúscula, minúscula, número e símbolo');
  }
  return { valid: errors.length === 0, errors };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function isPasswordReused(
  userId: string,
  newPassword: string,
  getHistory: (userId: string) => Promise<string[]>
): Promise<boolean> {
  const history = await getHistory(userId);
  for (const oldHash of history) {
    if (await bcrypt.compare(newPassword, oldHash)) return true;
  }
  return false;
}

export async function validatePasswordWithHibp(password: string): Promise<{ valid: boolean; errors: string[] }> {
  const result = validatePassword(password);
  if (!result.valid) return result;

  try {
    await assertPasswordNotPwned(password);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Password inválida';
    return { valid: false, errors: [message] };
  }

  return result;
}

function shuffleChars(chars: string[]): string[] {
  const copy = [...chars];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Gera password aleatória que cumpre as regras locais (12+ chars, complexidade). */
export function generateSecurePassword(length = 16): string {
  const size = Math.max(length, MIN_LENGTH);
  const chars = [
    LOWER[randomInt(LOWER.length)],
    UPPER[randomInt(UPPER.length)],
    DIGITS[randomInt(DIGITS.length)],
    SYMBOLS[randomInt(SYMBOLS.length)],
  ];
  while (chars.length < size) {
    chars.push(ALL_CHARS[randomInt(ALL_CHARS.length)]);
  }
  return shuffleChars(chars).join('');
}

export async function generateSecurePasswordWithHibp(length = 16): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const password = generateSecurePassword(length);
    const check = await validatePasswordWithHibp(password);
    if (check.valid) return password;
  }
  throw new Error('Não foi possível gerar password temporária segura');
}
