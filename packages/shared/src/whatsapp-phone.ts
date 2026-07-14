/** Normaliza telefone para envio WhatsApp (dígitos com indicativo PT). */
export function normalizeWhatsappPhoneDigits(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  // Portugal: 9 dígitos sem indicativo (91x, 92x, 96x, 2xx…)
  if (digits.length === 9 && /^[29]/.test(digits)) {
    digits = `351${digits}`;
  }
  return digits;
}

/** Formato legível com + (ex. +351925986983). */
export function formatWhatsappPhone(phone: string): string {
  const digits = normalizeWhatsappPhoneDigits(phone);
  return digits ? `+${digits}` : '';
}

/** Compara dois números ignorando formatação. */
export function whatsappPhonesMatch(a: string, b: string): boolean {
  const da = normalizeWhatsappPhoneDigits(a);
  const db = normalizeWhatsappPhoneDigits(b);
  return Boolean(da && db && da === db);
}
