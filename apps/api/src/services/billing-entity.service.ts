import { prisma, Prisma } from '@tvde/database';
import type { MoloniCustomerRow, MoloniSupplierRow } from '@tvde/billing';
import { ensureMoloniAccessToken } from './moloni-connection.service';

export type BillingEntityType = 'customer' | 'supplier';
export type EntityStatus = 'active' | 'archived';
export type LinkStatus = 'unlinked' | 'linked' | 'pending_confirm' | 'conflict';
export type SyncStatus = 'synced' | 'pending_push' | 'pending_pull';

const COMPARE_FIELDS = ['name', 'email', 'phone', 'vat'] as const;

function normalizeVat(vat: string | null | undefined): string | null {
  if (!vat) return null;
  const n = vat.replace(/\s/g, '').toUpperCase();
  return n || null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  return phone
    .replace(/(\+\d{1,3})\./g, '$1 ')
    .replace(/\.(?=\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function entityHasIssuedInvoices(entityId: string): Promise<boolean> {
  const count = await prisma.invoice.count({
    where: {
      billingEntityId: entityId,
      status: { in: ['issued', 'paid', 'cancelled'] },
    },
  });
  return count > 0;
}

function addressFromMoloni(row: { address?: string; city?: string; zip_code?: string }) {
  return {
    address: row.address ?? '',
    city: row.city ?? '',
    zipCode: row.zip_code ?? '',
  };
}

async function mirrorExternalIdToClient(cmsClientId: string, externalId: string | null) {
  await prisma.client.update({
    where: { id: cmsClientId },
    data: {
      externalCustomerId: externalId,
      billingProvider: externalId ? 'moloni' : null,
    },
  });
}

export async function listBillingEntities(
  workspaceId: string,
  tenantId: string,
  filters?: {
    entityType?: BillingEntityType;
    q?: string;
    linkStatus?: LinkStatus;
    status?: EntityStatus | 'all';
  }
) {
  const statusFilter =
    filters?.status === 'all' ? {} : { status: filters?.status ?? 'active' };

  return prisma.billingEntity.findMany({
    where: {
      workspaceId,
      tenantId,
      ...statusFilter,
      ...(filters?.entityType ? { entityType: filters.entityType } : {}),
      ...(filters?.linkStatus ? { linkStatus: filters.linkStatus } : {}),
      ...(filters?.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: 'insensitive' } },
              { vat: { contains: filters.q, mode: 'insensitive' } },
              { email: { contains: filters.q, mode: 'insensitive' } },
              { phone: { contains: filters.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      cmsClient: { select: { id: true, name: true, nif: true, email: true } },
      conflicts: { where: { status: 'open' }, select: { id: true, field: true } },
      _count: {
        select: {
          invoices: {
            where: { status: { in: ['issued', 'paid', 'cancelled'] } },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
}

export async function getBillingEntity(id: string, workspaceId: string, tenantId: string) {
  return prisma.billingEntity.findFirst({
    where: { id, workspaceId, tenantId },
    include: {
      cmsClient: true,
      conflicts: { where: { status: 'open' } },
    },
  });
}

export const FINAL_CONSUMER_VAT = '999999990';

function entityDedupeWhere(
  workspaceId: string,
  entityType: BillingEntityType,
  vat: string | null | undefined,
  name: string
) {
  const normalizedVat = normalizeVat(vat);
  if (!normalizedVat) return null;
  return {
    workspaceId,
    entityType,
    status: 'active' as const,
    vat: normalizedVat,
    ...(normalizedVat === FINAL_CONSUMER_VAT
      ? { name: { equals: name.trim(), mode: 'insensitive' as const } }
      : {}),
  };
}

export async function findBillingEntityForMoloniImport(input: {
  workspaceId: string;
  entityType: BillingEntityType;
  externalId: string;
  vat: string | null | undefined;
  name: string;
}) {
  const byExternal = await prisma.billingEntity.findFirst({
    where: {
      workspaceId: input.workspaceId,
      provider: 'moloni',
      entityType: input.entityType,
      externalId: input.externalId,
    },
  });
  if (byExternal) return byExternal;

  const dedupeWhere = entityDedupeWhere(
    input.workspaceId,
    input.entityType,
    input.vat,
    input.name
  );
  if (!dedupeWhere) return null;

  return prisma.billingEntity.findFirst({
    where: dedupeWhere,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Cria cliente/fornecedor fiscal no CMS (sem CRM). Enviado ao Moloni na emissão ou push. */
export async function createBillingEntity(input: {
  tenantId: string;
  workspaceId: string;
  entityType?: BillingEntityType;
  name: string;
  vat: string;
  isFinalConsumer?: boolean;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zipCode?: string | null;
  countryId?: number;
  pushToMoloni?: boolean;
}) {
  const entityType = input.entityType ?? 'customer';
  const name = input.name.trim();
  if (!name) throw new Error('Nome fiscal obrigatório');

  const vat = normalizeVat(input.vat);
  if (!vat) throw new Error('NIF obrigatório');
  if (vat === FINAL_CONSUMER_VAT && !input.isFinalConsumer) {
    throw new Error('NIF consumidor final requer a opção «Consumidor final»');
  }
  if (vat !== FINAL_CONSUMER_VAT && input.isFinalConsumer) {
    throw new Error('Opção consumidor final inconsistente com o NIF indicado');
  }

  const entityInclude = {
    cmsClient: { select: { id: true, name: true, nif: true, email: true } },
    conflicts: { where: { status: 'open' as const }, select: { id: true, field: true } },
    _count: {
      select: {
        invoices: { where: { status: { in: ['issued', 'paid', 'cancelled'] as string[] } } },
      },
    },
  };

  const existing = await prisma.billingEntity.findFirst({
    where: {
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      entityType,
      status: 'active',
      vat,
      ...(vat === FINAL_CONSUMER_VAT ? { name: { equals: name, mode: 'insensitive' } } : {}),
    },
    include: entityInclude,
  });
  if (existing) return { entity: existing, reused: true as const };

  const entity = await prisma.billingEntity.create({
    data: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      entityType,
      name,
      vat,
      email: input.email?.trim() || null,
      phone: normalizePhone(input.phone),
      addressJson: {
        address: input.address?.trim() ?? '',
        city: input.city?.trim() ?? '',
        zipCode: input.zipCode?.trim() ?? '',
        countryId: input.countryId ?? 1,
      },
      provider: 'moloni',
      linkStatus: 'unlinked',
      syncStatus: 'pending_push',
    },
    include: entityInclude,
  });

  if (input.pushToMoloni) {
    const pushed = await pushEntityToMoloni(entity.id, input.workspaceId, input.tenantId);
    return { entity: pushed, reused: false as const };
  }

  return { entity, reused: false as const };
}

/** Cria ou obtém entidade fiscal a partir de um cliente CRM */
export async function resolveFromClientId(input: {
  tenantId: string;
  workspaceId: string;
  clientId: string;
}) {
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
    },
  });
  if (!client) throw new Error('Cliente não encontrado');

  const existing = await prisma.billingEntity.findUnique({
    where: { cmsClientId: client.id },
  });
  if (existing?.status === 'archived') {
    throw new Error('Cliente CRM ligado a uma entidade arquivada — restaure-a primeiro');
  }
  if (existing) return existing;

  return prisma.billingEntity.create({
    data: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      entityType: 'customer',
      name: client.name,
      vat: client.nif,
      email: client.email,
      phone: client.phone,
      addressJson: client.addressJson as Prisma.InputJsonValue,
      provider: 'moloni',
      externalId: client.externalCustomerId,
      cmsClientId: client.id,
      linkStatus: client.externalCustomerId ? 'linked' : 'unlinked',
      cmsUpdatedAt: new Date(),
    },
  });
}

/** Resolve entidade para facturação: billingEntityId ou clientId legacy */
export async function resolveForInvoice(input: {
  tenantId: string;
  workspaceId: string;
  billingEntityId?: string;
  clientId?: string;
}) {
  if (input.billingEntityId) {
    const entity = await prisma.billingEntity.findFirst({
      where: {
        id: input.billingEntityId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        status: 'active',
      },
    });
    if (!entity) throw new Error('Entidade de facturação não encontrada ou arquivada');
    return entity;
  }

  if (input.clientId) {
    return resolveFromClientId({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      clientId: input.clientId,
    });
  }

  throw new Error('billingEntityId ou clientId obrigatório');
}

export async function findCmsClientsByNif(
  workspaceId: string,
  tenantId: string,
  vat: string | null | undefined
) {
  const normalized = normalizeVat(vat);
  if (!normalized) return [];

  const clients = await prisma.client.findMany({
    where: { workspaceId, tenantId, nif: { not: null } },
    select: { id: true, name: true, nif: true, email: true },
  });

  return clients.filter((c) => normalizeVat(c.nif) === normalized);
}

async function detectFieldConflicts(
  entity: {
    id: string;
    workspaceId: string;
    cmsClientId: string | null;
    name: string;
    vat: string | null;
    email: string | null;
    phone: string | null;
    linkStatus: string;
  },
  moloni: { name: string; vat: string; email?: string; phone?: string }
) {
  if (entity.linkStatus !== 'linked' || !entity.cmsClientId) return;

  const cmsClient = await prisma.client.findUnique({ where: { id: entity.cmsClientId } });
  if (!cmsClient) return;

  const pairs: Array<{ field: string; cmsValue: string | null; moloniValue: string | null }> = [
    { field: 'name', cmsValue: cmsClient.name, moloniValue: moloni.name },
    { field: 'vat', cmsValue: cmsClient.nif, moloniValue: moloni.vat },
    { field: 'email', cmsValue: cmsClient.email, moloniValue: moloni.email ?? null },
    { field: 'phone', cmsValue: cmsClient.phone, moloniValue: moloni.phone ?? null },
  ];

  let hasConflict = false;
  for (const p of pairs) {
    const cms = (p.cmsValue ?? '').trim();
    const mol = (p.moloniValue ?? '').trim();
    if (cms && mol && cms !== mol) {
      hasConflict = true;
      const existing = await prisma.billingSyncConflict.findFirst({
        where: { entityId: entity.id, field: p.field, status: 'open' },
      });
      if (!existing) {
        await prisma.billingSyncConflict.create({
          data: {
            workspaceId: entity.workspaceId,
            entityId: entity.id,
            cmsClientId: entity.cmsClientId,
            field: p.field,
            cmsValue: p.cmsValue,
            moloniValue: p.moloniValue,
          },
        });
      }
    }
  }

  if (hasConflict) {
    await prisma.billingEntity.update({
      where: { id: entity.id },
      data: { linkStatus: 'conflict' },
    });
  }
}

function entityFromMoloniCustomer(
  row: MoloniCustomerRow,
  workspaceId: string,
  tenantId: string
): Prisma.BillingEntityCreateInput {
  return {
    tenant: { connect: { id: tenantId } },
    workspace: { connect: { id: workspaceId } },
    entityType: 'customer',
    name: row.name,
    vat: row.vat,
    email: row.email ?? null,
    phone: normalizePhone(row.phone),
    addressJson: addressFromMoloni(row),
    provider: 'moloni',
    externalId: String(row.customer_id),
    linkStatus: 'unlinked',
    syncStatus: 'synced',
    moloniUpdatedAt: row.last_modified ? new Date(row.last_modified) : new Date(),
    lastSyncedAt: new Date(),
    moloniPayloadJson: row as unknown as Prisma.InputJsonValue,
  };
}

function entityFromMoloniSupplier(
  row: MoloniSupplierRow,
  workspaceId: string,
  tenantId: string
): Prisma.BillingEntityCreateInput {
  return {
    tenant: { connect: { id: tenantId } },
    workspace: { connect: { id: workspaceId } },
    entityType: 'supplier',
    name: row.name,
    vat: row.vat,
    email: row.email ?? null,
    phone: normalizePhone(row.phone),
    addressJson: addressFromMoloni(row),
    provider: 'moloni',
    externalId: String(row.supplier_id),
    linkStatus: 'unlinked',
    syncStatus: 'synced',
    moloniUpdatedAt: row.last_modified ? new Date(row.last_modified) : new Date(),
    lastSyncedAt: new Date(),
    moloniPayloadJson: row as unknown as Prisma.InputJsonValue,
  };
}

async function mergeMoloniEntityIntoCmsLinked(
  moloniEntityId: string,
  cmsLinkedEntityId: string,
  row: MoloniCustomerRow
) {
  const moloniEntity = await prisma.billingEntity.findUnique({
    where: { id: moloniEntityId },
  });
  if (!moloniEntity?.externalId) return null;

  const updated = await prisma.billingEntity.update({
    where: { id: cmsLinkedEntityId },
    data: {
      externalId: moloniEntity.externalId,
      name: row.name,
      vat: row.vat,
      email: row.email ?? null,
      phone: normalizePhone(row.phone),
      addressJson: addressFromMoloni(row),
      linkStatus: 'linked',
      syncStatus: 'synced',
      moloniUpdatedAt: row.last_modified ? new Date(row.last_modified) : new Date(),
      lastSyncedAt: new Date(),
      moloniPayloadJson: row as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.invoice.updateMany({
    where: { billingEntityId: moloniEntityId },
    data: { billingEntityId: cmsLinkedEntityId },
  });
  await prisma.billingSyncConflict.deleteMany({ where: { entityId: moloniEntityId } });
  await prisma.billingEntity.delete({ where: { id: moloniEntityId } });

  if (updated.cmsClientId) {
    await mirrorExternalIdToClient(updated.cmsClientId, moloniEntity.externalId);
  }

  return updated;
}

async function applyNifMatch(
  entityId: string,
  workspaceId: string,
  tenantId: string,
  vat: string | null | undefined,
  moloniRow?: MoloniCustomerRow
) {
  const matches = await findCmsClientsByNif(workspaceId, tenantId, vat);
  if (matches.length === 0) {
    await prisma.billingEntity.update({
      where: { id: entityId },
      data: { linkStatus: 'unlinked' },
    });
    return { matchCount: 0, candidates: [] };
  }

  if (matches.length === 1) {
    const candidate = matches[0];
    const cmsLinked = await prisma.billingEntity.findUnique({
      where: { cmsClientId: candidate.id },
    });

    if (cmsLinked && cmsLinked.id !== entityId) {
      if (moloniRow) {
        const merged = await mergeMoloniEntityIntoCmsLinked(entityId, cmsLinked.id, moloniRow);
        if (merged) return { matchCount: 1, candidates: [candidate], merged: true };
      }
      await prisma.billingEntity.update({
        where: { id: entityId },
        data: { linkStatus: 'pending_confirm' },
      });
      return { matchCount: 1, candidates: [candidate], blocked: true };
    }

    await prisma.billingEntity.update({
      where: { id: entityId },
      data: {
        cmsClientId: candidate.id,
        linkStatus: 'pending_confirm',
      },
    });
    return { matchCount: 1, candidates: [candidate] };
  }

  await prisma.billingEntity.update({
    where: { id: entityId },
    data: { linkStatus: 'pending_confirm' },
  });
  return { matchCount: matches.length, candidates: matches };
}

export type MoloniUpsertResult = {
  entity: Awaited<ReturnType<typeof prisma.billingEntity.findUniqueOrThrow>>;
  restored: boolean;
};

export async function upsertEntityFromMoloniCustomer(
  row: MoloniCustomerRow,
  workspaceId: string,
  tenantId: string,
  options?: { restoreArchived?: boolean }
): Promise<MoloniUpsertResult> {
  const externalId = String(row.customer_id);
  const existing = await findBillingEntityForMoloniImport({
    workspaceId,
    entityType: 'customer',
    externalId,
    vat: row.vat,
    name: row.name,
  });

  if (existing) {
    if (existing.status === 'archived' && !options?.restoreArchived) {
      return { entity: existing, restored: false };
    }
    await prisma.billingEntity.updateMany({
      where: {
        workspaceId,
        entityType: 'customer',
        externalId,
        NOT: { id: existing.id },
      },
      data: { externalId: null, syncStatus: 'local', linkStatus: 'unlinked' },
    });
    const wasArchived = existing.status === 'archived';
    const updated = await prisma.billingEntity.update({
      where: { id: existing.id },
      data: {
        ...(wasArchived ? { status: 'active' as const, archivedAt: null } : {}),
        externalId,
        name: row.name,
        vat: row.vat,
        email: row.email ?? null,
        phone: normalizePhone(row.phone),
        addressJson: addressFromMoloni(row),
        syncStatus: 'synced',
        moloniUpdatedAt: row.last_modified ? new Date(row.last_modified) : new Date(),
        lastSyncedAt: new Date(),
        moloniPayloadJson: row as unknown as Prisma.InputJsonValue,
      },
    });
    await detectFieldConflicts(updated, row);
    if (updated.linkStatus === 'unlinked') {
      await applyNifMatch(updated.id, workspaceId, tenantId, row.vat, row);
    }
    return { entity: updated, restored: wasArchived };
  }

  const nifMatches = await findCmsClientsByNif(workspaceId, tenantId, row.vat);
  if (nifMatches.length === 1) {
    const cmsLinked = await prisma.billingEntity.findUnique({
      where: { cmsClientId: nifMatches[0].id },
    });
    if (cmsLinked) {
      const updated = await prisma.billingEntity.update({
        where: { id: cmsLinked.id },
        data: {
          externalId,
          name: row.name,
          vat: row.vat,
          email: row.email ?? null,
          phone: normalizePhone(row.phone),
          addressJson: addressFromMoloni(row),
          linkStatus: 'linked',
          syncStatus: 'synced',
          moloniUpdatedAt: row.last_modified ? new Date(row.last_modified) : new Date(),
          lastSyncedAt: new Date(),
          moloniPayloadJson: row as unknown as Prisma.InputJsonValue,
        },
      });
      await mirrorExternalIdToClient(nifMatches[0].id, externalId);
      await detectFieldConflicts(updated, row);
      return { entity: updated, restored: false };
    }
  }

  const created = await prisma.billingEntity.create({
    data: entityFromMoloniCustomer(row, workspaceId, tenantId),
  });
  await applyNifMatch(created.id, workspaceId, tenantId, row.vat, row);
  const entity = await prisma.billingEntity.findUniqueOrThrow({ where: { id: created.id } });
  return { entity, restored: false };
}

export async function upsertEntityFromMoloniSupplier(
  row: MoloniSupplierRow,
  workspaceId: string,
  tenantId: string,
  options?: { restoreArchived?: boolean }
): Promise<MoloniUpsertResult> {
  const externalId = String(row.supplier_id);
  const existing = await findBillingEntityForMoloniImport({
    workspaceId,
    entityType: 'supplier',
    externalId,
    vat: row.vat,
    name: row.name,
  });

  if (existing) {
    if (existing.status === 'archived' && !options?.restoreArchived) {
      return { entity: existing, restored: false };
    }
    await prisma.billingEntity.updateMany({
      where: {
        workspaceId,
        entityType: 'supplier',
        externalId,
        NOT: { id: existing.id },
      },
      data: { externalId: null, syncStatus: 'local', linkStatus: 'unlinked' },
    });
    const wasArchived = existing.status === 'archived';
    const updated = await prisma.billingEntity.update({
      where: { id: existing.id },
      data: {
        ...(wasArchived ? { status: 'active' as const, archivedAt: null } : {}),
        externalId,
        name: row.name,
        vat: row.vat,
        email: row.email ?? null,
        phone: normalizePhone(row.phone),
        addressJson: addressFromMoloni(row),
        syncStatus: 'synced',
        moloniUpdatedAt: row.last_modified ? new Date(row.last_modified) : new Date(),
        lastSyncedAt: new Date(),
        moloniPayloadJson: row as unknown as Prisma.InputJsonValue,
      },
    });
    return { entity: updated, restored: wasArchived };
  }

  const created = await prisma.billingEntity.create({
    data: entityFromMoloniSupplier(row, workspaceId, tenantId),
  });
  return { entity: created, restored: false };
}

export async function linkEntityToCmsClient(input: {
  entityId: string;
  workspaceId: string;
  tenantId: string;
  cmsClientId: string;
}) {
  const entity = await prisma.billingEntity.findFirst({
    where: { id: input.entityId, workspaceId: input.workspaceId, tenantId: input.tenantId },
  });
  if (!entity) throw new Error('Entidade não encontrada');
  if (entity.entityType !== 'customer') throw new Error('Só clientes podem ligar ao CRM');

  const client = await prisma.client.findFirst({
    where: {
      id: input.cmsClientId,
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
    },
  });
  if (!client) throw new Error('Cliente CRM não encontrado');

  const other = await prisma.billingEntity.findUnique({
    where: { cmsClientId: client.id },
  });
  if (other && other.id !== entity.id) {
    throw new Error('Este cliente CRM já está ligado a outra entidade');
  }

  const updated = await prisma.billingEntity.update({
    where: { id: entity.id },
    data: {
      cmsClientId: client.id,
      linkStatus: 'linked',
      name: client.name,
      vat: client.nif,
      email: client.email,
      phone: client.phone,
      addressJson: client.addressJson as Prisma.InputJsonValue,
      cmsUpdatedAt: new Date(),
    },
  });

  if (entity.externalId) {
    await mirrorExternalIdToClient(client.id, entity.externalId);
  }

  return updated;
}

export async function confirmEntityLink(input: {
  entityId: string;
  workspaceId: string;
  tenantId: string;
  cmsClientId: string;
}) {
  return linkEntityToCmsClient(input);
}

function addressFields(entity: { addressJson: unknown }) {
  const addr = entity.addressJson as {
    address?: string;
    city?: string;
    zipCode?: string;
    countryId?: number;
  } | null;
  return {
    address: addr?.address ?? '',
    city: addr?.city ?? '',
    zip_code: addr?.zipCode ?? '',
    country_id: addr?.countryId ?? 1,
  };
}

export async function pushEntityToMoloni(
  entityId: string,
  workspaceId: string,
  tenantId: string
) {
  const entity = await prisma.billingEntity.findFirst({
    where: { id: entityId, workspaceId, tenantId },
    include: { cmsClient: true },
  });
  if (!entity) throw new Error('Entidade não encontrada');
  if (entity.status === 'archived') throw new Error('Entidade arquivada');

  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  const addr = addressFields(entity);

  if (entity.externalId) {
    const externalNum = Number(entity.externalId);
    if (entity.entityType === 'supplier') {
      const moloni = await moloniClient.getSupplier(row.companyId, externalNum);
      await moloniClient.updateSupplier({
        company_id: row.companyId,
        supplier_id: externalNum,
        number: moloni.number ?? '',
        name: entity.name,
        vat: entity.vat ?? String(moloni.vat ?? '999999990'),
        language_id: moloni.language_id ?? 1,
        address: addr.address || String(moloni.address ?? ''),
        city: addr.city || String(moloni.city ?? ''),
        zip_code: addr.zip_code || String(moloni.zip_code ?? ''),
        country_id: moloni.country_id ?? 1,
        email: entity.email ?? '',
        phone: entity.phone ?? '',
        maturity_date_id: moloni.maturity_date_id,
        payment_method_id: moloni.payment_method_id ?? 0,
        delivery_method_id: moloni.delivery_method_id ?? 0,
        copies: moloni.copies ?? [],
      });
    } else {
      const moloni = await moloniClient.getCustomer(row.companyId, externalNum);
      await moloniClient.updateCustomer({
        company_id: row.companyId,
        customer_id: externalNum,
        number: moloni.number ?? '',
        name: entity.name,
        vat: entity.vat ?? String(moloni.vat ?? '999999990'),
        language_id: moloni.language_id ?? 1,
        address: addr.address || String(moloni.address ?? ''),
        city: addr.city || String(moloni.city ?? ''),
        zip_code: addr.zip_code || String(moloni.zip_code ?? ''),
        country_id: moloni.country_id ?? 1,
        email: entity.email ?? '',
        phone: entity.phone ?? '',
        maturity_date_id: moloni.maturity_date_id,
        payment_method_id: moloni.payment_method_id ?? 0,
        delivery_method_id: moloni.delivery_method_id ?? 0,
        copies: moloni.copies ?? [],
      });
    }

    return prisma.billingEntity.update({
      where: { id: entity.id },
      data: {
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
        moloniUpdatedAt: new Date(),
      },
    });
  }

  if (!entity.vat?.trim()) {
    throw new Error('NIF em falta — edite o cliente antes de enviar ao Moloni');
  }

  const sampleCustomers = await moloniClient.getAllCustomers(row.companyId, 0, 1);
  const sample = sampleCustomers[0];
  const customerNumber =
    entity.vat === FINAL_CONSUMER_VAT
      ? `CMS-${entity.id.slice(0, 8)}`
      : entity.vat.replace(/\s/g, '').slice(0, 20);

  const payload = {
    company_id: row.companyId,
    number: customerNumber,
    name: entity.name,
    vat: entity.vat,
    language_id: 1,
    email: entity.email ?? '',
    phone: entity.phone ?? '',
    address: addr.address,
    city: addr.city,
    zip_code: addr.zip_code,
    country_id: addr.country_id,
    salesman_id: 0,
    maturity_date_id: sample?.maturity_date_id ?? 0,
    payment_day: 0,
    discount: 0,
    credit_limit: 0,
    payment_method_id: sample?.payment_method_id ?? 0,
    delivery_method_id: 0,
  };

  let externalId: string;
  if (entity.entityType === 'supplier') {
    const created = await moloniClient.insertSupplier(payload);
    if (!created.supplier_id) throw new Error('Moloni não devolveu supplier_id');
    externalId = String(created.supplier_id);
  } else {
    const created = await moloniClient.insertCustomer(payload);
    if (!created.customer_id) throw new Error('Moloni não devolveu customer_id');
    externalId = String(created.customer_id);
  }

  const updated = await prisma.billingEntity.update({
    where: { id: entity.id },
    data: {
      externalId,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      moloniUpdatedAt: new Date(),
    },
  });

  if (entity.cmsClientId) {
    await mirrorExternalIdToClient(entity.cmsClientId, externalId);
  }

  return updated;
}

export async function ensureMoloniPartyId(
  entity: {
    id: string;
    entityType: string;
    externalId: string | null;
    name: string;
    vat: string | null;
    email: string | null;
    phone: string | null;
    addressJson: unknown;
  },
  workspaceId: string,
  tenantId: string
): Promise<number> {
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  if (entity.externalId) {
    const partyId = Number(entity.externalId);
    if (!Number.isNaN(partyId)) {
      const existing =
        entity.entityType === 'supplier'
          ? await moloniClient.getSupplier(row.companyId, partyId)
          : await moloniClient.getCustomer(row.companyId, partyId);
      if (existing && typeof existing === 'object' && Object.keys(existing).length > 0) {
        return partyId;
      }
      await prisma.billingEntity.update({
        where: { id: entity.id },
        data: { externalId: null, linkStatus: 'unlinked' },
      });
    }
  }

  const pushed = await pushEntityToMoloni(entity.id, workspaceId, tenantId);
  if (!pushed.externalId) throw new Error('Falha ao obter ID Moloni');
  return Number(pushed.externalId);
}

export async function listBillingConflicts(workspaceId: string, status = 'open') {
  return prisma.billingSyncConflict.findMany({
    where: { workspaceId, status },
    include: {
      entity: { select: { id: true, name: true, entityType: true, vat: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function resolveBillingConflict(input: {
  conflictId: string;
  workspaceId: string;
  tenantId: string;
  resolution: 'cms' | 'moloni' | 'dismiss';
}) {
  const conflict = await prisma.billingSyncConflict.findFirst({
    where: { id: input.conflictId, workspaceId: input.workspaceId },
    include: { entity: { include: { cmsClient: true } } },
  });
  if (!conflict) throw new Error('Conflito não encontrado');

  const entity = conflict.entity;
  if (input.resolution === 'dismiss') {
    await prisma.billingSyncConflict.update({
      where: { id: conflict.id },
      data: { status: 'dismissed', resolution: 'dismiss', resolvedAt: new Date() },
    });
    await maybeClearEntityConflict(entity.id);
    return conflict;
  }

  if (input.resolution === 'moloni') {
    const molVal = conflict.moloniValue ?? '';
    const updates: Prisma.BillingEntityUpdateInput = {};
    if (conflict.field === 'name') updates.name = molVal;
    if (conflict.field === 'vat') updates.vat = molVal;
    if (conflict.field === 'email') updates.email = molVal;
    if (conflict.field === 'phone') updates.phone = molVal;

    await prisma.billingEntity.update({ where: { id: entity.id }, data: updates });

    if (entity.cmsClientId && COMPARE_FIELDS.includes(conflict.field as (typeof COMPARE_FIELDS)[number])) {
      const clientUpdate: Prisma.ClientUpdateInput = {};
      if (conflict.field === 'name') clientUpdate.name = molVal;
      if (conflict.field === 'vat') clientUpdate.nif = molVal;
      if (conflict.field === 'email') clientUpdate.email = molVal;
      if (conflict.field === 'phone') clientUpdate.phone = molVal;
      await prisma.client.update({ where: { id: entity.cmsClientId }, data: clientUpdate });
    }
  }

  if (input.resolution === 'cms') {
    await pushEntityToMoloni(entity.id, input.workspaceId, input.tenantId);
  }

  await prisma.billingSyncConflict.update({
    where: { id: conflict.id },
    data: {
      status: 'resolved',
      resolution: input.resolution,
      resolvedAt: new Date(),
    },
  });

  await maybeClearEntityConflict(entity.id);
  return conflict;
}

async function maybeClearEntityConflict(entityId: string) {
  const open = await prisma.billingSyncConflict.count({
    where: { entityId, status: 'open' },
  });
  if (open === 0) {
    await prisma.billingEntity.update({
      where: { id: entityId },
      data: { linkStatus: 'linked' },
    });
  }
}

/** Edição local no CMS — não altera Moloni até push manual */
export async function updateBillingEntity(input: {
  entityId: string;
  workspaceId: string;
  tenantId: string;
  name?: string;
  vat?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zipCode?: string | null;
  countryId?: number;
}) {
  const entity = await prisma.billingEntity.findFirst({
    where: { id: input.entityId, workspaceId: input.workspaceId, tenantId: input.tenantId },
  });
  if (!entity) throw new Error('Entidade não encontrada');
  if (entity.status === 'archived') throw new Error('Entidade arquivada — restaure antes de editar');

  if (input.vat !== undefined && normalizeVat(input.vat) !== normalizeVat(entity.vat)) {
    if (await entityHasIssuedInvoices(entity.id)) {
      throw new Error('NIF não pode ser alterado — entidade com faturas emitidas');
    }
  }

  const prevAddr = entity.addressJson as {
    address?: string;
    city?: string;
    zipCode?: string;
    countryId?: number;
  };
  const nextAddr = {
    address: input.address !== undefined ? (input.address?.trim() ?? '') : (prevAddr.address ?? ''),
    city: input.city !== undefined ? (input.city?.trim() ?? '') : (prevAddr.city ?? ''),
    zipCode: input.zipCode !== undefined ? (input.zipCode?.trim() ?? '') : (prevAddr.zipCode ?? ''),
    countryId: input.countryId !== undefined ? input.countryId : (prevAddr.countryId ?? 1),
  };

  return prisma.billingEntity.update({
    where: { id: entity.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.vat !== undefined ? { vat: input.vat } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: normalizePhone(input.phone) } : {}),
      ...(input.address !== undefined ||
      input.city !== undefined ||
      input.zipCode !== undefined ||
      input.countryId !== undefined
        ? { addressJson: nextAddr as Prisma.InputJsonValue }
        : {}),
      cmsUpdatedAt: new Date(),
      syncStatus: entity.externalId ? 'pending_push' : entity.syncStatus,
    },
  });
}

export async function archiveBillingEntity(
  entityId: string,
  workspaceId: string,
  tenantId: string
) {
  const entity = await prisma.billingEntity.findFirst({
    where: { id: entityId, workspaceId, tenantId },
  });
  if (!entity) throw new Error('Entidade não encontrada');
  if (entity.status === 'archived') return entity;

  return prisma.billingEntity.update({
    where: { id: entity.id },
    data: { status: 'archived', archivedAt: new Date() },
  });
}

export async function restoreBillingEntity(
  entityId: string,
  workspaceId: string,
  tenantId: string
) {
  const entity = await prisma.billingEntity.findFirst({
    where: { id: entityId, workspaceId, tenantId },
  });
  if (!entity) throw new Error('Entidade não encontrada');

  return prisma.billingEntity.update({
    where: { id: entity.id },
    data: { status: 'active', archivedAt: null },
  });
}

/** Remove do CMS — só se sem facturas emitidas; nunca apaga no Moloni */
export async function deleteBillingEntity(
  entityId: string,
  workspaceId: string,
  tenantId: string
) {
  const entity = await prisma.billingEntity.findFirst({
    where: { id: entityId, workspaceId, tenantId },
  });
  if (!entity) throw new Error('Entidade não encontrada');

  const issuedCount = await prisma.invoice.count({
    where: {
      billingEntityId: entity.id,
      status: { in: ['issued', 'paid', 'cancelled'] },
    },
  });
  if (issuedCount > 0) {
    throw new Error(
      'Entidade com documentos fiscais emitidos — use Arquivar em vez de eliminar'
    );
  }

  const draftCount = await prisma.invoice.count({
    where: { billingEntityId: entity.id, status: 'draft' },
  });
  if (draftCount > 0) {
    throw new Error('Existem rascunhos com esta entidade — elimine os rascunhos primeiro');
  }

  if (entity.cmsClientId) {
    await prisma.client.update({
      where: { id: entity.cmsClientId },
      data: { externalCustomerId: null, billingProvider: null },
    });
  }

  await prisma.billingSyncConflict.deleteMany({ where: { entityId: entity.id } });
  await prisma.billingEntity.delete({ where: { id: entity.id } });

  return { deleted: true, moloniUntouched: Boolean(entity.externalId) };
}

/** Remove do CMS entidades arquivadas sem documentos emitidos (limpar dados de teste importados) */
export async function purgeArchivedBillingEntities(
  workspaceId: string,
  tenantId: string,
  entityType?: BillingEntityType
) {
  const archived = await prisma.billingEntity.findMany({
    where: {
      workspaceId,
      tenantId,
      status: 'archived',
      ...(entityType ? { entityType } : {}),
    },
    select: { id: true },
  });

  let deleted = 0;
  let skipped = 0;

  for (const { id } of archived) {
    try {
      await deleteBillingEntity(id, workspaceId, tenantId);
      deleted++;
    } catch {
      skipped++;
    }
  }

  return { deleted, skipped };
}

/** Oculta importações Moloni sem ligação CRM (útil para limpar dados de teste) */
export async function archiveUnlinkedEntities(
  workspaceId: string,
  tenantId: string,
  entityType?: BillingEntityType
) {
  const result = await prisma.billingEntity.updateMany({
    where: {
      workspaceId,
      tenantId,
      status: 'active',
      linkStatus: 'unlinked',
      cmsClientId: null,
      ...(entityType ? { entityType } : {}),
    },
    data: { status: 'archived', archivedAt: new Date() },
  });

  return { archived: result.count };
}
