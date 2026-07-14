const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_INPUT_RE = /^[+]?[\d\s().-]{8,}$/;

export function normalizeGuestEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }

  return result;
}

export function normalizeGuestPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !PHONE_INPUT_RE.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8) return null;

  if (trimmed.startsWith('+')) {
    return trimmed
      .replace(/(\+\d{1,3})\./g, '$1 ')
      .replace(/\.(?=\d)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (digits.length === 9 && /^[29]/.test(digits)) {
    return `+351 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }

  return `+${digits}`;
}

export function normalizeGuestPhones(phones: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of phones) {
    const phone = normalizeGuestPhone(raw);
    if (!phone) continue;
    const key = phone.replace(/\D/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(phone);
  }

  return result;
}

export function readGuestEmails(metadataJson: unknown): string[] {
  if (!metadataJson || typeof metadataJson !== 'object' || Array.isArray(metadataJson)) {
    return [];
  }
  const guests = (metadataJson as Record<string, unknown>).guestEmails;
  if (!Array.isArray(guests)) return [];
  return normalizeGuestEmails(guests.filter((e): e is string => typeof e === 'string'));
}

export function readGuestPhones(metadataJson: unknown): string[] {
  if (!metadataJson || typeof metadataJson !== 'object' || Array.isArray(metadataJson)) {
    return [];
  }
  const phones = (metadataJson as Record<string, unknown>).guestPhones;
  if (!Array.isArray(phones)) return [];
  return normalizeGuestPhones(phones.filter((p): p is string => typeof p === 'string'));
}

export function mergeGuestContactsMetadata(
  metadataJson: unknown,
  input: { guestEmails?: string[]; guestPhones?: string[] }
) {
  const base =
    metadataJson && typeof metadataJson === 'object' && !Array.isArray(metadataJson)
      ? { ...(metadataJson as Record<string, unknown>) }
      : {};

  if (input.guestEmails !== undefined) {
    base.guestEmails = normalizeGuestEmails(input.guestEmails);
  }
  if (input.guestPhones !== undefined) {
    base.guestPhones = normalizeGuestPhones(input.guestPhones);
  }

  return base;
}

export function mergeGuestEmailsMetadata(metadataJson: unknown, guestEmails: string[]) {
  return mergeGuestContactsMetadata(metadataJson, { guestEmails });
}
