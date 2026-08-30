import type { PrismaClient } from '@tvde/database';
import { platformWhatsappTenantExcludeWhere } from '../lib/whatsapp-tenant';
import {
  DEFAULT_LIMITS,
  TENANT_COMPANY_LOGO_SETTING_KEY,
  TENANT_LOGIN_WALLPAPER_SETTING_KEY,
  gbToStorageBytes,
  storageUsagePercent,
  type TenantStorageBreakdown,
  type TenantStorageSummary,
} from '@tvde/shared';

type TenantLimits = {
  storage_gb?: number;
};

export class TenantStorageQuotaError extends Error {
  constructor(message = 'Quota de armazenamento do tenant excedida') {
    super(message);
    this.name = 'TenantStorageQuotaError';
  }
}

export function getTenantStorageLimitBytes(limitsJson: unknown): number {
  const limits = (limitsJson ?? {}) as TenantLimits;
  const gb = limits.storage_gb ?? DEFAULT_LIMITS.storage_gb;
  return gbToStorageBytes(gb);
}

export function getTenantStorageLimitGb(limitsJson: unknown): number {
  const limits = (limitsJson ?? {}) as TenantLimits;
  return limits.storage_gb ?? DEFAULT_LIMITS.storage_gb;
}

async function getBrandingUsageBytes(db: PrismaClient, tenantId: string): Promise<number> {
  const rows = await db.tenantSetting.findMany({
    where: {
      tenantId,
      key: { in: [TENANT_COMPANY_LOGO_SETTING_KEY, TENANT_LOGIN_WALLPAPER_SETTING_KEY] },
    },
    select: { value: true },
  });

  let total = 0;
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.value) as { sizeBytes?: number };
      if (typeof meta.sizeBytes === 'number' && meta.sizeBytes > 0) {
        total += meta.sizeBytes;
      }
    } catch {
      // ignore invalid meta
    }
  }
  return total;
}

export async function getTenantStorageBreakdown(
  db: PrismaClient,
  tenantId: string
): Promise<TenantStorageBreakdown> {
  const [
    userDocuments,
    calendarAttachments,
    ecommerceProductImages,
    ecommerceMediaAssets,
    branding,
  ] = await Promise.all([
    db.userDocument.aggregate({
      where: { tenantId },
      _sum: { sizeBytes: true },
    }),
    db.calendarEventAttachment.aggregate({
      where: { tenantId },
      _sum: { sizeBytes: true },
    }),
    db.ecommerceProductImage.aggregate({
      where: { tenantId },
      _sum: { sizeBytes: true },
    }),
    db.ecommerceMediaAsset.aggregate({
      where: { tenantId },
      _sum: { sizeBytes: true },
    }),
    getBrandingUsageBytes(db, tenantId),
  ]);

  return {
    userDocuments: userDocuments._sum.sizeBytes ?? 0,
    calendarAttachments: Number(calendarAttachments._sum.sizeBytes ?? 0n),
    ecommerceProductImages: ecommerceProductImages._sum.sizeBytes ?? 0,
    ecommerceMediaAssets: ecommerceMediaAssets._sum.sizeBytes ?? 0,
    branding,
  };
}

export async function getTenantStorageUsageBytes(
  db: PrismaClient,
  tenantId: string
): Promise<number> {
  const breakdown = await getTenantStorageBreakdown(db, tenantId);
  return Object.values(breakdown).reduce((sum, value) => sum + value, 0);
}

/** @deprecated use getTenantStorageUsageBytes */
export async function getTenantUserDocumentsUsageBytes(
  db: PrismaClient,
  tenantId: string
): Promise<number> {
  const result = await db.userDocument.aggregate({
    where: { tenantId },
    _sum: { sizeBytes: true },
  });
  return result._sum.sizeBytes ?? 0;
}

export async function getTenantStorageSummary(
  db: PrismaClient,
  tenantId: string
): Promise<TenantStorageSummary> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, limitsJson: true, plan: true, siteId: true, name: true },
  });

  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const limitGb = getTenantStorageLimitGb(tenant.limitsJson);
  const limitBytes = getTenantStorageLimitBytes(tenant.limitsJson);
  const breakdown = await getTenantStorageBreakdown(db, tenantId);
  const usedBytes = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return {
    tenantId: tenant.id,
    limitBytes,
    limitGb,
    usedBytes,
    availableBytes: Math.max(0, limitBytes - usedBytes),
    usagePercent: storageUsagePercent(usedBytes, limitBytes),
    breakdown,
    plan: tenant.plan,
    siteId: tenant.siteId,
    tenantName: tenant.name,
  };
}

/** Listagem MASTER: quota de storage de todos os tenants. */
export async function listAllTenantStorageSummaries(
  db: PrismaClient
): Promise<TenantStorageSummary[]> {
  const tenants = await db.tenant.findMany({
    where: platformWhatsappTenantExcludeWhere,
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  const rows = await Promise.all(tenants.map((t) => getTenantStorageSummary(db, t.id)));
  return rows;
}

export async function assertTenantStorageQuota(
  db: PrismaClient,
  tenantId: string,
  additionalBytes: number,
  replaceBytes = 0
): Promise<void> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { limitsJson: true },
  });

  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const limitBytes = getTenantStorageLimitBytes(tenant.limitsJson);
  const usedBytes = await getTenantStorageUsageBytes(db, tenantId);
  const projected = usedBytes - Math.max(0, replaceBytes) + additionalBytes;

  if (projected > limitBytes) {
    throw new TenantStorageQuotaError();
  }
}

export async function updateTenantStorageLimit(
  db: PrismaClient,
  tenantId: string,
  storageGb: number
): Promise<TenantStorageSummary> {
  if (!Number.isFinite(storageGb) || storageGb <= 0) {
    throw new Error('Limite de storage inválido');
  }

  const usedBytes = await getTenantStorageUsageBytes(db, tenantId);
  const limitBytes = gbToStorageBytes(storageGb);
  if (limitBytes < usedBytes) {
    throw new Error(
      `O novo limite (${storageGb} GB) não pode ser inferior ao uso actual`
    );
  }

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { limitsJson: true },
  });
  if (!tenant) {
    throw new Error('Tenant não encontrado');
  }

  const limits = (tenant.limitsJson as Record<string, unknown>) ?? {};
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      limitsJson: {
        ...limits,
        storage_gb: storageGb,
      },
    },
  });

  return getTenantStorageSummary(db, tenantId);
}
