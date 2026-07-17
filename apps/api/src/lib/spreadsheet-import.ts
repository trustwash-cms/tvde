import * as XLSX from 'xlsx';
import { normalizeSpreadsheetRows, parseCsvTextToRows } from '@tvde/shared';

export function parseImportFileToRows(buffer: Buffer, filename: string): string[][] {
  const name = filename.toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return parseCsvTextToRows(buffer.toString('utf-8'));
  }

  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    // cellDates: true → serial Excel vira Date (evita "7/16/26" US do raw:false)
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];

    const data = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      // raw:true mantém Date → cellToImportString → YYYY-MM-DD (evita "7/16/26" US)
      raw: true,
      defval: '',
    }) as unknown[][];

    return normalizeSpreadsheetRows(data);
  }

  throw new Error('Formato não suportado — use CSV, XLS ou XLSX');
}

export function validateImportFilename(filename: string, allowed: string[]): void {
  const name = filename.toLowerCase();
  const ok = allowed.some((ext) => name.endsWith(ext));
  if (!ok) {
    throw new Error(`Formato inválido — use ${allowed.join(', ')}`);
  }
}
