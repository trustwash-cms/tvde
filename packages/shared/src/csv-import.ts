import { formatExVatInput, priceIncVatToExVat, roundExVat } from './vat-pricing';

export const CATALOG_IMPORT_MAX_ROWS = 500;

export const CATALOG_IMPORT_IGNORE = '__ignore__';

export interface CatalogImportFieldOption {
  key: string;
  label: string;
  required?: boolean;
}

export const CATALOG_IMPORT_FIELD_OPTIONS: CatalogImportFieldOption[] = [
  { key: CATALOG_IMPORT_IGNORE, label: 'Ignorar' },
  { key: 'referencia', label: 'Referência', required: true },
  { key: 'designacao', label: 'Designação', required: true },
  { key: 'preco', label: 'Preço s/ IVA' },
  { key: 'pvp', label: 'PVP / Preço c/ IVA' },
  { key: 'iva', label: 'IVA (taxa ou código)' },
  { key: 'unidade', label: 'Unidade' },
  { key: 'ean', label: 'EAN' },
  { key: 'resumo', label: 'Resumo' },
  { key: 'observacoes', label: 'Observações' },
  { key: 'activo', label: 'Activo (sim/não)' },
  { key: 'favorito_pos', label: 'Favorito no POS' },
  { key: 'tipo', label: 'Tipo Moloni (1-4)' },
];

export interface CatalogImportRowError {
  line: number;
  reference?: string;
  message: string;
}

export interface CatalogImportResult {
  created: number;
  updated: number;
  failed: number;
  errors: CatalogImportRowError[];
}

export const CATALOG_IMPORT_TEMPLATE_HEADERS = [
  'referencia',
  'designacao',
  'preco',
  'iva',
  'unidade',
  'ean',
  'resumo',
  'observacoes',
  'activo',
  'favorito_pos',
  'tipo',
] as const;

export const CATALOG_IMPORT_MAPPABLE_FIELDS = [...CATALOG_IMPORT_TEMPLATE_HEADERS, 'pvp'] as const;

const HEADER_ALIASES: Record<string, string> = {
  referencia: 'referencia',
  reference: 'referencia',
  ref: 'referencia',
  designacao: 'designacao',
  designação: 'designacao',
  name: 'designacao',
  nome: 'designacao',
  preco: 'preco',
  preço: 'preco',
  price: 'preco',
  'preco sem iva': 'preco',
  'preço sem iva': 'preco',
  pvp: 'pvp',
  'preco com iva': 'pvp',
  'preço com iva': 'pvp',
  'preco c/ iva': 'pvp',
  'preço c/ iva': 'pvp',
  'preco de venda ao publico': 'pvp',
  'preço de venda ao público': 'pvp',
  iva: 'iva',
  tax: 'iva',
  tax_id: 'iva',
  tax_rate: 'iva',
  unidade: 'unidade',
  unit: 'unidade',
  unit_id: 'unidade',
  ean: 'ean',
  resumo: 'resumo',
  summary: 'resumo',
  observacoes: 'observacoes',
  observações: 'observacoes',
  notes: 'observacoes',
  activo: 'activo',
  active: 'activo',
  favorito_pos: 'favorito_pos',
  pos_favorite: 'favorito_pos',
  favorito: 'favorito_pos',
  tipo: 'tipo',
  type: 'tipo',
};

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += '"';
      }
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      if (current.trim()) lines.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) lines.push(current);
  return lines;
}

function detectDelimiter(headerLine: string): ',' | ';' | '\t' {
  const counts = {
    ';': (headerLine.match(/;/g) ?? []).length,
    ',': (headerLine.match(/,/g) ?? []).length,
    '\t': (headerLine.match(/\t/g) ?? []).length,
  };
  if (counts[';'] >= counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[',']) return '\t';
  return ',';
}

function parseCsvRow(line: string, delimiter: ',' | ';' | '\t'): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeHeader(value: string): string {
  let key = stripAccents(value.trim().toLowerCase());
  key = key.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return HEADER_ALIASES[key] ?? key;
}

export function parseRawCsvRows(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];

  const lines = splitCsvLines(cleaned);
  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]!);
  return lines.map((line) => parseCsvRow(line, delimiter));
}

export function guessCatalogFieldMapping(columnLabels: string[]): string[] {
  const used = new Set<string>();

  return columnLabels.map((label) => {
    const normalized = normalizeHeader(label);
    if (!normalized || normalized === CATALOG_IMPORT_IGNORE) {
      return CATALOG_IMPORT_IGNORE;
    }

    const isKnownField = (CATALOG_IMPORT_MAPPABLE_FIELDS as readonly string[]).includes(normalized);
    if (!isKnownField) return CATALOG_IMPORT_IGNORE;
    if (used.has(normalized)) return CATALOG_IMPORT_IGNORE;

    used.add(normalized);
    return normalized;
  });
}

export function getCatalogImportColumnCount(rows: string[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

export function padCatalogImportRows(rows: string[][], columnCount: number): string[][] {
  return rows.map((row) => {
    const padded = [...row];
    while (padded.length < columnCount) padded.push('');
    return padded.slice(0, columnCount);
  });
}

export function applyCatalogImportMapping(options: {
  rows: string[][];
  hasHeader: boolean;
  columnMapping: string[];
}): Array<Record<string, string>> {
  const { rows, hasHeader, columnMapping } = options;
  if (!rows.length) return [];

  const columnCount = getCatalogImportColumnCount(rows);
  const paddedRows = padCatalogImportRows(rows, columnCount);
  const dataRows = hasHeader ? paddedRows.slice(1) : paddedRows;
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

function escapeCatalogCsvCell(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function resolveImportExVatPrice(
  row: Record<string, string>,
  defaultVatRate = 23
): number | null {
  const vatRate = parseImportPercent(row.iva) ?? defaultVatRate;
  const pvp = row.pvp?.trim() ? parseImportMoney(row.pvp) : null;
  const preco = row.preco?.trim() ? parseImportMoney(row.preco) : null;

  if (pvp != null) {
    return priceIncVatToExVat(pvp, vatRate);
  }
  if (preco != null) {
    return roundExVat(preco);
  }
  return null;
}

export function normalizeCatalogImportRow(
  row: Record<string, string>,
  defaultVatRate = 23
): Record<string, string> {
  const vatRate = parseImportPercent(row.iva) ?? defaultVatRate;
  const price = resolveImportExVatPrice(row, defaultVatRate);

  const next: Record<string, string> = { ...row };
  if (price != null) {
    next.preco = formatExVatInput(price);
  }
  if (row.iva?.trim()) {
    next.iva = String(vatRate);
  }
  delete next.pvp;
  return next;
}

export function buildCatalogImportCsvFromRows(rows: Array<Record<string, string>>): string {
  const normalizedRows = rows.map((row) => normalizeCatalogImportRow(row));
  const headerLine = CATALOG_IMPORT_TEMPLATE_HEADERS.join(';');
  const dataLines = normalizedRows.map((row) =>
    CATALOG_IMPORT_TEMPLATE_HEADERS.map((header) => escapeCatalogCsvCell(row[header] ?? '')).join(';')
  );
  return [headerLine, ...dataLines].join('\n');
}

export function validateCatalogImportMapping(columnMapping: string[]): string | null {
  const mapped = columnMapping.filter((key) => key && key !== CATALOG_IMPORT_IGNORE);
  if (!mapped.length) return 'Mapeie pelo menos uma coluna';

  for (const field of CATALOG_IMPORT_FIELD_OPTIONS) {
    if (!field.required) continue;
    if (!mapped.includes(field.key)) {
      return `Mapeie a coluna obrigatória: ${field.label}`;
    }
  }

  if (!mapped.includes('preco') && !mapped.includes('pvp')) {
    return 'Mapeie Preço s/ IVA ou PVP / Preço c/ IVA';
  }

  const duplicates = mapped.filter((key, index) => mapped.indexOf(key) !== index);
  if (duplicates.length) {
    const field = CATALOG_IMPORT_FIELD_OPTIONS.find((option) => option.key === duplicates[0]);
    return `A coluna «${field?.label ?? duplicates[0]}» está mapeada mais do que uma vez`;
  }

  return null;
}

export function parseCatalogImportCsv(text: string): Array<Record<string, string>> {
  const rawRows = parseRawCsvRows(text);
  if (!rawRows.length) return [];

  const columnCount = getCatalogImportColumnCount(rawRows);
  const headerLabels = padCatalogImportRows([rawRows[0]!], columnCount)[0] ?? [];
  const columnMapping = guessCatalogFieldMapping(headerLabels);

  return applyCatalogImportMapping({
    rows: padCatalogImportRows(rawRows, columnCount),
    hasHeader: true,
    columnMapping,
  });
}

export function parseImportBoolean(value: string | undefined, defaultValue = true): boolean {
  if (value == null || value === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'sim', 's', 'yes', 'y', 'activo', 'ativo'].includes(normalized)) return true;
  if (['0', 'false', 'nao', 'não', 'n', 'no', 'inactivo', 'inativo'].includes(normalized)) return false;
  return defaultValue;
}

/** Parses monetary values — tolerates €, espaços, 1.234,56 e 12,20. */
export function parseImportMoney(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;

  let normalized = value
    .trim()
    .replace(/[€$£\u00a0\s]/gi, '')
    .replace(/%$/, '');

  if (!normalized) return null;

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseImportPercent(value: string | undefined): number | null {
  return parseImportMoney(value);
}

export function parseImportNumber(value: string | undefined): number | null {
  return parseImportMoney(value);
}

export function buildCatalogImportTemplateCsv(): string {
  return [
    CATALOG_IMPORT_TEMPLATE_HEADERS.join(';'),
    'REF001;Exemplo de serviço;25.00;23;un;;Descrição curta;;1;0;2',
  ].join('\n');
}

// ─── eCommerce loja (Fase 4b) ───────────────────────────────────────────────

export const ECOMMERCE_IMPORT_TEMPLATE_HEADERS = [
  'referencia',
  'designacao',
  'pvp',
  'stock',
  'preco_riscado',
  'resumo',
  'descricao',
  'categoria',
  'slug',
  'imagem_url',
  'estado',
  'ordem',
  'part_number',
  'ean',
  'garantia',
  'ficha_tecnica',
  'iva',
  'preco_sem_iva',
  'marca',
  'modelo',
  'caracteristicas',
  'destaque_home',
  'peso_g',
  'comprimento_cm',
  'largura_cm',
  'altura_cm',
] as const;

export const ECOMMERCE_IMPORT_MAPPABLE_FIELDS = [
  ...ECOMMERCE_IMPORT_TEMPLATE_HEADERS,
  'preco',
] as const;

export const ECOMMERCE_IMPORT_FIELD_OPTIONS: CatalogImportFieldOption[] = [
  { key: CATALOG_IMPORT_IGNORE, label: 'Ignorar' },
  { key: 'referencia', label: 'Referência / SKU', required: true },
  { key: 'designacao', label: 'Designação / Nome', required: true },
  { key: 'pvp', label: 'PVP / Preço' },
  { key: 'preco', label: 'Preço (alternativo)' },
  { key: 'stock', label: 'Stock' },
  { key: 'preco_riscado', label: 'Preço riscado' },
  { key: 'resumo', label: 'Resumo' },
  { key: 'descricao', label: 'Descrição' },
  { key: 'categoria', label: 'Categoria (nome ou slug)' },
  { key: 'slug', label: 'Slug URL' },
  { key: 'imagem_url', label: 'URL imagem' },
  { key: 'estado', label: 'Estado (publicado/rascunho)' },
  { key: 'ordem', label: 'Ordem' },
  { key: 'activo', label: 'Activo (sim/não)' },
  { key: 'part_number', label: 'Part-number' },
  { key: 'ean', label: 'Código EAN' },
  { key: 'garantia', label: 'Garantia (meses)' },
  { key: 'ficha_tecnica', label: 'Ficha técnica (Label: valor por linha ou separado por |)' },
  { key: 'iva', label: 'IVA (taxa %)' },
  { key: 'preco_sem_iva', label: 'Preço s/ IVA' },
  { key: 'marca', label: 'Marca (nome ou slug)' },
  { key: 'modelo', label: 'Modelo (nome ou slug)' },
  { key: 'caracteristicas', label: 'Características (HTML ou texto)' },
  { key: 'destaque_home', label: 'Destaque na home (sim/não)' },
  { key: 'peso_g', label: 'Peso (gramas)' },
  { key: 'comprimento_cm', label: 'Comprimento (cm)' },
  { key: 'largura_cm', label: 'Largura (cm)' },
  { key: 'altura_cm', label: 'Altura (cm)' },
];

const ECOMMERCE_HEADER_ALIASES: Record<string, string> = {
  stock: 'stock',
  stock_qty: 'stock',
  quantidade: 'stock',
  qty: 'stock',
  preco_riscado: 'preco_riscado',
  compare_at_price: 'preco_riscado',
  'preco anterior': 'preco_riscado',
  descricao: 'descricao',
  description: 'descricao',
  categoria: 'categoria',
  category: 'categoria',
  imagem_url: 'imagem_url',
  image_url: 'imagem_url',
  imagem: 'imagem_url',
  estado: 'estado',
  status: 'estado',
  ordem: 'ordem',
  sort_order: 'ordem',
  slug: 'slug',
  part_number: 'part_number',
  'part-number': 'part_number',
  'part number': 'part_number',
  partnumber: 'part_number',
  ean: 'ean',
  'codigo ean': 'ean',
  'código ean': 'ean',
  garantia: 'garantia',
  'garantia meses': 'garantia',
  warranty_months: 'garantia',
  ficha_tecnica: 'ficha_tecnica',
  'ficha tecnica': 'ficha_tecnica',
  'informacoes tecnicas': 'ficha_tecnica',
  'informações técnicas': 'ficha_tecnica',
  technical_specs: 'ficha_tecnica',
  preco_sem_iva: 'preco_sem_iva',
  'preco sem iva': 'preco_sem_iva',
  'preço sem iva': 'preco_sem_iva',
  marca: 'marca',
  brand: 'marca',
  modelo: 'modelo',
  model: 'modelo',
  caracteristicas: 'caracteristicas',
  características: 'caracteristicas',
  characteristics: 'caracteristicas',
  destaque_home: 'destaque_home',
  'destaque home': 'destaque_home',
  featured_on_home: 'destaque_home',
  peso_g: 'peso_g',
  peso: 'peso_g',
  weight: 'peso_g',
  'peso g': 'peso_g',
  'peso (g)': 'peso_g',
  comprimento_cm: 'comprimento_cm',
  comprimento: 'comprimento_cm',
  length: 'comprimento_cm',
  'comprimento (cm)': 'comprimento_cm',
  largura_cm: 'largura_cm',
  largura: 'largura_cm',
  width: 'largura_cm',
  'largura (cm)': 'largura_cm',
  altura_cm: 'altura_cm',
  altura: 'altura_cm',
  height: 'altura_cm',
  'altura (cm)': 'altura_cm',
};

function normalizeEcommerceHeader(value: string): string {
  let key = stripAccents(value.trim().toLowerCase());
  key = key.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (ECOMMERCE_HEADER_ALIASES[key]) return ECOMMERCE_HEADER_ALIASES[key];
  return HEADER_ALIASES[key] ?? key;
}

export function guessEcommerceFieldMapping(columnLabels: string[]): string[] {
  const used = new Set<string>();

  return columnLabels.map((label) => {
    const normalized = normalizeEcommerceHeader(label);
    if (!normalized || normalized === CATALOG_IMPORT_IGNORE) {
      return CATALOG_IMPORT_IGNORE;
    }

    const isKnownField = (ECOMMERCE_IMPORT_MAPPABLE_FIELDS as readonly string[]).includes(normalized);
    if (!isKnownField) return CATALOG_IMPORT_IGNORE;
    if (used.has(normalized)) return CATALOG_IMPORT_IGNORE;

    used.add(normalized);
    return normalized;
  });
}

export function validateEcommerceImportMapping(columnMapping: string[]): string | null {
  const mapped = columnMapping.filter((key) => key && key !== CATALOG_IMPORT_IGNORE);
  if (!mapped.length) return 'Mapeie pelo menos uma coluna';

  for (const field of ECOMMERCE_IMPORT_FIELD_OPTIONS) {
    if (!field.required) continue;
    if (!mapped.includes(field.key)) {
      return `Mapeie a coluna obrigatória: ${field.label}`;
    }
  }

  if (!mapped.includes('preco') && !mapped.includes('pvp')) {
    return 'Mapeie PVP / Preço ou Preço (alternativo)';
  }

  const duplicates = mapped.filter((key, index) => mapped.indexOf(key) !== index);
  if (duplicates.length) {
    const field = ECOMMERCE_IMPORT_FIELD_OPTIONS.find((option) => option.key === duplicates[0]);
    return `A coluna «${field?.label ?? duplicates[0]}» está mapeada mais do que uma vez`;
  }

  return null;
}

export function buildEcommerceImportCsvFromRows(rows: Array<Record<string, string>>): string {
  const headerLine = ECOMMERCE_IMPORT_TEMPLATE_HEADERS.join(';');
  const dataLines = rows.map((row) =>
    ECOMMERCE_IMPORT_TEMPLATE_HEADERS.map((header) => escapeCatalogCsvCell(row[header] ?? '')).join(';')
  );
  return [headerLine, ...dataLines].join('\n');
}

export function buildEcommerceImportTemplateCsv(): string {
  return [
    ECOMMERCE_IMPORT_TEMPLATE_HEADERS.join(';'),
    'SKU001;Trotinete exemplo;299.00;10;349.00;Resumo curto;Descrição completa;trotinetes;trotinete-exemplo;https://exemplo.pt/img.jpg;publicado;0;AA.05.18.01.0001;8721008535449;36;Potência máxima: 390 W|Autonomia: Até 25 km|Peso: 16,2 kg',
  ].join('\n');
}

/** Normaliza célula CSV de ficha técnica (linhas ou separador |). */
export function parseEcommerceImportTechnicalSpecs(raw: string | null | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  if (text.includes('|') && !text.includes('\n')) {
    return text
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n');
  }
  return text;
}

export function parseEcommerceImportCsv(text: string): Array<Record<string, string>> {
  const rawRows = parseRawCsvRows(text);
  if (!rawRows.length) return [];

  const columnCount = getCatalogImportColumnCount(rawRows);
  const headerLabels = padCatalogImportRows([rawRows[0]!], columnCount)[0] ?? [];
  const columnMapping = guessEcommerceFieldMapping(headerLabels);

  return applyCatalogImportMapping({
    rows: padCatalogImportRows(rawRows, columnCount),
    hasHeader: true,
    columnMapping,
  });
}

export function resolveEcommerceImportPrice(row: Record<string, string>): number | null {
  const pvp = row.pvp?.trim() ? parseImportMoney(row.pvp) : null;
  const preco = row.preco?.trim() ? parseImportMoney(row.preco) : null;
  if (pvp != null) return pvp;
  if (preco != null) return preco;
  return null;
}

export function parseEcommerceImportStatus(row: Record<string, string>): 'draft' | 'published' {
  const estado = row.estado?.trim().toLowerCase();
  if (estado) {
    if (['published', 'publicado', 'ativo', 'activo', 'live'].includes(estado)) return 'published';
    if (['draft', 'rascunho', 'inactivo', 'inativo'].includes(estado)) return 'draft';
  }
  return parseImportBoolean(row.activo, true) ? 'published' : 'draft';
}
