import { parseRawCsvRows } from './csv-import';

export const SPREADSHEET_IMPORT_EXTENSIONS = ['.csv', '.txt', '.xls', '.xlsx'] as const;

export function cellToImportString(cell: unknown): string {
  if (cell == null) return '';
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'boolean') return cell ? '1' : '0';
  if (cell instanceof Date) {
    // Usar componentes LOCAIS (não UTC): serial Excel → Date em DST PT
    // dava 15/07 23:00Z para o dia 16/07 — ISO UTC trocava o dia.
    const y = cell.getFullYear();
    const m = String(cell.getMonth() + 1).padStart(2, '0');
    const d = String(cell.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(cell).trim();
}

export function normalizeSpreadsheetRows(rows: unknown[][]): string[][] {
  const mapped = rows.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => cellToImportString(cell))
  );

  while (mapped.length > 0 && mapped[mapped.length - 1]!.every((cell) => !cell.trim())) {
    mapped.pop();
  }

  return mapped;
}

export function stripImportAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeImportHeader(value: string): string {
  return stripImportAccents(value.replace(/^\uFEFF/, '').trim().toLowerCase())
    .replace(/[ºª]/g, '')
    .replace(/[./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findSpreadsheetHeaderRowIndex(
  rows: string[][],
  matcher: (normalizedCells: string[]) => boolean,
  maxScan = 20
): number {
  for (let index = 0; index < Math.min(rows.length, maxScan); index += 1) {
    const normalized = (rows[index] ?? []).map((cell) => normalizeImportHeader(cell));
    if (matcher(normalized)) return index;
  }
  return -1;
}

export function padSpreadsheetRows(rows: string[][]): string[][] {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (!columnCount) return rows;

  return rows.map((row) => {
    const padded = [...row];
    while (padded.length < columnCount) padded.push('');
    return padded.slice(0, columnCount);
  });
}

export function parseCsvTextToRows(csvText: string): string[][] {
  return normalizeSpreadsheetRows(parseRawCsvRows(csvText));
}

export function isSpreadsheetImportFilename(filename: string): boolean {
  const name = filename.toLowerCase();
  return SPREADSHEET_IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Converte serial Excel (dias desde 1899-12-30) para Date UTC. */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const fractionalDay = serial - Math.floor(serial);
  const totalSeconds = Math.round(utcValue + fractionalDay * 86400);
  const dt = new Date(totalSeconds * 1000);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function parseSpreadsheetDateValue(
  value: string | undefined,
  options?: { order?: 'dmy' | 'mdy' }
): Date | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const order = options?.order ?? 'dmy';

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    const fromSerial = excelSerialToDate(serial);
    if (fromSerial) return fromSerial;
  }

  // ISO date-only (vindo de cellToImportString com Date Excel)
  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const dt = new Date(
      parseInt(isoDateOnly[1]!, 10),
      parseInt(isoDateOnly[2]!, 10) - 1,
      parseInt(isoDateOnly[3]!, 10)
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const slashMatch = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (slashMatch) {
    let first = parseInt(slashMatch[1]!, 10);
    let secondNum = parseInt(slashMatch[2]!, 10);
    let year = parseInt(slashMatch[3]!, 10);
    if (year < 100) year += 2000;

    let day: number;
    let month: number;
    if (order === 'mdy') {
      // Excel Frota PRIO (raw:false / CSV): 7/16/26 = 16 Jul
      month = first;
      day = secondNum;
      if (month > 12 && day >= 1 && day <= 12) {
        month = secondNum;
        day = first;
      }
    } else {
      // PT / Electric: 16/7/26 = 16 Jul
      day = first;
      month = secondNum;
      if (month > 12 && day >= 1 && day <= 12) {
        day = secondNum;
        month = first;
      }
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const hour = slashMatch[4] ? parseInt(slashMatch[4], 10) : 0;
    const minute = slashMatch[5] ? parseInt(slashMatch[5], 10) : 0;
    const sec = slashMatch[6] ? parseInt(slashMatch[6], 10) : 0;
    const dt = new Date(year, month - 1, day, hour, minute, sec);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const isoWithTime = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?(?:\s+[+-]\d{4}(?:\s+\w+)?)?$/
  );
  if (isoWithTime) {
    const dt = new Date(
      parseInt(isoWithTime[1]!, 10),
      parseInt(isoWithTime[2]!, 10) - 1,
      parseInt(isoWithTime[3]!, 10),
      parseInt(isoWithTime[4]!, 10),
      parseInt(isoWithTime[5]!, 10),
      parseInt(isoWithTime[6]!, 10)
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const iso = new Date(trimmed);
  return Number.isNaN(iso.getTime()) ? null : iso;
}
