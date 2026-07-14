import { prisma } from '@tvde/database';

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
      data: { documentSetId: null },
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
