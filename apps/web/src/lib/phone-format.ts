/** Formata telefone Moloni para exibição (ex. +351.927 → +351 927). */
export function formatDisplayPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone
    .replace(/(\+\d{1,3})\./g, '$1 ')
    .replace(/\.(?=\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza telefone antes de guardar no CMS. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const formatted = formatDisplayPhone(phone);
  return formatted || null;
}
