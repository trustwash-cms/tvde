export const TENANT_COMPANY_LOGO_SETTING_KEY = 'company_logo';
export const TENANT_LOGIN_WALLPAPER_SETTING_KEY = 'login_wallpaper';
export const TENANT_LOGIN_LOGO_SCALE_SETTING_KEY = 'login_logo_scale';

export const TENANT_LOGIN_LOGO_SCALES = [1, 2, 3] as const;
export type TenantLoginLogoScale = (typeof TENANT_LOGIN_LOGO_SCALES)[number];

export function parseTenantLoginLogoScale(value: string | null | undefined): TenantLoginLogoScale {
  if (value === '2') return 2;
  if (value === '3') return 3;
  return 1;
}

export const TENANT_BRANDING_MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const TENANT_BRANDING_MAX_WALLPAPER_BYTES = 5 * 1024 * 1024;

export const TENANT_BRANDING_LOGO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const TENANT_BRANDING_WALLPAPER_MIME_TYPES = TENANT_BRANDING_LOGO_MIME_TYPES;

export type TenantBrandingLogoMimeType = (typeof TENANT_BRANDING_LOGO_MIME_TYPES)[number];

export interface TenantCompanyLogoMeta {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
}

export type TenantLoginWallpaperMeta = TenantCompanyLogoMeta;
