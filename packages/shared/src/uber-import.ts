import { parseImportMoney, parseRawCsvRows } from './csv-import';
import { normalizeSpreadsheetRows, parseSpreadsheetDateValue } from './spreadsheet-rows';

export const UBER_CSV_REQUIRED_COLUMNS = ['uuid', 'nome', 'apelido', 'data', 'valor'] as const;

export interface UberImportRowError {
  line: number;
  uuid?: string;
  message: string;
}

export interface UberParsedPayment {
  line: number;
  driverUuid: string;
  firstName: string | null;
  lastName: string | null;
  reportDate: Date;
  amount: number;
  transactionUuid: string | null;
  description: string | null;
}

export interface UberImportResult {
  total: number;
  inserted: number;
  skipped: number;
  failed: number;
  errors: UberImportRowError[];
}

const UBER_HEADER_ALIASES: Record<
  string,
  'driverUuid' | 'firstName' | 'lastName' | 'reportDate' | 'amount' | 'transactionUuid' | 'description'
> = {
  uuid: 'driverUuid',
  'uuid do motorista': 'driverUuid',
  'uuid motorista': 'driverUuid',
  'driver uuid': 'driverUuid',
  nome: 'firstName',
  'nome proprio': 'firstName',
  'nome próprio': 'firstName',
  'nome proprio do motorista': 'firstName',
  'nome próprio do motorista': 'firstName',
  'first name': 'firstName',
  apelido: 'lastName',
  'apelido do motorista': 'lastName',
  'last name': 'lastName',
  data: 'reportDate',
  'versus relatorios': 'reportDate',
  'versus relatórios': 'reportDate',
  'data relatorio': 'reportDate',
  'data relatório': 'reportDate',
  valor: 'amount',
  'pago a si': 'amount',
  'paid to you': 'amount',
  'uuid da transacao': 'transactionUuid',
  'uuid da transação': 'transactionUuid',
  descricao: 'description',
  descrição: 'description',
};

function normalizeUberHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function guessUberFieldMapping(headers: string[]): Array<string> {
  return headers.map((header) => {
    const normalized = normalizeUberHeader(header);
    return UBER_HEADER_ALIASES[normalized] ?? '';
  });
}

function isZeroUuid(value: string): boolean {
  return value.replace(/-/g, '').replace(/0/g, '') === '';
}

function isSkippedUberRow(mapped: Record<string, string>): boolean {
  const description = mapped.description?.trim().toLowerCase() ?? '';
  if (description.includes('payout') || description.includes('so.payout')) return true;

  const driverUuid = mapped.driverUuid?.trim() ?? '';
  if (!driverUuid || isZeroUuid(driverUuid)) return true;

  return false;
}

export function parseUberCsv(csvText: string): {
  rows: UberParsedPayment[];
  errors: UberImportRowError[];
} {
  const rawRows = normalizeSpreadsheetRows(parseRawCsvRows(csvText));
  const errors: UberImportRowError[] = [];
  const rows: UberParsedPayment[] = [];

  if (rawRows.length < 2) {
    return { rows, errors: [{ line: 1, message: 'Ficheiro vazio ou sem dados' }] };
  }

  const headers = rawRows[0] ?? [];
  const columnMapping = guessUberFieldMapping(headers);

  const requiredFields = ['driverUuid', 'reportDate', 'amount'] as const;
  for (const field of requiredFields) {
    if (!columnMapping.includes(field)) {
      const labels: Record<(typeof requiredFields)[number], string> = {
        driverUuid: 'UUID',
        reportDate: 'Data',
        amount: 'Valor',
      };
      return {
        rows,
        errors: [{ line: 1, message: `Coluna obrigatória em falta: ${labels[field]}` }],
      };
    }
  }

  const seenKeys = new Set<string>();

  for (let index = 1; index < rawRows.length; index += 1) {
    const line = index + 1;
    const cells = rawRows[index] ?? [];
    if (cells.every((cell) => !cell.trim())) continue;

    const mapped: Record<string, string> = {};
    columnMapping.forEach((fieldKey, columnIndex) => {
      if (!fieldKey) return;
      mapped[fieldKey] = cells[columnIndex]?.trim() ?? '';
    });

    if (isSkippedUberRow(mapped)) continue;

    const driverUuid = mapped.driverUuid!.trim();
    const reportDate = parseSpreadsheetDateValue(mapped.reportDate);
    if (!reportDate) {
      errors.push({ line, uuid: driverUuid, message: 'Data inválida' });
      continue;
    }

    const amount = parseImportMoney(mapped.amount);
    if (amount == null) {
      errors.push({ line, uuid: driverUuid, message: 'Valor inválido' });
      continue;
    }

    const dedupeKey = `${driverUuid}|${reportDate.toISOString()}|${amount.toFixed(2)}`;
    if (seenKeys.has(dedupeKey)) {
      errors.push({ line, uuid: driverUuid, message: 'Duplicado no ficheiro' });
      continue;
    }
    seenKeys.add(dedupeKey);

    rows.push({
      line,
      driverUuid,
      firstName: mapped.firstName?.trim() || null,
      lastName: mapped.lastName?.trim() || null,
      reportDate,
      amount,
      transactionUuid: mapped.transactionUuid?.trim() || null,
      description: mapped.description?.trim() || null,
    });
  }

  return { rows, errors };
}

export function parseUberImportFileName(filename: string): boolean {
  const name = filename.toLowerCase();
  return name.endsWith('.csv') || name.endsWith('.txt');
}
