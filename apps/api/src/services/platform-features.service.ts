import { prisma } from '@tvde/database';

export const PLATFORM_FEATURE_KEYS = {
  sms2faEnabled: 'sms_2fa_enabled',
  whatsapp2faEnabled: 'whatsapp_2fa_enabled',
} as const;

export type PlatformFeatureKey =
  (typeof PLATFORM_FEATURE_KEYS)[keyof typeof PLATFORM_FEATURE_KEYS];

export interface PlatformFeatures {
  sms2faEnabled: boolean;
  whatsapp2faEnabled: boolean;
}

const DEFAULT_FEATURES: PlatformFeatures = {
  sms2faEnabled: false,
  whatsapp2faEnabled: false,
};

function parseBool(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

export async function getPlatformFeatures(): Promise<PlatformFeatures> {
  const rows = await prisma.platformSetting.findMany({
    where: {
      key: {
        in: Object.values(PLATFORM_FEATURE_KEYS),
      },
    },
  });

  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    sms2faEnabled: parseBool(map.get(PLATFORM_FEATURE_KEYS.sms2faEnabled)),
    whatsapp2faEnabled: parseBool(map.get(PLATFORM_FEATURE_KEYS.whatsapp2faEnabled)),
  };
}

export async function setPlatformFeature(
  key: PlatformFeatureKey,
  enabled: boolean
): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: enabled ? 'true' : 'false' },
    update: { value: enabled ? 'true' : 'false' },
  });
}

export async function updatePlatformFeatures(
  patch: Partial<PlatformFeatures>
): Promise<PlatformFeatures> {
  if (patch.sms2faEnabled !== undefined) {
    await setPlatformFeature(PLATFORM_FEATURE_KEYS.sms2faEnabled, patch.sms2faEnabled);
  }
  if (patch.whatsapp2faEnabled !== undefined) {
    await setPlatformFeature(
      PLATFORM_FEATURE_KEYS.whatsapp2faEnabled,
      patch.whatsapp2faEnabled
    );
  }
  return getPlatformFeatures();
}

export async function assertMasterSms2faAvailable(role: string): Promise<PlatformFeatures> {
  const features = await getPlatformFeatures();
  if (role !== 'master') {
    throw new Error('2FA SMS disponível apenas para utilizadores MASTER');
  }
  if (!features.sms2faEnabled) {
    throw new Error('2FA SMS não activo na plataforma');
  }
  return features;
}

export async function assertMasterWhatsapp2faAvailable(role: string): Promise<PlatformFeatures> {
  const features = await getPlatformFeatures();
  if (role !== 'master') {
    throw new Error('2FA WhatsApp disponível apenas para utilizadores MASTER');
  }
  if (!features.whatsapp2faEnabled) {
    throw new Error('2FA WhatsApp não activo na plataforma');
  }
  return features;
}

export { DEFAULT_FEATURES };
