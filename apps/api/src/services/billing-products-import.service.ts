import {
  CATALOG_IMPORT_MAX_ROWS,
  type CatalogImportResult,
  parseCatalogImportCsv,
} from '@tvde/shared';
import { createMoloniProduct, getProductFormOptions } from './billing-products.service';
import {
  parseCatalogImportRow,
  resolveImportTaxId,
  resolveImportUnitId,
} from './catalog-import.service';

export async function importMoloniProductsFromCsv(
  workspaceId: string,
  categoryId: number,
  csvText: string
): Promise<CatalogImportResult> {
  const rows = parseCatalogImportCsv(csvText);
  if (!rows.length) {
    throw new Error('Ficheiro CSV vazio ou sem linhas de dados');
  }
  if (rows.length > CATALOG_IMPORT_MAX_ROWS) {
    throw new Error(`Máximo de ${CATALOG_IMPORT_MAX_ROWS} linhas por importação`);
  }

  const options = await getProductFormOptions(workspaceId);
  const defaultTaxId = resolveImportTaxId('23', options.taxes);
  const defaultUnitId = resolveImportUnitId('un', options.units, options.units[0]?.unit_id);

  const result: CatalogImportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  for (let index = 0; index < rows.length; index += 1) {
    const line = index + 2;
    const raw = rows[index]!;
    try {
      const parsed = parseCatalogImportRow(raw, line);
      await createMoloniProduct(workspaceId, {
        categoryId,
        type: parsed.type ?? 2,
        name: parsed.name,
        reference: parsed.reference,
        price: parsed.price,
        unitId: resolveImportUnitId(raw.unidade, options.units, defaultUnitId) ?? defaultUnitId ?? 1,
        taxId: resolveImportTaxId(raw.iva, options.taxes, defaultTaxId),
        ean: parsed.ean,
        summary: parsed.summary,
        notes: parsed.notes,
        posFavorite: parsed.posFavorite,
        active: parsed.active,
      });
      result.created += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        line,
        reference: raw.referencia,
        message: err instanceof Error ? err.message : 'Erro ao importar linha',
      });
    }
  }

  return result;
}
