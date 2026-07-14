import { prisma } from '@tvde/database';
import { FINAL_CONSUMER_VAT } from './billing-entity.service';

function normalizeVat(vat: string | null | undefined): string {
  if (!vat) return '';
  return vat.replace(/\s/g, '').toUpperCase();
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

export function billingEntityDedupeKey(input: {
  entityType: string;
  vat: string | null;
  name: string;
}): string {
  const vat = normalizeVat(input.vat);
  const name = normalizeName(input.name);
  if (vat === FINAL_CONSUMER_VAT || !vat) {
    return `${input.entityType}|${vat}|${name}`;
  }
  return `${input.entityType}|${vat}`;
}

export async function mergeBillingEntities(keeperId: string, duplicateId: string) {
  if (keeperId === duplicateId) return;

  await prisma.$transaction([
    prisma.invoice.updateMany({
      where: { billingEntityId: duplicateId },
      data: { billingEntityId: keeperId },
    }),
    prisma.calendarScheduledInvoice.updateMany({
      where: { billingEntityId: duplicateId },
      data: { billingEntityId: keeperId },
    }),
    prisma.billingSyncConflict.deleteMany({ where: { entityId: duplicateId } }),
    prisma.billingEntity.delete({ where: { id: duplicateId } }),
  ]);
}

function pickKeeperIndex(
  group: Array<{
    id: string;
    externalId: string | null;
    lastSyncedAt: Date | null;
    updatedAt: Date;
    _count: { invoices: number };
  }>,
  moloniExternalIds?: Set<string>
) {
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < group.length; i++) {
    const e = group[i];
    let score = 0;
    if (e.externalId && moloniExternalIds?.has(e.externalId)) score += 1000;
    else if (e.externalId) score += 100;
    score += e._count.invoices * 10;
    if (e.lastSyncedAt) score += 5;
    score += e.updatedAt.getTime() / 1_000_000_000_000;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

export async function dedupeBillingEntitiesInWorkspace(
  workspaceId: string,
  options?: { moloniExternalIds?: Set<string> }
) {
  const entities = await prisma.billingEntity.findMany({
    where: { workspaceId, status: 'active' },
    select: {
      id: true,
      entityType: true,
      name: true,
      vat: true,
      externalId: true,
      lastSyncedAt: true,
      updatedAt: true,
      _count: { select: { invoices: true } },
    },
  });

  const groups = new Map<string, typeof entities>();
  for (const entity of entities) {
    const key = billingEntityDedupeKey(entity);
    const list = groups.get(key) ?? [];
    list.push(entity);
    groups.set(key, list);
  }

  let merged = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const keeperIdx = pickKeeperIndex(group, options?.moloniExternalIds);
    const keeper = group[keeperIdx]!;

    for (let i = 0; i < group.length; i++) {
      if (i === keeperIdx) continue;
      await mergeBillingEntities(keeper.id, group[i]!.id);
      merged++;
    }
  }

  return { merged, groupsScanned: groups.size };
}
