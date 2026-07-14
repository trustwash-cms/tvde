import * as XLSX from 'xlsx';
import { parseRawCsvRows } from '@tvde/shared';

function cellToString(cell: unknown): string {
  if (cell == null) return '';
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'boolean') return cell ? '1' : '0';
  return String(cell).trim();
}

function normalizeRawRows(rows: unknown[][]): string[][] {
  const mapped = rows.map((row) => (Array.isArray(row) ? row : []).map(cellToString));
  while (mapped.length > 0 && mapped[mapped.length - 1]!.every((cell) => !cell.trim())) {
    mapped.pop();
  }
  return mapped;
}

export function isCatalogImportFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.csv') ||
    name.endsWith('.txt') ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsx')
  );
}

export async function parseCatalogImportFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text();
    return parseRawCsvRows(text);
  }

  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];

    const data = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
    }) as unknown[][];

    return normalizeRawRows(data);
  }

  throw new Error('Formato não suportado — use CSV, XLS ou XLSX');
}
