import { prisma, Prisma } from '@tvde/database';
import type {
  MoloniCustomerRow,
  MoloniDocumentRow,
  MoloniDocumentTypeId,
  MoloniSupplierRow,
} from '@tvde/billing';
import { BILLING_DOCUMENT_TYPES } from '@tvde/shared';
import { ensureMoloniAccessToken } from './moloni-connection.service';
import { unlinkEntitiesNotInMoloniSet } from './billing-moloni-reset.service';
import {
  upsertEntityFromMoloniCustomer,
  upsertEntityFromMoloniSupplier,
  findBillingEntityForMoloniImport,
} from './billing-entity.service';
import { dedupeBillingEntitiesInWorkspace } from './billing-entity-dedupe.service';

const PAGE_SIZE = 50;

function formatMoloniDocumentNumber(
  doc: MoloniDocumentRow,
  externalId: string,
  documentType: string
): string {
  const base =
    doc.number != null && String(doc.number).trim() !== ''
      ? String(doc.number).trim()
      : externalId;
  return `${documentType}-${base}`;
}

async function ensureUniqueInvoiceNumber(
  workspaceId: string,
  desired: string,
  excludeInvoiceId?: string
): Promise<string> {
  let candidate = desired;
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await prisma.invoice.findFirst({
      where: {
        workspaceId,
        number: candidate,
        ...(excludeInvoiceId ? { NOT: { id: excludeInvoiceId } } : {}),
      },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${desired}~${attempt + 2}`;
  }
  return `${desired}-${Date.now()}`;
}

/** Moloni: gross_value = ilíquido, net_value = total c/ IVA */
function documentTotals(doc: MoloniDocumentRow) {
  const subtotal = Number(doc.gross_value ?? 0);
  const vatAmount = Number(doc.taxes_value ?? 0);
  const total = Number(
    doc.net_value ?? (subtotal > 0 || vatAmount > 0 ? subtotal + vatAmount : 0)
  );
  return { subtotal, vatAmount, total };
}

function normalizeMoloniList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data;
  return [];
}

type MoloniPagedRow = {
  customer_id?: number;
  document_id?: number;
  supplier_id?: number;
};

function moloniRowKey(row: MoloniPagedRow): number {
  return row.document_id ?? row.customer_id ?? row.supplier_id ?? 0;
}

/**
 * Moloni usa `offset` como índice de página (0, 1, 2…), não como skip de registos.
 * Páginas sobrepostas — deduplicamos por ID.
 */
async function fetchAllMoloniPages<T extends MoloniPagedRow>(
  fetchPage: (pageIndex: number) => Promise<unknown>
): Promise<T[]> {
  const byId = new Map<number, T>();
  let page = 0;
  for (;;) {
    const batch = normalizeMoloniList<T>(await fetchPage(page));
    if (!batch.length) break;
    for (const item of batch) {
      const key = moloniRowKey(item);
      if (key) byId.set(key, item);
    }
    if (batch.length < PAGE_SIZE) break;
    page++;
  }
  return [...byId.values()];
}

export type MoloniSyncOptions = {
  /** Restaura entidades arquivadas que ainda existem no Moloni (import manual). Cron: false. */
  restoreArchived?: boolean;
};

export async function syncEntitiesFromMoloni(
  workspaceId: string,
  tenantId: string,
  options?: MoloniSyncOptions
) {
  const restoreArchived = options?.restoreArchived ?? false;
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  const customers = await fetchAllMoloniPages<MoloniCustomerRow>((page) =>
    moloniClient.getAllCustomers(row.companyId!, page, PAGE_SIZE)
  );
  let suppliers: MoloniSupplierRow[] = [];
  try {
    suppliers = await fetchAllMoloniPages<MoloniSupplierRow>((page) =>
      moloniClient.getAllSuppliers(row.companyId!, page, PAGE_SIZE)
    );
  } catch {
    suppliers = [];
  }

  let customerCount = 0;
  let supplierCount = 0;
  let pendingConfirm = 0;
  let skippedArchived = 0;
  let restored = 0;

  for (const c of customers) {
    const { entity, restored: wasRestored } = await upsertEntityFromMoloniCustomer(
      c,
      workspaceId,
      tenantId,
      { restoreArchived }
    );
    if (wasRestored) restored++;
    if (entity.status === 'archived') {
      skippedArchived++;
      continue;
    }
    customerCount++;
    if (entity.linkStatus === 'pending_confirm') pendingConfirm++;
  }

  for (const s of suppliers) {
    const { entity, restored: wasRestored } = await upsertEntityFromMoloniSupplier(
      s,
      workspaceId,
      tenantId,
      { restoreArchived }
    );
    if (wasRestored) restored++;
    if (entity.status === 'archived') {
      skippedArchived++;
      continue;
    }
    supplierCount++;
  }

  const moloniExternalIds = new Set([
    ...customers.map((c) => String(c.customer_id)),
    ...suppliers.map((s) => String(s.supplier_id)),
  ]);
  const stale = await unlinkEntitiesNotInMoloniSet(workspaceId, moloniExternalIds);
  const deduped = await dedupeBillingEntitiesInWorkspace(workspaceId, {
    moloniExternalIds,
  });

  return {
    customers: customerCount,
    suppliers: supplierCount,
    pendingConfirm,
    skippedArchived,
    restored,
    moloniCustomers: customers.length,
    moloniSuppliers: suppliers.length,
    staleUnlinked: stale.unlinked,
    duplicatesMerged: deduped.merged,
  };
}

export async function syncAllFromMoloni(workspaceId: string, tenantId: string) {
  const entities = await syncEntitiesFromMoloni(workspaceId, tenantId, { restoreArchived: false });
  const catalog = await syncCatalogFromMoloni(workspaceId);
  const documents = await syncDocumentsFromMoloni(workspaceId, tenantId);
  return { entities, catalog, documents };
}

export async function syncCatalogFromMoloni(workspaceId: string) {
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  const documentSets = await moloniClient.getDocumentSets(row.companyId);
  const taxes = await moloniClient.getTaxes(row.companyId);
  const now = new Date();

  for (const ds of documentSets) {
    await prisma.billingCatalogItem.upsert({
      where: {
        workspaceId_catalogType_externalId: {
          workspaceId,
          catalogType: 'document_set',
          externalId: String(ds.document_set_id),
        },
      },
      create: {
        workspaceId,
        catalogType: 'document_set',
        externalId: String(ds.document_set_id),
        label: ds.name,
        dataJson: ds as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      },
      update: {
        label: ds.name,
        dataJson: ds as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      },
    });
  }

  for (const tax of taxes) {
    await prisma.billingCatalogItem.upsert({
      where: {
        workspaceId_catalogType_externalId: {
          workspaceId,
          catalogType: 'tax',
          externalId: String(tax.tax_id),
        },
      },
      create: {
        workspaceId,
        catalogType: 'tax',
        externalId: String(tax.tax_id),
        label: `${tax.name} (${tax.value}%)`,
        dataJson: tax as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      },
      update: {
        label: `${tax.name} (${tax.value}%)`,
        dataJson: tax as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      },
    });
  }

  return { documentSets: documentSets.length, taxes: taxes.length };
}

async function resolveBillingEntityForDocument(
  doc: MoloniDocumentRow,
  workspaceId: string,
  tenantId: string
) {
  if (!doc.customer_id) return null;

  const externalId = String(doc.customer_id);
  const existing = await findBillingEntityForMoloniImport({
    workspaceId,
    entityType: 'customer',
    externalId,
    vat: doc.entity_vat,
    name: doc.entity_name?.trim() ?? '',
  });
  if (existing) return existing;

  if (!doc.entity_name?.trim()) return null;

  return prisma.billingEntity.create({
    data: {
      tenantId,
      workspaceId,
      entityType: 'customer',
      provider: 'moloni',
      externalId,
      name: doc.entity_name.trim(),
      vat: doc.entity_vat?.trim() || null,
      linkStatus: 'unlinked',
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      moloniPayloadJson: {
        customer_id: doc.customer_id,
        name: doc.entity_name,
        vat: doc.entity_vat,
      } as Prisma.InputJsonValue,
    },
  });
}

export async function syncDocumentsFromMoloni(workspaceId: string, tenantId: string) {
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  let imported = 0;
  let skipped = 0;
  let updated = 0;
  let moloniDocuments = 0;

  let moloniInvoiceCount: number | null = null;
  try {
    const countRes = await moloniClient.getInvoiceCount(row.companyId);
    moloniInvoiceCount = Number(countRes.count);
  } catch {
    moloniInvoiceCount = null;
  }

  for (const docType of BILLING_DOCUMENT_TYPES) {
    const moloniType = docType.id as MoloniDocumentTypeId;
    const documents: MoloniDocumentRow[] = await fetchAllMoloniPages<MoloniDocumentRow>((page) =>
      moloniClient.getAllDocuments(moloniType, row.companyId!, page, PAGE_SIZE)
    );
    moloniDocuments += documents.length;

    for (const doc of documents) {
      const externalId = String(doc.document_id);
      const { subtotal, vatAmount, total } = documentTotals(doc);
      const number = await ensureUniqueInvoiceNumber(
        workspaceId,
        formatMoloniDocumentNumber(doc, externalId, moloniType)
      );

      const existing = await prisma.invoice.findFirst({
        where: {
          workspaceId,
          externalId,
          provider: 'moloni',
          documentType: moloniType,
        },
      });
      if (existing) {
        const safeNumber = await ensureUniqueInvoiceNumber(
          workspaceId,
          formatMoloniDocumentNumber(doc, externalId, moloniType),
          existing.id
        );
        await prisma.invoice.update({
          where: { id: existing.id },
          data: {
            subtotal,
            vatAmount,
            total,
            number: safeNumber,
            issuedAt: doc.date ? new Date(doc.date) : existing.issuedAt,
          },
        });
        updated++;
        continue;
      }

      const numberForCreate = await ensureUniqueInvoiceNumber(
        workspaceId,
        formatMoloniDocumentNumber(doc, externalId, moloniType)
      );

      let billingEntityId: string | null = null;
      let clientId: string | null = null;

      const entity = await resolveBillingEntityForDocument(doc, workspaceId, tenantId);
      if (entity) {
        billingEntityId = entity.id;
        clientId = entity.cmsClientId;
      }

      if (!billingEntityId) {
        skipped++;
        continue;
      }

      await prisma.invoice.create({
        data: {
          tenantId,
          workspaceId,
          clientId,
          billingEntityId,
          number: numberForCreate,
          status: 'issued',
          provider: 'moloni',
          documentType: moloniType,
          entityType: 'customer',
          externalId,
          subtotal,
          vatAmount,
          total,
          issuedAt: doc.date ? new Date(doc.date) : new Date(),
        },
      });
      imported++;
    }
  }

  return { imported, updated, skipped, moloniDocuments, moloniInvoiceCount };
}

export async function listCatalogItems(workspaceId: string, catalogType?: string) {
  return prisma.billingCatalogItem.findMany({
    where: {
      workspaceId,
      ...(catalogType ? { catalogType } : {}),
    },
    orderBy: { label: 'asc' },
  });
}
