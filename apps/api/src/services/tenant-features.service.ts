import { prisma } from '@tvde/database';
import type { Role } from '@tvde/shared';
import {
  getPlatformFeatures,
  updatePlatformFeatures,
  type PlatformFeatures,
} from './platform-features.service';

export const TENANT_COMM_FEATURE_KEYS = {
  sms2faEnabled: 'sms_2fa_enabled',
  whatsapp2faEnabled: 'whatsapp_2fa_enabled',
} as const;

export type TenantCommunicationFeatures = PlatformFeatures;

const DEFAULT: TenantCommunicationFeatures = {
  sms2faEnabled: false,
  whatsapp2faEnabled: false,
};

function parseBool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

export async function getTenantCommunicationFeatures(
  tenantId: string
): Promise<TenantCommunicationFeatures> {
  const rows = await prisma.tenantSetting.findMany({
    where: {
      tenantId,
      key: { in: Object.values(TENANT_COMM_FEATURE_KEYS) },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    sms2faEnabled: parseBool(map.get(TENANT_COMM_FEATURE_KEYS.sms2faEnabled)),
    whatsapp2faEnabled: parseBool(map.get(TENANT_COMM_FEATURE_KEYS.whatsapp2faEnabled)),
  };
}

export async function updateTenantCommunicationFeatures(
  tenantId: string,
  patch: Partial<TenantCommunicationFeatures>
): Promise<TenantCommunicationFeatures> {
  if (patch.sms2faEnabled !== undefined) {
    await prisma.tenantSetting.upsert({
      where: {
        tenantId_key: { tenantId, key: TENANT_COMM_FEATURE_KEYS.sms2faEnabled },
      },
      create: {
        tenantId,
        key: TENANT_COMM_FEATURE_KEYS.sms2faEnabled,
        value: patch.sms2faEnabled ? 'true' : 'false',
      },
      update: { value: patch.sms2faEnabled ? 'true' : 'false' },
    });
  }
  if (patch.whatsapp2faEnabled !== undefined) {
    await prisma.tenantSetting.upsert({
      where: {
        tenantId_key: { tenantId, key: TENANT_COMM_FEATURE_KEYS.whatsapp2faEnabled },
      },
      create: {
        tenantId,
        key: TENANT_COMM_FEATURE_KEYS.whatsapp2faEnabled,
        value: patch.whatsapp2faEnabled ? 'true' : 'false',
      },
      update: { value: patch.whatsapp2faEnabled ? 'true' : 'false' },
    });
  }
  return getTenantCommunicationFeatures(tenantId);
}

/** MASTER → flags globais da plataforma; tenant → flags do cliente. */
export async function resolveCommunicationFeatures(
  role: Role,
  tenantId: string | null
): Promise<TenantCommunicationFeatures> {
  if (role === 'master') {
    return getPlatformFeatures();
  }
  if (!tenantId) return DEFAULT;
  return getTenantCommunicationFeatures(tenantId);
}

export async function updateCommunicationFeaturesForActor(
  role: Role,
  tenantId: string | null,
  patch: Partial<TenantCommunicationFeatures>
): Promise<TenantCommunicationFeatures> {
  if (role === 'master') {
    return updatePlatformFeatures(patch);
  }
  if (!tenantId) {
    throw new Error('Tenant não definido');
  }
  return updateTenantCommunicationFeatures(tenantId, patch);
}
