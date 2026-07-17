/** Apenas letras e pontos (ex.: joao.silva). Números não permitidos. */
export const USERNAME_PATTERN = /^[a-zA-Z]+(\.[a-zA-Z]+)*$/;

export function isValidUsername(username: string): boolean {
  const value = username.trim();
  return value.length >= 2 && USERNAME_PATTERN.test(value);
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Gestor de Frota e Motorista precisam de telefone (WhatsApp). */
export function roleRequiresPhone(role: string): boolean {
  return role === 'superadmin' || role === 'admin';
}

export const USER_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
] as const;

export function buildUserPhone(countryCode: string, number: string): string {
  const cc = countryCode.replace(/\D/g, '');
  const num = number.replace(/\D/g, '');
  if (!cc || !num) return '';
  return `+${cc}${num}`;
}

export function splitUserPhone(phone: string | null | undefined): { countryCode: string; number: string } {
  if (!phone) return { countryCode: '+351', number: '' };
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('351') && digits.length > 3) {
    return { countryCode: '+351', number: digits.slice(3) };
  }
  if (phone.startsWith('+')) {
    const match = /^(\+\d{1,3})(\d+)$/.exec(phone.replace(/\s/g, ''));
    if (match) return { countryCode: match[1], number: match[2] };
  }
  return { countryCode: '+351', number: digits };
}

export function isValidUserPhone(countryCode: string, number: string): boolean {
  const phone = buildUserPhone(countryCode, number);
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

export interface PasswordRequirementCheck {
  id: string;
  label: string;
  ok: boolean;
}

export function getPasswordRequirementChecks(password: string): PasswordRequirementCheck[] {
  return [
    { id: 'length', label: 'Pelo menos 12 caracteres', ok: password.length >= 12 },
    { id: 'upper', label: 'Pelo menos uma maiúscula', ok: /[A-Z]/.test(password) },
    { id: 'lower', label: 'Pelo menos uma minúscula', ok: /[a-z]/.test(password) },
    { id: 'digit', label: 'Pelo menos um número', ok: /\d/.test(password) },
    { id: 'symbol', label: 'Pelo menos um símbolo', ok: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function isPasswordStrong(password: string): boolean {
  return getPasswordRequirementChecks(password).every((check) => check.ok);
}
