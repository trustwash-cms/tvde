import { parseImportMoney, parseRawCsvRows } from './csv-import';
import { normalizeSpreadsheetRows, parseSpreadsheetDateValue } from './spreadsheet-rows';

export const UBER_CSV_REQUIRED_COLUMNS = ['uuid', 'nome', 'apelido', 'data', 'valor'] as const;

/** Marcador em `description` para linhas do relatório «Pagamentos do motorista» (líquidos). */
export const UBER_DRIVER_NET_EARNINGS_DESCRIPTION = 'uber_driver_net_earnings';

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

export type UberCsvKind = 'payments_order' | 'payments_driver';

export interface ParseUberCsvOptions {
  periodStart?: Date;
  periodEnd?: Date;
  filename?: string;
}

const UBER_ORDER_HEADER_ALIASES: Record<
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

type DriverField =
  | 'driverUuid'
  | 'firstName'
  | 'lastName'
  | 'totalEarnings'
  | 'refundsExpenses'
  | 'netEarnings';

const UBER_DRIVER_HEADER_ALIASES: Record<string, DriverField> = {
  uuid: 'driverUuid',
  'uuid do motorista': 'driverUuid',
  'uuid motorista': 'driverUuid',
  'driver uuid': 'driverUuid',
  nome: 'firstName',
  'nome proprio': 'firstName',
  'nome próprio': 'firstName',
  'first name': 'firstName',
  'driver firstname': 'firstName',
  apelido: 'lastName',
  'last name': 'lastName',
  'driver surname': 'lastName',
  'rendimentos totais': 'totalEarnings',
  'total earnings': 'totalEarnings',
  'total earnings (local)': 'totalEarnings',
  'reembolsos e despesas': 'refundsExpenses',
  'refunds and expenses': 'refundsExpenses',
  'refunds & expenses': 'refundsExpenses',
  'rendimentos liquidos': 'netEarnings',
  'rendimentos líquidos': 'netEarnings',
  'net earnings': 'netEarnings',
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

function isZeroUuid(value: string): boolean {
  return value.replace(/-/g, '').replace(/0/g, '') === '';
}

function isSkippedUberOrderRow(mapped: Record<string, string>): boolean {
  const description = mapped.description?.trim().toLowerCase() ?? '';
  if (description.includes('payout') || description.includes('so.payout')) return true;
  const driverUuid = mapped.driverUuid?.trim() ?? '';
  if (!driverUuid || isZeroUuid(driverUuid)) return true;
  return false;
}

/** Detecta CSV «Pagamentos do motorista» (agregado) vs «Transação de pagamentos». */
export function detectUberCsvKind(headers: string[]): UberCsvKind {
  const normalized = headers.map(normalizeUberHeader);
  const hasNetOrTotals = normalized.some(
    (h) =>
      h.includes('rendimentos totais') ||
      h.includes('total earnings') ||
      h.includes('reembolsos e despesas') ||
      h.includes('refunds and expenses') ||
      h.includes('rendimentos liquidos') ||
      h.includes('net earnings')
  );
  const hasPaidToYou = normalized.some(
    (h) => h === 'pago a si' || h === 'paid to you' || h === 'valor'
  );
  const hasDate = normalized.some(
    (h) => h === 'data' || h.includes('versus relatorio') || h.includes('data relatorio')
  );
  if (hasNetOrTotals && !hasDate) return 'payments_driver';
  if (hasNetOrTotals && !hasPaidToYou) return 'payments_driver';
  return 'payments_order';
}

/**
 * Extrai YYYYMMDD-YYYYMMDD do nome típico Uber
 * (`20260817-20260822-payments_driver-…`).
 */
export function parseUberReportPeriodFromFilename(filename: string): {
  periodStart: Date;
  periodEnd: Date;
} | null {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const m = /^(\d{8})-(\d{8})[-_]/.exec(base.trim());
  if (!m?.[1] || !m?.[2]) return null;
  const toDate = (compact: string) => {
    const y = Number(compact.slice(0, 4));
    const mo = Number(compact.slice(4, 6));
    const d = Number(compact.slice(6, 8));
    if (!y || !mo || !d) return null;
    return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  };
  const periodStart = toDate(m[1]);
  const periodEnd = toDate(m[2]);
  if (!periodStart || !periodEnd) return null;
  return { periodStart, periodEnd };
}

export function isUberDriverNetEarningsRow(description: string | null | undefined): boolean {
  return (description ?? '').trim() === UBER_DRIVER_NET_EARNINGS_DESCRIPTION;
}

function parseDriverPaymentsCsv(
  rawRows: string[][],
  options?: ParseUberCsvOptions
): { rows: UberParsedPayment[]; errors: UberImportRowError[] } {
  const errors: UberImportRowError[] = [];
  const rows: UberParsedPayment[] = [];
  const headers = rawRows[0] ?? [];
  const columnMapping = headers.map((header) => {
    const normalized = normalizeUberHeader(header);
    return UBER_DRIVER_HEADER_ALIASES[normalized] ?? '';
  });

  if (!columnMapping.includes('driverUuid')) {
    return {
      rows,
      errors: [{ line: 1, message: 'Coluna obrigatória em falta: UUID do motorista' }],
    };
  }
  const hasNet = columnMapping.includes('netEarnings');
  const hasTotals = columnMapping.includes('totalEarnings');
  if (!hasNet && !hasTotals) {
    return {
      rows,
      errors: [
        {
          line: 1,
          message:
            'Coluna obrigatória em falta: Rendimentos líquidos ou Rendimentos totais (Pagamentos do motorista)',
        },
      ],
    };
  }

  const fromName = options?.filename
    ? parseUberReportPeriodFromFilename(options.filename)
    : null;
  const periodStart = options?.periodStart ?? fromName?.periodStart ?? null;
  const periodEnd = options?.periodEnd ?? fromName?.periodEnd ?? null;
  if (!periodStart) {
    return {
      rows,
      errors: [
        {
          line: 1,
          message:
            'Relatório «Pagamentos do motorista» sem datas no nome do ficheiro — indique o período',
        },
      ],
    };
  }

  const seenKeys = new Set<string>();
  const endCompact = (periodEnd ?? periodStart).toISOString().slice(0, 10).replace(/-/g, '');
  const startCompact = periodStart.toISOString().slice(0, 10).replace(/-/g, '');

  for (let index = 1; index < rawRows.length; index += 1) {
    const line = index + 1;
    const cells = rawRows[index] ?? [];
    if (cells.every((cell) => !cell.trim())) continue;

    const mapped: Partial<Record<DriverField, string>> = {};
    columnMapping.forEach((fieldKey, columnIndex) => {
      if (!fieldKey) return;
      mapped[fieldKey as DriverField] = cells[columnIndex]?.trim() ?? '';
    });

    const driverUuid = mapped.driverUuid?.trim() ?? '';
    if (!driverUuid || isZeroUuid(driverUuid)) continue;

    const netDirect = mapped.netEarnings ? parseImportMoney(mapped.netEarnings) : null;
    const total = mapped.totalEarnings ? parseImportMoney(mapped.totalEarnings) : null;
    const refunds = mapped.refundsExpenses ? parseImportMoney(mapped.refundsExpenses) : null;

    let amount: number | null = netDirect;
    if (amount == null && total != null) {
      amount = total + (refunds ?? 0);
    }
    if (amount == null) {
      errors.push({ line, uuid: driverUuid, message: 'Valor de rendimentos inválido' });
      continue;
    }

    const dedupeKey = `${driverUuid}|${startCompact}|${endCompact}|${amount.toFixed(2)}`;
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
      reportDate: periodStart,
      amount,
      transactionUuid: `driver-net:${driverUuid}:${startCompact}:${endCompact}`,
      description: UBER_DRIVER_NET_EARNINGS_DESCRIPTION,
    });
  }

  return { rows, errors };
}

function parseOrderPaymentsCsv(rawRows: string[][]): {
  rows: UberParsedPayment[];
  errors: UberImportRowError[];
} {
  const errors: UberImportRowError[] = [];
  const rows: UberParsedPayment[] = [];
  const headers = rawRows[0] ?? [];
  const columnMapping = headers.map((header) => {
    const normalized = normalizeUberHeader(header);
    return UBER_ORDER_HEADER_ALIASES[normalized] ?? '';
  });

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

    if (isSkippedUberOrderRow(mapped)) continue;

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

export function parseUberCsv(
  csvText: string,
  options?: ParseUberCsvOptions
): {
  rows: UberParsedPayment[];
  errors: UberImportRowError[];
  kind: UberCsvKind;
} {
  const rawRows = normalizeSpreadsheetRows(parseRawCsvRows(csvText));

  if (rawRows.length < 2) {
    return {
      rows: [],
      errors: [{ line: 1, message: 'Ficheiro vazio ou sem dados' }],
      kind: 'payments_order',
    };
  }

  const headers = rawRows[0] ?? [];
  const kind = detectUberCsvKind(headers);
  if (kind === 'payments_driver') {
    const parsed = parseDriverPaymentsCsv(rawRows, options);
    return { ...parsed, kind };
  }
  const parsed = parseOrderPaymentsCsv(rawRows);
  return { ...parsed, kind };
}

export function parseUberImportFileName(filename: string): boolean {
  const name = filename.toLowerCase();
  return name.endsWith('.csv') || name.endsWith('.txt');
}
