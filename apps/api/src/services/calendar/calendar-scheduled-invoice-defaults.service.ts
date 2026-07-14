import { prisma } from '@tvde/database';
import type {
  MoloniDocumentSetRow,
  MoloniMeasurementUnitRow,
  MoloniProductCategoryRow,
  MoloniProductRow,
  MoloniTaxRow,
} from '@tvde/billing';
import { resolveMoloniDocumentSetId } from '@tvde/billing';
import type { CalendarScheduledInvoiceLine, MoloniDocumentType } from '@tvde/shared';
import { CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY } from '@tvde/shared';
import { createMoloniProduct, createProductCategory } from '../billing-products.service';
import { ensureMoloniAccessToken } from '../moloni-connection.service';

const DEFAULT_CATEGORY_NAME = 'CMS Autofatura';

function slugReference(text: string): string {
  const base = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .toUpperCase();
  return base ? `CMS-${base}` : `CMS-${Date.now()}`;
}

export async function resolveScheduledInvoiceMoloniDefaults(
  workspaceId: string,
  documentType: MoloniDocumentType = 'invoice'
) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { tenantId: true },
  });
  if (!workspace) throw new Error('Workspace não encontrado');

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

  const categorySetting = await prisma.tenantSetting.findUnique({
    where: {
      tenantId_key: {
        tenantId: workspace.tenantId,
        key: CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY,
      },
    },
  });

  let defaultCategoryId = categorySetting?.value ? Number(categorySetting.value) : undefined;

  if (!defaultCategoryId || Number.isNaN(defaultCategoryId)) {
    const categories = await moloniClient.getAllProductCategories(row.companyId, 0, 0, 50);
    const existing = categories.find(
      (c: MoloniProductCategoryRow) =>
        c.name?.toLowerCase() === DEFAULT_CATEGORY_NAME.toLowerCase()
    );
    if (existing?.category_id) {
      defaultCategoryId = existing.category_id;
    } else {
      const created = await createProductCategory(workspaceId, {
        parentId: 0,
        name: DEFAULT_CATEGORY_NAME,
        description: 'Artigos criados automaticamente pelo calendário CMS',
      });
      defaultCategoryId = created.category_id;
    }
  }

  if (!documentSetId) throw new Error('Série documental Moloni em falta — configure em Definições → Moloni');
  if (!defaultTaxId) throw new Error('Imposto Moloni em falta — sincronize o catálogo de facturação');

  return {
    documentSetId,
    defaultTaxId,
    defaultCategoryId: defaultCategoryId!,
  };
}

const DEFAULT_EXEMPTION_REASON = 'M07';

async function resolveMoloniTaxForVatRate(
  moloniClient: Awaited<ReturnType<typeof ensureMoloniAccessToken>>['moloniClient'],
  companyId: number,
  vatRate: number | undefined,
  fallbackTaxId: number
) {
  const rate = vatRate ?? 23;
  const taxes = await moloniClient.getTaxes(companyId);
  const match =
    taxes.find((t: MoloniTaxRow) => t.value === rate) ??
    taxes.find((t: MoloniTaxRow) => t.value === 23) ??
    taxes[0];
  if (!match) throw new Error(`Imposto Moloni ${rate}% não encontrado`);

  return {
    taxId: match.tax_id,
    exemptionReason: match.value === 0 ? DEFAULT_EXEMPTION_REASON : undefined,
  };
}

export async function enrichScheduledInvoiceLines(
  workspaceId: string,
  lines: CalendarScheduledInvoiceLine[]
): Promise<CalendarScheduledInvoiceLine[]> {
  const { defaultTaxId, defaultCategoryId } = await resolveScheduledInvoiceMoloniDefaults(workspaceId);
  const { moloniClient, row } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  const units = await moloniClient.getMeasurementUnits(row.companyId);
  const defaultUnitId =
    units.find((u: MoloniMeasurementUnitRow) => u.short_name === 'Uni')?.unit_id ??
    units[0]?.unit_id;
  if (!defaultUnitId) throw new Error('Unidade de medida Moloni em falta');

  const enriched: CalendarScheduledInvoiceLine[] = [];

  for (const line of lines) {
    const tax = line.moloniTaxId
      ? {
          taxId: line.moloniTaxId,
          exemptionReason:
            line.moloniExemptionReason ??
            ((line.vatRate ?? 23) === 0 ? DEFAULT_EXEMPTION_REASON : undefined),
        }
      : await resolveMoloniTaxForVatRate(
          moloniClient,
          row.companyId,
          line.vatRate,
          defaultTaxId
        );

    const taxId = tax.taxId;
    const exemptionReason =
      line.moloniExemptionReason ?? tax.exemptionReason;
    let productId = line.moloniProductId;

    if (!productId) {
      const reference = slugReference(line.description);
      const existing = await moloniClient
        .getAllProducts(row.companyId, defaultCategoryId, 0, 50, 1)
        .then((products: MoloniProductRow[]) =>
          products.find(
            (p: MoloniProductRow) =>
              p.reference === reference ||
              p.name.toLowerCase() === line.description.trim().toLowerCase()
          )
        );

      if (existing?.product_id) {
        productId = existing.product_id;
      } else {
        const created = await createMoloniProduct(workspaceId, {
          categoryId: defaultCategoryId,
          type: 2,
          name: line.description.trim(),
          reference,
          price: line.unitPrice,
          unitId: defaultUnitId,
          taxId,
          exemptionReason,
          hasStock: false,
          active: true,
        });
        productId = created.product_id;
      }
    }

    enriched.push({
      ...line,
      moloniTaxId: taxId,
      moloniProductId: productId,
      moloniExemptionReason: exemptionReason,
    });
  }

  return enriched;
}
