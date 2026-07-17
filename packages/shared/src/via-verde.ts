import { CATALOG_IMPORT_IGNORE, parseImportBoolean, parseImportMoney } from './csv-import';
import {
  findSpreadsheetHeaderRowIndex,
  normalizeImportHeader,
  padSpreadsheetRows,
  parseCsvTextToRows,
  parseSpreadsheetDateValue,
} from './spreadsheet-rows';
import { stripLicenseInput } from './carwash-license-plate';
import { normalizeUserVehicleMatricula } from './user-vehicle';

/** Normaliza matrícula para import: PT se válido, senão texto limpo (estrangeira / atípica). */
function normalizeViaVerdePlate(raw: string): string {
  try {
    return normalizeUserVehicleMatricula({ matricula: raw }).matricula;
  } catch {
    try {
      return normalizeUserVehicleMatricula({ matricula: raw, matriculaForeign: true }).matricula;
    } catch {
      const cleaned = stripLicenseInput(raw);
      if (cleaned.length >= 2 && cleaned.length <= 20) return cleaned;
      throw new Error('Matrícula inválida');
    }
  }
}

export const VIA_VERDE_PAGE_SIZE = 50;

export interface ViaVerdeMovementItem {
  id: string;
  licensePlate: string;
  entryDate: string | null;
  systemEntryDate: string | null;
  entryPoint: string | null;
  exitPoint: string | null;
  value: string;
  isPaid: boolean;
  paymentDate: string | null;
  serviceDescription: string | null;
  userId: string | null;
}

export interface ViaVerdeDashboardStats {
  totalMovements: number;
  unpaidCount: number;
  unpaidTotal: string;
  monthTotal: string;
  selectedMonth: string;
}

export interface ViaVerdeImportRowError {
  line: number;
  obu?: string;
  message: string;
}

export interface ViaVerdeParsedMovement {
  line: number;
  licensePlate: string;
  iai: string | null;
  obu: string;
  serviceCode: string | null;
  serviceDescription: string | null;
  marketCode: string | null;
  marketDescription: string | null;
  entryDate: Date | null;
  exitDate: Date | null;
  entryPoint: string | null;
  exitPoint: string | null;
  value: number;
  isPaid: boolean;
  paymentDate: Date | null;
  contractNumber: string | null;
  liquidValue: number | null;
  discountBalance: number | null;
  mobilityAccount: string | null;
  paymentMethod: string | null;
  systemEntryDate: Date | null;
}

export interface ViaVerdeImportResult {
  total: number;
  inserted: number;
  skipped: number;
  failed: number;
  errors: ViaVerdeImportRowError[];
}

type ViaVerdeField =
  | 'licensePlate'
  | 'iai'
  | 'obu'
  | 'serviceCode'
  | 'serviceDescription'
  | 'marketCode'
  | 'marketDescription'
  | 'entryDate'
  | 'exitDate'
  | 'entryPoint'
  | 'exitPoint'
  | 'value'
  | 'isPaid'
  | 'paymentDate'
  | 'invoiceNumber'
  | 'contractNumber'
  | 'discountVv'
  | 'discountVvPercentage'
  | 'liquidValue'
  | 'discountBalance'
  | 'mobilityAccount'
  | 'paymentMethod'
  | 'systemEntryDate';

const VIA_VERDE_HEADER_ALIASES: Record<string, ViaVerdeField> = {
  'license plate': 'licensePlate',
  matricula: 'licensePlate',
  matrícula: 'licensePlate',
  iai: 'iai',
  obu: 'obu',
  identificador: 'obu',
  'identificador / conta mobilidade': 'obu',
  'identificador conta mobilidade': 'obu',
  'conta mobilidade': 'mobilityAccount',
  service: 'serviceCode',
  'service description': 'serviceDescription',
  servico: 'serviceDescription',
  serviço: 'serviceDescription',
  descricao: 'entryPoint',
  descrição: 'entryPoint',
  market: 'marketCode',
  'market description': 'marketDescription',
  'entry date': 'entryDate',
  'data entrada': 'entryDate',
  'exit date': 'exitDate',
  'data saida': 'exitDate',
  'data saída': 'exitDate',
  'entry point': 'entryPoint',
  'exit point': 'exitPoint',
  value: 'value',
  valor: 'value',
  'is payed': 'isPaid',
  'is paid': 'isPaid',
  pago: 'isPaid',
  'payment date': 'paymentDate',
  'data pagamento': 'paymentDate',
  invoice: 'invoiceNumber',
  'invoice number': 'invoiceNumber',
  'n fatura': 'invoiceNumber',
  'nº fatura': 'invoiceNumber',
  'contract number': 'contractNumber',
  'n contrato': 'contractNumber',
  'nº contrato': 'contractNumber',
  'discount vv': 'discountVv',
  'discount vvpercentage': 'discountVvPercentage',
  'discount vv percentage': 'discountVvPercentage',
  'liquid value': 'liquidValue',
  'discount balance': 'discountBalance',
  'mobility account': 'mobilityAccount',
  'payment method': 'paymentMethod',
  'meio de pagamento': 'paymentMethod',
  'system entry date': 'systemEntryDate',
  'data da cobranca': 'systemEntryDate',
  'data da cobrança': 'systemEntryDate',
};

function guessViaVerdeFieldMapping(columnLabels: string[]): string[] {
  const used = new Set<string>();
  return columnLabels.map((label) => {
    const normalized = normalizeImportHeader(label);
    const field = VIA_VERDE_HEADER_ALIASES[normalized];
    if (!field || field === 'invoiceNumber' || field === 'discountVv' || field === 'discountVvPercentage') {
      return CATALOG_IMPORT_IGNORE;
    }
    if (used.has(field)) return CATALOG_IMPORT_IGNORE;
    used.add(field);
    return field;
  });
}

function applyViaVerdeMapping(
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

function parseViaVerdeMappedRow(
  line: number,
  mapped: Record<string, string>,
  seenObu: Set<string>
): { row?: ViaVerdeParsedMovement; error?: ViaVerdeImportRowError } {
  const licensePlateRaw = mapped.licensePlate?.trim() ?? '';
  const obu = mapped.obu?.trim() ?? '';

  if (!licensePlateRaw) {
    return { error: { line, obu, message: 'Matrícula em falta' } };
  }
  if (licensePlateRaw.length > 20) {
    return { error: { line, obu, message: 'Matrícula demasiado longa (máx. 20)' } };
  }
  if (!obu) {
    return { error: { line, message: 'OBU em falta' } };
  }
  if (seenObu.has(obu)) {
    return { error: { line, obu, message: 'OBU duplicado no ficheiro' } };
  }
  seenObu.add(obu);

  const value = parseImportMoney(mapped.value);
  if (value == null) {
    return { error: { line, obu, message: 'Valor inválido' } };
  }

  let licensePlate: string;
  try {
    licensePlate = normalizeViaVerdePlate(licensePlateRaw);
  } catch {
    return { error: { line, obu, message: `Matrícula inválida: ${licensePlateRaw}` } };
  }

  return {
    row: {
      line,
      licensePlate,
      iai: mapped.iai?.trim() || null,
      obu,
      serviceCode: mapped.serviceCode?.trim() || null,
      serviceDescription: mapped.serviceDescription?.trim() || null,
      marketCode: mapped.marketCode?.trim() || null,
      marketDescription: mapped.marketDescription?.trim() || null,
      entryDate: parseSpreadsheetDateValue(mapped.entryDate),
      exitDate: parseSpreadsheetDateValue(mapped.exitDate),
      entryPoint: mapped.entryPoint?.trim() || null,
      exitPoint: mapped.exitPoint?.trim() || null,
      value,
      isPaid: parseImportBoolean(mapped.isPaid, false),
      paymentDate: parseSpreadsheetDateValue(mapped.paymentDate),
      contractNumber: mapped.contractNumber?.trim() || null,
      liquidValue: parseImportMoney(mapped.liquidValue),
      discountBalance: parseImportMoney(mapped.discountBalance),
      mobilityAccount: mapped.mobilityAccount?.trim() || null,
      paymentMethod: mapped.paymentMethod?.trim() || null,
      systemEntryDate: parseSpreadsheetDateValue(mapped.systemEntryDate),
    },
  };
}

function parseViaVerdePositionalRows(rawRows: string[][]): {
  rows: ViaVerdeParsedMovement[];
  errors: ViaVerdeImportRowError[];
} {
  const errors: ViaVerdeImportRowError[] = [];
  const rows: ViaVerdeParsedMovement[] = [];
  const dataRows = rawRows.slice(1);
  const seenObu = new Set<string>();

  for (let index = 0; index < dataRows.length; index += 1) {
    const line = index + 2;
    const cells = dataRows[index] ?? [];
    if (cells.every((cell) => !cell.trim())) continue;

    const hasInvoiceColumn = cells.length >= 23;
    const contractIndex = hasInvoiceColumn ? 15 : 14;
    const liquidIndex = hasInvoiceColumn ? 18 : 17;
    const discountBalanceIndex = hasInvoiceColumn ? 19 : 18;
    const mobilityIndex = hasInvoiceColumn ? 20 : 19;
    const paymentMethodIndex = hasInvoiceColumn ? 21 : 20;
    const systemEntryIndex = hasInvoiceColumn ? 22 : 21;

    const mapped: Record<string, string> = {
      licensePlate: cells[0] ?? '',
      iai: cells[1] ?? '',
      obu: cells[2] ?? '',
      serviceCode: cells[3] ?? '',
      serviceDescription: cells[4] ?? '',
      marketCode: cells[5] ?? '',
      marketDescription: cells[6] ?? '',
      entryDate: cells[7] ?? '',
      exitDate: cells[8] ?? '',
      entryPoint: cells[9] ?? '',
      exitPoint: cells[10] ?? '',
      value: cells[11] ?? '',
      isPaid: cells[12] ?? '',
      paymentDate: cells[13] ?? '',
      contractNumber: cells[contractIndex] ?? '',
      liquidValue: cells[liquidIndex] ?? '',
      discountBalance: cells[discountBalanceIndex] ?? '',
      mobilityAccount: cells[mobilityIndex] ?? '',
      paymentMethod: cells[paymentMethodIndex] ?? '',
      systemEntryDate: cells[systemEntryIndex] ?? '',
    };

    const parsed = parseViaVerdeMappedRow(line, mapped, seenObu);
    if (parsed.error) errors.push(parsed.error);
    else if (parsed.row) rows.push(parsed.row);
  }

  return { rows, errors };
}

export function parseViaVerdeRows(rawRows: string[][]): {
  rows: ViaVerdeParsedMovement[];
  errors: ViaVerdeImportRowError[];
} {
  const rows = padSpreadsheetRows(rawRows);
  if (rows.length < 2) {
    return { rows: [], errors: [{ line: 1, message: 'Ficheiro vazio ou sem dados' }] };
  }

  const headerRowIndex = findSpreadsheetHeaderRowIndex(rows, (cells) =>
    cells.some((cell) => cell === 'obu') &&
    (cells.some((cell) => cell.includes('license plate')) || cells.some((cell) => cell.includes('matricula')))
  );

  if (headerRowIndex >= 0) {
    const header = rows[headerRowIndex] ?? [];
    const columnMapping = guessViaVerdeFieldMapping(header);
    const mappedRows = applyViaVerdeMapping(rows, headerRowIndex, columnMapping);

    if (!columnMapping.includes('obu') || !columnMapping.includes('licensePlate')) {
      return {
        rows: [],
        errors: [{ line: headerRowIndex + 1, message: 'Cabeçalho Via Verde inválido — faltam OBU ou Matrícula' }],
      };
    }

    const parsedRows: ViaVerdeParsedMovement[] = [];
    const errors: ViaVerdeImportRowError[] = [];
    const seenObu = new Set<string>();

    for (let index = 0; index < mappedRows.length; index += 1) {
      const line = headerRowIndex + index + 2;
      const parsed = parseViaVerdeMappedRow(line, mappedRows[index]!, seenObu);
      if (parsed.error) errors.push(parsed.error);
      else if (parsed.row) parsedRows.push(parsed.row);
    }

    return { rows: parsedRows, errors };
  }

  return parseViaVerdePositionalRows(rows);
}

export function parseViaVerdeCsv(csvText: string): {
  rows: ViaVerdeParsedMovement[];
  errors: ViaVerdeImportRowError[];
} {
  return parseViaVerdeRows(parseCsvTextToRows(csvText));
}

export function parseViaVerdeImportFileName(filename: string): boolean {
  const name = filename.toLowerCase();
  return name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.xls') || name.endsWith('.xlsx');
}
