import { prisma } from '@tvde/database';
import { isMoloniDemoCompany } from '@tvde/shared';
import { ensureMoloniAccessToken } from './moloni-connection.service';

export class MoloniDemoPurgeError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_demo' | 'not_connected' | 'no_company' = 'not_demo'
  ) {
    super(message);
    this.name = 'MoloniDemoPurgeError';
  }
}

export async function resolveMoloniCompanyName(workspaceId: string): Promise<{
  companyId: number | null;
  companyName: string | null;
  isDemoCompany: boolean;
}> {
  try {
    const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
    if (!row.companyId) {
      return { companyId: null, companyName: null, isDemoCompany: false };
    }
    const companies = await moloniClient.getCompanies();
    const company = companies.find((c) => c.company_id === row.companyId);
    const companyName = company?.name ?? null;
    return {
      companyId: row.companyId,
      companyName,
      isDemoCompany: isMoloniDemoCompany(companyName),
    };
  } catch {
    return { companyId: null, companyName: null, isDemoCompany: false };
  }
}

/**
 * Limpa artefactos locais de testes em modo demonstração Moloni.
 * Apaga documentos, catálogo local e entidades de facturação (clientes/fornecedores).
 * Não apaga dados na cloud Moloni; não desliga OAuth nem altera email/SMTP/série documental.
 * Limpa `default_product_category_id` (fica inválido após wipe do catálogo).
 */
export async function purgeMoloniDemoData(workspaceId: string) {
  const company = await resolveMoloniCompanyName(workspaceId);
  if (!company.companyId) {
    throw new MoloniDemoPurgeError(
      'Empresa Moloni não seleccionada — impossível confirmar modo demonstração.',
      'no_company'
    );
  }
  if (!company.isDemoCompany) {
    throw new MoloniDemoPurgeError(
      company.companyName
        ? `A empresa ligada («${company.companyName}») não é de demonstração. Esta acção só está disponível com uma empresa Moloni demo.`
        : 'A empresa Moloni ligada não é de demonstração. Esta acção só está disponível em modo demo.',
      'not_demo'
    );
  }

  const invoiceIds = (
    await prisma.invoice.findMany({
      where: { workspaceId },
      select: { id: true },
    })
  ).map((i) => i.id);

  if (invoiceIds.length > 0) {
    await prisma.adminMgmtFatura.updateMany({
      where: { workspaceId, billingInvoiceId: { in: invoiceIds } },
      data: { billingInvoiceId: null },
    });
  }

  const invoices = await prisma.invoice.deleteMany({ where: { workspaceId } });

  const catalog = await prisma.billingCatalogItem.deleteMany({ where: { workspaceId } });

  const linkedCmsClients = await prisma.billingEntity.findMany({
    where: { workspaceId, cmsClientId: { not: null } },
    select: { cmsClientId: true },
  });
  const cmsClientIds = linkedCmsClients
    .map((e) => e.cmsClientId)
    .filter((id): id is string => Boolean(id));
  if (cmsClientIds.length > 0) {
    await prisma.client.updateMany({
      where: { id: { in: cmsClientIds } },
      data: { externalCustomerId: null, billingProvider: null },
    });
  }

  await prisma.billingSyncConflict.deleteMany({ where: { workspaceId } });

  // Hard-delete: entidades de facturação (clientes/fornecedores) do workspace.
  // Cascata Prisma: calendar_scheduled_invoices; SetNull em carwash/admin_mgmt.
  // Não toca no módulo CRM «Clientes» (tabela clients), só limpa ligação de facturação.
  const entities = await prisma.billingEntity.deleteMany({ where: { workspaceId } });

  await prisma.billingConnection.updateMany({
    where: { workspaceId },
    data: { defaultProductCategoryId: null },
  });

  return {
    companyId: company.companyId,
    companyName: company.companyName,
    invoicesDeleted: invoices.count,
    catalogCleared: catalog.count,
    entitiesDeleted: entities.count,
    defaultProductCategoryCleared: true as const,
    moloniCloudUntouched: true as const,
  };
}

export async function unlinkStaleMoloniBillingData(
  workspaceId: string,
  options?: { clearCatalog?: boolean; resetDocumentSet?: boolean }
) {
  const entities = await prisma.billingEntity.updateMany({
    where: { workspaceId, externalId: { not: null } },
    data: {
      externalId: null,
      linkStatus: 'unlinked',
      syncStatus: 'local',
      lastSyncedAt: null,
      moloniUpdatedAt: null,
      moloniPayloadJson: {},
    },
  });

  let catalogCleared = 0;
  if (options?.clearCatalog !== false) {
    const catalog = await prisma.billingCatalogItem.deleteMany({ where: { workspaceId } });
    catalogCleared = catalog.count;
  }

  const conflicts = await prisma.billingSyncConflict.updateMany({
    where: { workspaceId, status: 'open' },
    data: { status: 'dismissed', resolution: 'company_changed', resolvedAt: new Date() },
  });

  let documentSetReset = false;
  if (options?.resetDocumentSet !== false) {
    await prisma.billingConnection.updateMany({
      where: { workspaceId },
      data: { documentSetId: null, defaultProductCategoryId: null },
    });
    documentSetReset = true;
  }

  return {
    entitiesUnlinked: entities.count,
    catalogCleared,
    conflictsDismissed: conflicts.count,
    documentSetReset,
  };
}

export async function unlinkEntitiesNotInMoloniSet(
  workspaceId: string,
  moloniExternalIds: Set<string>
) {
  const linked = await prisma.billingEntity.findMany({
    where: { workspaceId, externalId: { not: null } },
    select: { id: true, externalId: true },
  });

  const staleIds = linked
    .filter((e) => e.externalId && !moloniExternalIds.has(e.externalId))
    .map((e) => e.id);

  if (staleIds.length === 0) return { unlinked: 0 };

  const result = await prisma.billingEntity.updateMany({
    where: { id: { in: staleIds } },
    data: {
      externalId: null,
      linkStatus: 'unlinked',
      syncStatus: 'local',
      lastSyncedAt: null,
      moloniUpdatedAt: null,
    },
  });

  return { unlinked: result.count };
}

export async function resetMoloniBillingForCompanyChange(
  workspaceId: string,
  input: { previousCompanyId: number; newCompanyId: number }
) {
  if (input.previousCompanyId === input.newCompanyId) {
    return { skipped: true as const, reason: 'same_company' as const };
  }

  const reset = await unlinkStaleMoloniBillingData(workspaceId, {
    clearCatalog: true,
    resetDocumentSet: true,
  });

  return {
    skipped: false as const,
    previousCompanyId: input.previousCompanyId,
    newCompanyId: input.newCompanyId,
    ...reset,
  };
}
