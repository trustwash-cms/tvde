import type { TenantLoginLogoScale } from '@tvde/shared';

export const LOGIN_LOGO_SCALE_CLASSES: Record<TenantLoginLogoScale, string> = {
  1: 'h-16 max-w-[240px]',
  2: 'h-32 max-w-[480px]',
  3: 'h-48 max-w-[720px]',
};

export const SETTINGS_LOGO_PREVIEW_CLASSES: Record<TenantLoginLogoScale, string> = {
  1: 'h-14 max-w-[210px]',
  2: 'h-24 max-w-[360px]',
  3: 'h-32 max-w-[480px]',
};
