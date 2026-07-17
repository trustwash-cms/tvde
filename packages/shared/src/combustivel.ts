import { CATALOG_IMPORT_IGNORE, parseImportMoney } from './csv-import';
import {
  findSpreadsheetHeaderRowIndex,
  normalizeImportHeader,
  padSpreadsheetRows,
  parseCsvTextToRows,
  parseSpreadsheetDateValue,
} from './spreadsheet-rows';

export const COMBUSTIVEL_PAGE_SIZE = 50;

export interface CombustivelImportRowError {
  line: number;
  receiptNumber?: string;
  message: string;
}

export interface CombustivelParsedTransaction {
  line: number;
  station: string | null;
  chargeDate: Date;
  cardNumber: string | null;
  cardDescription: string | null;
  liters: number | null;
  fuelType: string | null;
  receiptNumber: string | null;
  totalWithVat: number;
  clientName: string | null;
}

export interface CombustivelImportResult {
  total: number;
  inserted: number;
  skipped: number;
  failed: number;
  errors: CombustivelImportRowError[];
}

type CombustivelField =
  | 'station'
  | 'chargeDate'
  | 'chargeTime'
  | 'cardNumber'
  | 'cardDescription'
  | 'liters'
  | 'fuelType'
  | 'receiptNumber'
  | 'totalWithVat'
  | 'clientName';

const COMBUSTIVEL_HEADER_ALIASES: Record<string, CombustivelField> = {
  posto: 'station',
  data: 'chargeDate',
  hora: 'chargeTime',
  cartao: 'cardNumber',
  cartão: 'cardNumber',
  'desc. cartao': 'cardDescription',
  'desc. cartão': 'cardDescription',
  'desc cartao': 'cardDescription',
  'desc cartão': 'cardDescription',
  litros: 'liters',
  combustivel: 'fuelType',
  combustível: 'fuelType',
  comb: 'fuelType',
  'comb.': 'fuelType',
  recibo: 'receiptNumber',
  total: 'totalWithVat',
  'total c iva': 'totalWithVat',
  'total c/ iva': 'totalWithVat',
  cliente: 'clientName',
};

function guessCombustivelFieldMapping(columnLabels: string[]): string[] {
  const used = new Set<string>();
  return columnLabels.map((label) => {
    const normalized = normalizeImportHeader(label);
    const field = COMBUSTIVEL_HEADER_ALIASES[normalized];
    if (!field || used.has(field)) return CATALOG_IMPORT_IGNORE;
    used.add(field);
    return field;
  });
}

function combineDateAndTime(dateValue: string | undefined, timeValue: string | undefined): Date | null {
  // Frota PRIO: Excel/CSV em MM/DD; com raw:true o XLSX chega como YYYY-MM-DD (ISO).
  const datePart = parseSpreadsheetDateValue(dateValue, { order: 'mdy' });
  if (!datePart) return null;

  if (!timeValue?.trim()) {
    return new Date(
      datePart.getFullYear(),
      datePart.getMonth(),
      datePart.getDate(),
      0,
      0,
      0
    );
  }

  const timeMatch = timeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!timeMatch) {
    return new Date(
      datePart.getFullYear(),
      datePart.getMonth(),
      datePart.getDate(),
      0,
      0,
      0
    );
  }

  const hour = parseInt(timeMatch[1]!, 10);
  const minute = parseInt(timeMatch[2]!, 10);
  const second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
  return new Date(
    datePart.getFullYear(),
    datePart.getMonth(),
    datePart.getDate(),
    hour,
    minute,
    second
  );
}

export function parseCombustivelRows(rawRows: string[][]): {
  rows: CombustivelParsedTransaction[];
  errors: CombustivelImportRowError[];
} {
  const rows = padSpreadsheetRows(rawRows);
  const errors: CombustivelImportRowError[] = [];
  const parsedRows: CombustivelParsedTransaction[] = [];

  if (rows.length < 2) {
    return { rows: parsedRows, errors: [{ line: 1, message: 'Ficheiro vazio ou sem dados' }] };
  }

  const headerRowIndex = findSpreadsheetHeaderRowIndex(
    rows,
    (cells) =>
      cells.some((cell) => cell === 'posto') &&
      cells.some((cell) => cell.includes('cartao') || cell.includes('cartão')) &&
      cells.some((cell) => cell === 'total') &&
      (cells.some((cell) => cell.includes('litros')) ||
        cells.some((cell) => cell.includes('combustivel')) ||
        cells.some((cell) => cell.includes('combustível')))
  );

  if (headerRowIndex < 0) {
    return { rows: parsedRows, errors: [{ line: 1, message: 'Cabeçalho PRIO frota/combustível não encontrado' }] };
  }

  const header = rows[headerRowIndex] ?? [];
  const columnMapping = guessCombustivelFieldMapping(header);
  const padded = padSpreadsheetRows(rows);
  const dataRows = padded.slice(headerRowIndex + 1);

  if (!columnMapping.includes('chargeDate') || !columnMapping.includes('totalWithVat')) {
    return {
      rows: parsedRows,
      errors: [{ line: headerRowIndex + 1, message: 'Colunas obrigatórias em falta: DATA e TOTAL' }],
    };
  }

  const seenReceipts = new Set<string>();

  for (let index = 0; index < dataRows.length; index += 1) {
    const line = headerRowIndex + index + 2;
    const row = dataRows[index] ?? [];
    if (row.every((cell) => !cell.trim())) continue;

    const mapped: Record<string, string> = {};
    columnMapping.forEach((fieldKey, columnIndex) => {
      if (!fieldKey || fieldKey === CATALOG_IMPORT_IGNORE) return;
      mapped[fieldKey] = row[columnIndex]?.trim() ?? '';
    });

    const chargeDate = combineDateAndTime(mapped.chargeDate, mapped.chargeTime);
    if (!chargeDate) {
      errors.push({ line, message: 'Data inválida' });
      continue;
    }

    const totalWithVat = parseImportMoney(mapped.totalWithVat);
    if (totalWithVat == null) {
      errors.push({ line, message: 'Total inválido' });
      continue;
    }

    const receiptNumber = mapped.receiptNumber?.trim() || null;
    if (receiptNumber) {
      if (seenReceipts.has(receiptNumber)) {
        errors.push({ line, receiptNumber, message: 'Recibo duplicado no ficheiro' });
        continue;
      }
      seenReceipts.add(receiptNumber);
    }

    const liters = mapped.liters?.trim() ? parseImportMoney(mapped.liters) : null;

    parsedRows.push({
      line,
      station: mapped.station?.trim() || null,
      chargeDate,
      cardNumber: mapped.cardNumber?.trim() || null,
      cardDescription: mapped.cardDescription?.trim() || null,
      liters,
      fuelType: mapped.fuelType?.trim() || null,
      receiptNumber,
      totalWithVat,
      clientName: mapped.clientName?.trim() || null,
    });
  }

  return { rows: parsedRows, errors };
}

export function parseCombustivelCsv(csvText: string): {
  rows: CombustivelParsedTransaction[];
  errors: CombustivelImportRowError[];
} {
  return parseCombustivelRows(parseCsvTextToRows(csvText));
}

export function parseCombustivelImportFileName(filename: string): boolean {
  const name = filename.toLowerCase();
  return name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.xls') || name.endsWith('.xlsx');
}
