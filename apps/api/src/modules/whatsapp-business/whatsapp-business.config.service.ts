import { prisma } from '@tvde/database';
import {
  WHATSAPP_BUSINESS_EVENT_KEYS,
  maskWhatsappAccessToken,
  type WhatsappBusinessConfigPublic,
  type WhatsappBusinessEventKey,
  type WhatsappBusinessNotificationEventConfig,
} from '@tvde/shared';
import { decrypt, encrypt } from '../../lib/crypto';
import { getDefaultPortalPublicUrl } from './whatsapp-provider.service';

export interface WhatsappBusinessConfigRecord {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string | null;
  apiVersion: string;
  webhookVerifyToken: string | null;
  enabled: boolean;
  testMode: boolean;
  portalPublicUrl: string | null;
  templateHeaderUrls: Record<string, string>;
}

export interface WhatsappBusinessConfigInput {
  accessToken?: string;
  phoneNumberId: string;
  businessAccountId?: string | null;
  apiVersion?: string;
  webhookVerifyToken?: string | null;
  enabled?: boolean;
  testMode?: boolean;
  portalPublicUrl?: string | null;
}

function headerUrlKey(templateName: string, languageCode: string) {
  return `${templateName}:${languageCode}`;
}

export async function getWhatsappBusinessConfigRecord(
  tenantId: string
): Promise<WhatsappBusinessConfigRecord | null> {
  const row = await prisma.whatsappBusinessConfig.findUnique({ where: { tenantId } });
  if (!row) return null;
  return {
    accessToken: decrypt(row.encryptedAccessToken),
    phoneNumberId: row.phoneNumberId,
    businessAccountId: row.businessAccountId,
    apiVersion: row.apiVersion,
    webhookVerifyToken: row.webhookVerifyToken,
    enabled: row.enabled,
    testMode: row.testMode,
    portalPublicUrl: row.portalPublicUrl,
    templateHeaderUrls: (row.templateHeaderUrls as Record<string, string>) ?? {},
  };
}

export async function getWhatsappBusinessConfigPublic(
  tenantId: string
): Promise<WhatsappBusinessConfigPublic> {
  const row = await prisma.whatsappBusinessConfig.findUnique({ where: { tenantId } });
  const defaultPortalPublicUrl = getDefaultPortalPublicUrl();
  if (!row) {
    return {
      phoneNumberId: '',
      businessAccountId: null,
      apiVersion: 'v18.0',
      enabled: true,
      testMode: false,
      portalPublicUrl: null,
      defaultPortalPublicUrl,
      configured: false,
      accessTokenConfigured: false,
      accessTokenPreview: null,
    };
  }

  let accessToken = '';
  try {
    accessToken = decrypt(row.encryptedAccessToken);
  } catch {
    accessToken = '';
  }

  return {
    phoneNumberId: row.phoneNumberId,
    businessAccountId: row.businessAccountId,
    apiVersion: row.apiVersion,
    enabled: row.enabled,
    testMode: row.testMode,
    portalPublicUrl: row.portalPublicUrl,
    defaultPortalPublicUrl,
    configured: Boolean(row.phoneNumberId && accessToken),
    accessTokenConfigured: Boolean(accessToken),
    accessTokenPreview: accessToken ? maskWhatsappAccessToken(accessToken) : null,
  };
}

export async function upsertWhatsappBusinessConfig(
  tenantId: string,
  input: WhatsappBusinessConfigInput
) {
  const existing = await prisma.whatsappBusinessConfig.findUnique({ where: { tenantId } });
  let encryptedAccessToken = existing?.encryptedAccessToken;
  if (input.accessToken?.trim()) {
    encryptedAccessToken = encrypt(input.accessToken.trim());
  }
  if (!encryptedAccessToken) {
    throw new Error('Access Token é obrigatório na primeira configuração');
  }

  const data = {
    encryptedAccessToken,
    phoneNumberId: input.phoneNumberId.trim(),
    businessAccountId: input.businessAccountId?.trim() || null,
    apiVersion: input.apiVersion?.trim() || 'v18.0',
    webhookVerifyToken: input.webhookVerifyToken?.trim() || null,
    enabled: input.enabled ?? true,
    testMode: input.testMode ?? false,
    portalPublicUrl: input.portalPublicUrl?.trim() || null,
  };

  if (existing) {
    return prisma.whatsappBusinessConfig.update({ where: { tenantId }, data });
  }
  return prisma.whatsappBusinessConfig.create({ data: { tenantId, ...data } });
}

export async function getWhatsappBusinessTemplateHeaderUrl(
  tenantId: string,
  templateName: string,
  languageCode: string
): Promise<string | null> {
  const config = await getWhatsappBusinessConfigRecord(tenantId);
  if (!config) return null;
  return config.templateHeaderUrls[headerUrlKey(templateName, languageCode)] ?? null;
}

export async function saveWhatsappBusinessTemplateHeaderUrl(
  tenantId: string,
  templateName: string,
  languageCode: string,
  url: string
) {
  const existing = await prisma.whatsappBusinessConfig.findUnique({ where: { tenantId } });
  if (!existing) throw new Error('Configure a API Oficial WhatsApp primeiro');

  const templateHeaderUrls = {
    ...((existing.templateHeaderUrls as Record<string, string>) ?? {}),
  };
  const key = headerUrlKey(templateName, languageCode);
  if (url.trim()) templateHeaderUrls[key] = url.trim();
  else delete templateHeaderUrls[key];

  return prisma.whatsappBusinessConfig.update({
    where: { tenantId },
    data: { templateHeaderUrls },
  });
}

const DEFAULT_NOTIFICATION_EVENTS: WhatsappBusinessNotificationEventConfig[] = [
  {
    eventKey: WHATSAPP_BUSINESS_EVENT_KEYS.driverWeeklyPayment,
    emailEnabled: true,
    whatsappEnabled: false,
    whatsappTemplate: null,
    whatsappLanguage: 'en_US',
    headerMediaUrl: null,
  },
  {
    eventKey: WHATSAPP_BUSINESS_EVENT_KEYS.userAccountDriver,
    emailEnabled: true,
    whatsappEnabled: false,
    whatsappTemplate: null,
    whatsappLanguage: 'pt_PT',
    headerMediaUrl: null,
  },
  {
    eventKey: WHATSAPP_BUSINESS_EVENT_KEYS.userAccountManager,
    emailEnabled: true,
    whatsappEnabled: false,
    whatsappTemplate: null,
    whatsappLanguage: 'pt_PT',
    headerMediaUrl: null,
  },
];

export async function listWhatsappBusinessNotificationEvents(
  tenantId: string
): Promise<WhatsappBusinessNotificationEventConfig[]> {
  const [rows, config] = await Promise.all([
    prisma.whatsappBusinessNotificationEvent.findMany({
      where: { tenantId },
    }),
    getWhatsappBusinessConfigRecord(tenantId),
  ]);
  const urls = config?.templateHeaderUrls ?? {};

  return DEFAULT_NOTIFICATION_EVENTS.map((fallback) => {
    const row = rows.find((item) => item.eventKey === fallback.eventKey);
    if (!row) return fallback;
    const headerMediaUrl = row.whatsappTemplate
      ? urls[headerUrlKey(row.whatsappTemplate, row.whatsappLanguage)] ?? null
      : null;
    return {
      eventKey: row.eventKey as WhatsappBusinessEventKey,
      emailEnabled: row.emailEnabled,
      whatsappEnabled: row.whatsappEnabled,
      whatsappTemplate: row.whatsappTemplate,
      whatsappLanguage: row.whatsappLanguage,
      headerMediaUrl,
    };
  });
}

export async function upsertWhatsappBusinessNotificationEvent(
  tenantId: string,
  input: WhatsappBusinessNotificationEventConfig
) {
  const row = await prisma.whatsappBusinessNotificationEvent.upsert({
    where: {
      tenantId_eventKey: { tenantId, eventKey: input.eventKey },
    },
    create: {
      tenantId,
      eventKey: input.eventKey,
      emailEnabled: input.emailEnabled,
      whatsappEnabled: input.whatsappEnabled,
      whatsappTemplate: input.whatsappTemplate,
      whatsappLanguage: input.whatsappLanguage,
    },
    update: {
      emailEnabled: input.emailEnabled,
      whatsappEnabled: input.whatsappEnabled,
      whatsappTemplate: input.whatsappTemplate,
      whatsappLanguage: input.whatsappLanguage,
    },
  });

  if (input.whatsappTemplate && input.headerMediaUrl !== undefined) {
    await saveWhatsappBusinessTemplateHeaderUrl(
      tenantId,
      input.whatsappTemplate,
      input.whatsappLanguage,
      input.headerMediaUrl ?? ''
    );
  }

  return {
    eventKey: row.eventKey as WhatsappBusinessEventKey,
    emailEnabled: row.emailEnabled,
    whatsappEnabled: row.whatsappEnabled,
    whatsappTemplate: row.whatsappTemplate,
    whatsappLanguage: row.whatsappLanguage,
    headerMediaUrl: input.headerMediaUrl ?? null,
  };
}
