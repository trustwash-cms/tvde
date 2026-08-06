import { prisma } from '@tvde/database';
import type {
  InvoiceLineInput,
  MoloniDocumentSetRow,
  MoloniMeasurementUnitRow,
  MoloniProductRow,
  MoloniTaxRow,
} from '@tvde/billing';
import { resolveMoloniDocumentSetId } from '@tvde/billing';
import type { MoloniDocumentType } from '@tvde/shared';
import { CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY } from '@tvde/shared';
import { createMoloniProduct } from './billing-products.service';
import { ensureMoloniAccessToken, getBillingConnection } from './moloni-connection.service';

const DEFAULT_EXEMPTION_REASON = 'M07';

export const MISSING_DEFAULT_CATEGORY_MESSAGE =
  'Linha manual sem categoria Moloni — seleccione uma categoria por defeito em Configurações → Moloni';

export const EMPTY_CATEGORIES_MESSAGE =
  'Não há categorias Moloni nesta empresa — sincronize o catálogo ou crie categorias no Moloni, depois seleccione a categoria por defeito';

export const MISSING_PRODUCT_REFERENCE_MESSAGE =
  'Linha manual sem Ref.ª Artigo — indique um código curto (ex. SERV-01) ou seleccione um artigo existente do catálogo';

/** Normaliza a referência introduzida pelo utilizador (sem slugificar a descrição). */
export function normalizeProductReference(raw: string | undefined | null): string {
  return (raw ?? '').trim();
}

function isDuplicateReferenceError(message: string): boolean {
  return /refer[eê]ncia|reference|duplic|já exist|already exist|unique/i.test(message);
}

async function findProductByReference(
  moloniClient: Awaited<ReturnType<typeof ensureMoloniAccessToken>>['moloniClient'],
  companyId: number,
  reference: string,
  preferredCategoryId?: number | null
): Promise<MoloniProductRow | undefined> {
  const needle = reference.toLowerCase();

  const fromSearch = await moloniClient.searchProducts(companyId, reference, 0, 50);
  const exact =
    fromSearch.find((p) => (p.reference ?? '').toLowerCase() === needle) ??
    fromSearch.find((p) => (p.reference ?? '').toLowerCase() === needle.replace(/\s+/g, ''));
  if (exact?.product_id) return exact;

  if (preferredCategoryId != null) {
    const inCategory = await moloniClient.getAllProducts(
      companyId,
      preferredCategoryId,
      0,
      50,
      1
    );
    return inCategory.find((p) => (p.reference ?? '').toLowerCase() === needle);
  }

  return undefined;
}

/** Resolve categoria por defeito: BillingConnection, com fallback ao setting do calendário. */
export async function resolveDefaultProductCategoryId(workspaceId: string): Promise<number | null> {
  const connection = await getBillingConnection(workspaceId);
  if (connection?.defaultProductCategoryId != null) {
    return connection.defaultProductCategoryId;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { tenantId: true },
  });
  if (!workspace) return null;

  const categorySetting = await prisma.tenantSetting.findUnique({
    where: {
      tenantId_key: {
        tenantId: workspace.tenantId,
        key: CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY,
      },
    },
  });
  const fromSetting = categorySetting?.value ? Number(categorySetting.value) : NaN;
  return Number.isFinite(fromSetting) ? fromSetting : null;
}

export async function resolveMoloniInvoiceDefaults(
  workspaceId: string,
  documentType: MoloniDocumentType = 'invoice'
) {
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta na configuração');

  const sets = await moloniClient.getDocumentSets(row.companyId);
  const documentSetId = resolveMoloniDocumentSetId(
    sets as MoloniDocumentSetRow[],
    documentType,
    row.documentSetId
  );

  if (row.documentSetId !== documentSetId) {
    await prisma.billingConnection.update({
      where: { workspaceId },
      data: { documentSetId },
    });
  }

  const taxRow = await prisma.billingCatalogItem.findFirst({
    where: { workspaceId, catalogType: 'tax' },
    orderBy: { label: 'asc' },
  });
  let defaultTaxId = taxRow ? Number(taxRow.externalId) : undefined;
  if (!defaultTaxId || Number.isNaN(defaultTaxId)) {
    const taxes = await moloniClient.getTaxes(row.companyId);
    defaultTaxId = taxes.find((t: MoloniTaxRow) => t.value === 23)?.tax_id ?? taxes[0]?.tax_id;
  }

  const defaultCategoryId = await resolveDefaultProductCategoryId(workspaceId);

  if (!documentSetId) {
    throw new Error('Série documental Moloni em falta — configure em Definições → Moloni');
  }
  if (!defaultTaxId) {
    throw new Error('Imposto Moloni em falta — sincronize o catálogo de facturação em Configurações → Moloni');
  }

  return {
    documentSetId,
    defaultTaxId,
    defaultCategoryId,
  };
}

async function resolveMoloniTaxForVatRate(
  moloniClient: Awaited<ReturnType<typeof ensureMoloniAccessToken>>['moloniClient'],
  companyId: number,
  vatRate: number | undefined
) {
  const rate = vatRate ?? 23;
  const taxes = await moloniClient.getTaxes(companyId);
  const match =
    taxes.find((t: MoloniTaxRow) => t.value === rate) ??
    taxes.find((t: MoloniTaxRow) => t.value === 23) ??
    taxes[0];
  if (!match) throw new Error(`Imposto Moloni ${rate}% não encontrado — sincronize o catálogo`);

  return {
    taxId: match.tax_id,
    exemptionReason: match.value === 0 ? DEFAULT_EXEMPTION_REASON : undefined,
  };
}

/**
 * Moloni invoices/insert exige product_id em cada linha.
 * Linhas manuais: cria/reutiliza artigo na categoria por defeito com Ref.ª Artigo explícita
 * (nunca gera referência a partir da descrição).
 */
export async function enrichInvoiceLinesWithMoloniProducts<T extends InvoiceLineInput>(
  workspaceId: string,
  lines: T[]
): Promise<T[]> {
  const needsProduct = lines.some((l) => !l.moloniProductId);
  const { defaultCategoryId } = await resolveMoloniInvoiceDefaults(workspaceId);
  const { moloniClient, row } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  if (needsProduct) {
    if (defaultCategoryId == null) {
      const categories = await moloniClient.getAllProductCategories(row.companyId, 0, 0, 5);
      if (!categories.length) {
        throw new Error(EMPTY_CATEGORIES_MESSAGE);
      }
      throw new Error(MISSING_DEFAULT_CATEGORY_MESSAGE);
    }

    try {
      await moloniClient.getProductCategory(row.companyId, defaultCategoryId);
    } catch {
      throw new Error(
        'Categoria Moloni por defeito inválida ou removida — escolha outra em Configurações → Moloni'
      );
    }
  }

  const units = await moloniClient.getMeasurementUnits(row.companyId);
  const defaultUnitId =
    units.find((u: MoloniMeasurementUnitRow) => u.short_name === 'Uni')?.unit_id ??
    units[0]?.unit_id;
  if (!defaultUnitId) {
    throw new Error('Unidade de medida Moloni em falta — sincronize o catálogo em Configurações → Moloni');
  }

  const enriched: T[] = [];

  for (const line of lines) {
    const tax = line.moloniTaxId
      ? {
          taxId: line.moloniTaxId,
          exemptionReason:
            line.moloniExemptionReason ??
            ((line.vatRate ?? 23) === 0 ? DEFAULT_EXEMPTION_REASON : undefined),
        }
      : await resolveMoloniTaxForVatRate(moloniClient, row.companyId, line.vatRate);

    const taxId = tax.taxId;
    const exemptionReason = line.moloniExemptionReason ?? tax.exemptionReason;
    let productId = line.moloniProductId;
    let productReference = normalizeProductReference(line.productReference);

    if (!productId) {
      const description = line.description.trim();
      if (!description) {
        throw new Error('Linha de fatura sem descrição — preencha o nome do artigo');
      }

      if (!productReference) {
        throw new Error(
          `${MISSING_PRODUCT_REFERENCE_MESSAGE} (linha «${description.slice(0, 60)}»)`
        );
      }

      if (productReference.length > 30) {
        throw new Error(
          `Ref.ª Artigo demasiado longa («${productReference.slice(0, 40)}…») — use um código curto (máx. 30 caracteres)`
        );
      }

      const categoryId = defaultCategoryId!;
      const existing = await findProductByReference(
        moloniClient,
        row.companyId,
        productReference,
        categoryId
      );

      if (existing?.product_id) {
        productId = existing.product_id;
        productReference = existing.reference?.trim() || productReference;
      } else {
        try {
          const created = await createMoloniProduct(workspaceId, {
            categoryId,
            type: 2,
            name: description,
            reference: productReference,
            price: line.unitPrice,
            unitId: defaultUnitId,
            taxId,
            exemptionReason,
            hasStock: false,
            active: true,
          });
          productId = created.product_id;
          productReference = created.reference?.trim() || productReference;
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          if (/categor/i.test(raw) || /category/i.test(raw)) {
            throw new Error(MISSING_DEFAULT_CATEGORY_MESSAGE);
          }
          if (isDuplicateReferenceError(raw)) {
            const reused = await findProductByReference(
              moloniClient,
              row.companyId,
              productReference,
              categoryId
            );
            if (reused?.product_id) {
              productId = reused.product_id;
              productReference = reused.reference?.trim() || productReference;
            } else {
              throw new Error(
                `A Ref.ª Artigo «${productReference}» já existe no Moloni — escolha outro código ou seleccione o artigo existente`
              );
            }
          } else {
            throw new Error(
              `Falha ao criar artigo Moloni para a linha «${description}» (ref. ${productReference}): ${raw}`
            );
          }
        }
      }
    }

    enriched.push({
      ...line,
      moloniTaxId: taxId,
      moloniProductId: productId,
      productReference: productReference || line.productReference,
      moloniExemptionReason: exemptionReason,
    });
  }

  return enriched;
}
