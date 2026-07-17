import { CATALOG_IMPORT_IGNORE, parseImportMoney } from './csv-import';
import {
  findSpreadsheetHeaderRowIndex,
  normalizeImportHeader,
  padSpreadsheetRows,
  parseCsvTextToRows,
  parseSpreadsheetDateValue,
} from './spreadsheet-rows';

export const ELECTRICITY_PAGE_SIZE = 50;

/** Campos de import — matrícula NÃO entra (MyPRIO Electric vem vazia; UI Electric sem coluna). */
export const ELECTRICITY_IMPORT_FIELDS = [
  'chargeExternalId',
  'chargeDate',
  'cardNumber',
  'name',
  'station',
  'energyKwh',
  'duration',
  'totalWithVat',
] as const;

export type ElectricityImportField = (typeof ELECTRICITY_IMPORT_FIELDS)[number];

export interface ElectricityChargeItem {
  id: string;
  chargeDate: string;
  name: string | null;
  cardNumber: string | null;
  /** Sempre null na UI Electric; coluna BD mantida por compatibilidade. */
  licensePlate: string | null;
  station: string | null;
  energyKwh: string | null;
  duration: string | null;
  totalWithVat: string;
  isPaid: boolean;
  paymentDate: string | null;
  userId: string | null;
}

export interface ElectricityDashboardStats {
  totalCharges: number;
  unpaidCount: number;
  unpaidTotal: string;
  monthTotal: string;
  selectedMonth: string;
}

export interface ElectricityImportRowError {
  line: number;
  chargeExternalId?: string;
  message: string;
}

export interface ElectricityParsedCharge {
  line: number;
  chargeExternalId: string | null;
  chargeDate: Date;
  cardNumber: string | null;
  name: string | null;
  /** Import Electric ignora matrícula (sempre null). */
  licensePlate: string | null;
  station: string | null;
  energyKwh: number | null;
  duration: string | null;
  totalWithVat: number;
}

export interface ElectricityImportResult {
  total: number;
  inserted: number;
  skipped: number;
  failed: number;
  errors: ElectricityImportRowError[];
}

const ELECTRICITY_HEADER_ALIASES: Record<string, ElectricityImportField> = {
  id_carregamento: 'chargeExternalId',
  'id carregamento': 'chargeExternalId',
  id: 'chargeExternalId',
  charge_id: 'chargeExternalId',
  data: 'chargeDate',
  'data carregamento': 'chargeDate',
  num_cartao: 'cardNumber',
  'num cartao': 'cardNumber',
  'n cartao': 'cardNumber',
  'nº cartão': 'cardNumber',
  'nº. cartão': 'cardNumber',
  'no cartao': 'cardNumber',
  cartao: 'cardNumber',
  cartão: 'cardNumber',
  'n cartao prio': 'cardNumber',
  nome: 'name',
  'nome completo': 'name',
  // MATRÍCULA / plate — ignoradas de propósito (ver guessElectricityFieldMapping)
  posto: 'station',
  estacao: 'station',
  estação: 'station',
  'p carregamento': 'station',
  'p. carregamento': 'station',
  energia: 'energyKwh',
  'energia kwh': 'energyKwh',
  'energia (kwh)': 'energyKwh',
  duracao: 'duration',
  duração: 'duration',
  total_iva: 'totalWithVat',
  'total iva': 'totalWithVat',
  'total c iva': 'totalWithVat',
  'total c/ iva': 'totalWithVat',
  'total com iva': 'totalWithVat',
  // Nota: não mapear 'total' nu — no Excel PRIO existe também «TOTAL c/ IVA»
};

function isIgnoredElectricityHeader(normalized: string): boolean {
  return (
    normalized === 'matricula' ||
    normalized === 'license plate' ||
    normalized === 'licenseplate' ||
    normalized === 'plate' ||
    normalized.includes('matricula')
  );
}

export function guessElectricityFieldMapping(columnLabels: string[]): string[] {
  const used = new Set<string>();
  const normalizedLabels = columnLabels.map((label) => normalizeImportHeader(label));
  const hasTotalComIva = normalizedLabels.some(
    (label) => label === 'total c iva' || label === 'total c/ iva' || label.includes('total c')
  );

  return normalizedLabels.map((normalized) => {
    // Coluna MATRÍCULA do Excel PRIO: ignorar (vazia no portal; não usada na Electric)
    if (isIgnoredElectricityHeader(normalized)) return CATALOG_IMPORT_IGNORE;
    // Preferir «TOTAL c/ IVA» quando ambas as colunas existem
    if (normalized === 'total' && hasTotalComIva) return CATALOG_IMPORT_IGNORE;
    const field = ELECTRICITY_HEADER_ALIASES[normalized];
    if (!field || used.has(field)) return CATALOG_IMPORT_IGNORE;
    used.add(field);
    return field;
  });
}

function normalizePrioMoney(value: string | undefined, scaleIfHuge = false): number | null {
  const parsed = parseImportMoney(value);
  if (parsed == null) return null;
  if (scaleIfHuge && parsed > 1000) return parsed / 100;
  return parsed;
}

function applyElectricityMapping(
  rows: string[][],
  headerRowIndex: number,
  columnMapping: string[]
): Array<Record<string, string>> {
  const padded = padSpreadsheetRows(rows);
  const dataRows = padded.slice(headerRowIndex + 1);
  const mappedRows: Array<Record<string, string>> = [];

  for (const row of dataRows) {
    if (row.every((cell) => !cell.trim())) continue;
    const mapped: Record<string, string> = {};
    columnMapping.forEach((fieldKey, columnIndex) => {
      if (!fieldKey || fieldKey === CATALOG_IMPORT_IGNORE) return;
      mapped[fieldKey] = row[columnIndex]?.trim() ?? '';
    });
    if (Object.keys(mapped).length > 0) mappedRows.push(mapped);
  }

  return mappedRows;
}

export function parseElectricityRows(rawRows: string[][]): {
  rows: ElectricityParsedCharge[];
  errors: ElectricityImportRowError[];
} {
  const rows = padSpreadsheetRows(rawRows);
  const errors: ElectricityImportRowError[] = [];
  const parsedRows: ElectricityParsedCharge[] = [];

  if (rows.length < 2) {
    return { rows: parsedRows, errors: [{ line: 1, message: 'Ficheiro vazio ou sem dados' }] };
  }

  const headerRowIndex = findSpreadsheetHeaderRowIndex(
    rows,
    (cells) =>
      (cells.some((cell) => cell.includes('energia')) ||
        cells.some((cell) => cell.includes('carregamento'))) &&
      cells.some((cell) => cell.includes('total') || cell.includes('iva'))
  );

  if (headerRowIndex < 0) {
    return { rows: parsedRows, errors: [{ line: 1, message: 'Cabeçalho PRIO eletricidade não encontrado' }] };
  }

  const header = rows[headerRowIndex] ?? [];
  const columnMapping = guessElectricityFieldMapping(header);
  const mappedRows = applyElectricityMapping(rows, headerRowIndex, columnMapping);

  const required = ['chargeDate', 'totalWithVat'] as const;
  for (const field of required) {
    if (!columnMapping.includes(field)) {
      return {
        rows: parsedRows,
        errors: [{ line: headerRowIndex + 1, message: `Coluna obrigatória em falta: ${field}` }],
      };
    }
  }

  const seenKeys = new Set<string>();

  for (let index = 0; index < mappedRows.length; index += 1) {
    const line = headerRowIndex + index + 2;
    const mapped = mappedRows[index]!;
    const chargeDate = parseSpreadsheetDateValue(mapped.chargeDate);
    if (!chargeDate) {
      errors.push({ line, message: 'Data inválida' });
      continue;
    }

    const totalWithVat = normalizePrioMoney(mapped.totalWithVat, true);
    if (totalWithVat == null) {
      errors.push({ line, message: 'Total inválido' });
      continue;
    }

    const energyKwh = mapped.energyKwh?.trim()
      ? normalizePrioMoney(mapped.energyKwh, true)
      : null;

    const chargeExternalId = mapped.chargeExternalId?.trim() || null;
    const cardNumber = mapped.cardNumber?.trim() || null;
    const station = mapped.station?.trim() || null;

    const dedupeKey = chargeExternalId
      ? `id:${chargeExternalId}`
      : `combo:${mapped.chargeDate}|${cardNumber ?? ''}|${station ?? ''}|${totalWithVat.toFixed(2)}`;

    if (seenKeys.has(dedupeKey)) {
      errors.push({
        line,
        chargeExternalId: chargeExternalId ?? undefined,
        message: 'Duplicado no ficheiro',
      });
      continue;
    }
    seenKeys.add(dedupeKey);

    parsedRows.push({
      line,
      chargeExternalId,
      chargeDate,
      cardNumber,
      name: mapped.name?.trim() || null,
      licensePlate: null,
      station,
      energyKwh,
      duration: mapped.duration?.trim() || null,
      totalWithVat,
    });
  }

  return { rows: parsedRows, errors };
}

export function parseElectricityCsv(csvText: string): {
  rows: ElectricityParsedCharge[];
  errors: ElectricityImportRowError[];
} {
  return parseElectricityRows(parseCsvTextToRows(csvText));
}

export function parseElectricityImportFileName(filename: string): boolean {
  const name = filename.toLowerCase();
  return name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.xls') || name.endsWith('.xlsx');
}
