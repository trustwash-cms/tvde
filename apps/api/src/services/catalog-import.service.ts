import { parseImportBoolean, parseImportMoney, normalizeCatalogImportRow, resolveImportExVatPrice } from '@tvde/shared';

export interface TaxOption {
  tax_id: number;
  name?: string;
  value?: number;
}

export interface UnitOption {
  unit_id: number;
  name?: string;
  short_name?: string;
}

export interface ParsedCatalogImportRow {
  line: number;
  reference: string;
  name: string;
  price: number;
  taxId?: number;
  unitId?: number;
  ean?: string;
  summary?: string;
  notes?: string;
  active: boolean;
  posFavorite: boolean;
  type?: number;
}

export function resolveImportTaxId(
  raw: string | undefined,
  taxes: TaxOption[],
  fallbackTaxId?: number
): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return fallbackTaxId;

  const asNumber = parseImportMoney(trimmed);
  if (asNumber == null) return fallbackTaxId;

  if (Number.isInteger(asNumber) && asNumber > 0 && asNumber < 100) {
    const byId = taxes.find((tax) => tax.tax_id === asNumber);
    if (byId) return byId.tax_id;
  }

  const byRate = taxes.find((tax) => tax.value === asNumber);
  if (byRate) return byRate.tax_id;

  return fallbackTaxId;
}

export function resolveImportUnitId(
  raw: string | undefined,
  units: UnitOption[],
  fallbackUnitId?: number
): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return fallbackUnitId;

  const asNumber = parseImportMoney(trimmed);
  if (asNumber != null && Number.isInteger(asNumber)) {
    const byId = units.find((unit) => unit.unit_id === asNumber);
    if (byId) return byId.unit_id;
  }

  const needle = trimmed.toLowerCase();
  const byShort = units.find((unit) => unit.short_name?.toLowerCase() === needle);
  if (byShort) return byShort.unit_id;

  const byName = units.find((unit) => unit.name?.toLowerCase() === needle);
  if (byName) return byName.unit_id;

  return fallbackUnitId;
}

export function parseCatalogImportRow(
  row: Record<string, string>,
  line: number
): ParsedCatalogImportRow {
  const normalized = normalizeCatalogImportRow(row);
  const reference = normalized.referencia?.trim();
  const name = normalized.designacao?.trim();
  const price = resolveImportExVatPrice(normalized);

  if (!reference) throw new Error('Referência em falta');
  if (!name) throw new Error('Designação em falta');
  if (price == null || price < 0) throw new Error('Preço inválido');

  const typeRaw = parseImportMoney(normalized.tipo);
  const type =
    typeRaw != null && typeRaw >= 1 && typeRaw <= 4 ? Math.trunc(typeRaw) : undefined;

  return {
    line,
    reference,
    name,
    price,
    ean: normalized.ean?.trim() || undefined,
    summary: normalized.resumo?.trim() || undefined,
    notes: normalized.observacoes?.trim() || undefined,
    active: parseImportBoolean(normalized.activo, true),
    posFavorite: parseImportBoolean(normalized.favorito_pos, false),
    type,
  };
}
