import {
  formatLicensePlateDisplay,
  normalizeLicensePlate,
} from './carwash-license-plate';

export const VEHICLE_COMMISSION_TYPES = ['fixa', 'percentagem', 'slot'] as const;
export type VehicleCommissionType = (typeof VEHICLE_COMMISSION_TYPES)[number];

export const VEHICLE_COMMISSION_TYPE_LABELS: Record<VehicleCommissionType, string> = {
  fixa: 'Comissão fixa',
  percentagem: 'Percentagem',
  slot: 'Slot',
};

export interface UserVehicleRecord {
  id: string;
  userId: string;
  tenantId: string;
  matricula: string;
  matriculaForeign: boolean;
  matriculaCountry: string;
  dataInicio: string;
  dataFim: string | null;
  uuidUber: string | null;
  uuidBolt: string | null;
  numCartaoPrio: string | null;
  nomeCompleto: string | null;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  aluguelViatura: string | null;
  comissaoTipo: VehicleCommissionType | null;
  comissaoValor: string | null;
  comissaoIva6: boolean;
  slotIncluirViaVerde: boolean;
  slotIncluirEletricidadeCombustivel: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantVehicleLimits {
  maxVehicles: number;
  activeCount: number;
  usagePercent: number;
  plan: string;
  siteId: string | null;
  tenantName: string | null;
}

export function normalizeUserVehicleMatricula(input: {
  matricula: string;
  matriculaForeign?: boolean;
  matriculaCountry?: string | null;
}): { matricula: string; matriculaForeign: boolean; matriculaCountry: string } {
  const normalized = normalizeLicensePlate({
    licensePlate: input.matricula,
    licenseForeign: input.matriculaForeign,
    licenseCountry: input.matriculaCountry,
  });
  return {
    matricula: normalized.licensePlate,
    matriculaForeign: normalized.licenseForeign,
    matriculaCountry: normalized.licenseCountry,
  };
}

export function formatUserVehicleMatricula(vehicle: {
  matricula: string;
  matriculaForeign: boolean;
  matriculaCountry: string;
}): string {
  return formatLicensePlateDisplay(
    vehicle.matricula,
    vehicle.matriculaForeign,
    vehicle.matriculaCountry
  );
}

export function parseOptionalDecimal(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const num = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(num)) return null;
  return num.toFixed(2);
}

export function parseOptionalYear(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const year = parseInt(trimmed, 10);
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null;
  return year;
}

export function parseDateOnlyInput(value: string): Date {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Data inválida — use AAAA-MM-DD');
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new Error('Data inválida');
  }
  return dt;
}

export function formatDateOnlyInput(value: Date | string | null | undefined): string {
  if (!value) return '';
  const dt = typeof value === 'string' ? new Date(value) : value;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
