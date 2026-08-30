import { prisma } from '@tvde/database';
import type { WhatsappProvider } from '@tvde/shared';
import { getServerConfig } from '@tvde/shared/server';
import { isPlatformWhatsappTenantId } from '../../lib/whatsapp-tenant';
import {
  getTenantCommunicationFeatures,
  updateTenantCommunicationFeatures,
} from '../../services/tenant-features.service';
import { getPlatformFeatures, updatePlatformFeatures } from '../../services/platform-features.service';

const PROVIDER_KEY = 'whatsapp_active_provider';

export async function getWhatsappActiveProvider(tenantId: string): Promise<WhatsappProvider> {
  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: PROVIDER_KEY } },
  });
  return row?.value === 'official' ? 'official' : 'generic';
}

export async function setWhatsappActiveProvider(
  tenantId: string,
  provider: WhatsappProvider
): Promise<{ provider: WhatsappProvider }> {
  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId, key: PROVIDER_KEY } },
    create: { tenantId, key: PROVIDER_KEY, value: provider },
    update: { value: provider },
  });

  if (provider === 'official') {
    if (isPlatformWhatsappTenantId(tenantId)) {
      await updatePlatformFeatures({ whatsapp2faEnabled: false });
    } else {
      await updateTenantCommunicationFeatures(tenantId, { whatsapp2faEnabled: false });
    }
    const existing = await prisma.whatsappBusinessConfig.findUnique({ where: { tenantId } });
    if (existing) {
      await prisma.whatsappBusinessConfig.update({
        where: { tenantId },
        data: { enabled: true },
      });
    }
  } else {
    const existing = await prisma.whatsappBusinessConfig.findUnique({ where: { tenantId } });
    if (existing) {
      await prisma.whatsappBusinessConfig.update({
        where: { tenantId },
        data: { enabled: false },
      });
    }
  }

  return { provider };
}

export function getDefaultPortalPublicUrl(): string | null {
  const { webPublicUrl } = getServerConfig();
  return webPublicUrl?.trim() || null;
}

export async function assertWhatsappProviderActive(
  tenantId: string,
  expected: WhatsappProvider
): Promise<void> {
  const active = await getWhatsappActiveProvider(tenantId);
  if (active !== expected) {
    const label = expected === 'official' ? 'API Oficial' : 'API Genérica';
    throw new Error(
      `A ${label} não está activa. Active-a em Configurações → WhatsApp antes de continuar.`
    );
  }
}

export async function getWhatsappProviderStatus(tenantId: string) {
  const provider = await getWhatsappActiveProvider(tenantId);
  const comms = isPlatformWhatsappTenantId(tenantId)
    ? await getPlatformFeatures()
    : await getTenantCommunicationFeatures(tenantId);
  const business = await prisma.whatsappBusinessConfig.findUnique({
    where: { tenantId },
    select: { enabled: true, portalPublicUrl: true },
  });

  return {
    provider,
    generic2faEnabled: comms.whatsapp2faEnabled,
    officialEnabled: business?.enabled ?? false,
    defaultPortalPublicUrl: getDefaultPortalPublicUrl(),
    portalPublicUrl: business?.portalPublicUrl ?? null,
  };
}
