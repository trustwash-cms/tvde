export const CARWASH_LICENSE_COUNTRIES = [
  'PT',
  'GB',
  'ES',
  'FR',
  'DE',
  'IT',
  'NL',
  'BE',
  'LU',
  'CH',
  'PL',
  'BR',
  'AO',
  'MZ',
] as const;

export type CarwashLicenseCountry = (typeof CARWASH_LICENSE_COUNTRIES)[number];

export function stripLicenseInput(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function formatPortugueseLicensePlate(value: string): string {
  const raw = stripLicenseInput(value).slice(0, 6);
  const parts = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)].filter(Boolean);
  return parts.join('-');
}

export function validatePortugueseLicensePlate(value: string): boolean {
  return /^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/.test(formatPortugueseLicensePlate(value));
}

export function formatLicensePlateDisplay(
  plate: string,
  foreign: boolean,
  country: string
): string {
  if (foreign) return `${country} · ${plate}`;
  return plate;
}

export function normalizeLicensePlate(input: {
  licensePlate: string;
  licenseForeign?: boolean;
  licenseCountry?: string | null;
}): { licensePlate: string; licenseForeign: boolean; licenseCountry: string } {
  const foreign = Boolean(input.licenseForeign);
  const country = (input.licenseCountry ?? 'PT').trim().toUpperCase().slice(0, 2) || 'PT';

  if (foreign) {
    const plate = input.licensePlate.trim().toUpperCase().replace(/\s+/g, ' ');
    if (plate.length < 2) {
      throw new Error('Matrícula estrangeira inválida');
    }
    return { licensePlate: plate, licenseForeign: true, licenseCountry: country };
  }

  const formatted = formatPortugueseLicensePlate(input.licensePlate);
  if (!validatePortugueseLicensePlate(formatted)) {
    throw new Error('Matrícula nacional inválida — use o formato XX-XX-XX (6 caracteres)');
  }
  return { licensePlate: formatted, licenseForeign: false, licenseCountry: 'PT' };
}
