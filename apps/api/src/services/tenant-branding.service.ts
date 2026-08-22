import { readFile } from 'node:fs/promises';
import { prisma } from '@tvde/database';
import {
  TENANT_BRANDING_MAX_LOGO_BYTES,
  TENANT_BRANDING_MAX_WALLPAPER_BYTES,
  TENANT_COMPANY_LOGO_SETTING_KEY,
  TENANT_LOGIN_LOGO_SCALE_SETTING_KEY,
  TENANT_LOGIN_WALLPAPER_SETTING_KEY,
  parseTenantLoginLogoScale,
  type TenantCompanyLogoMeta,
  type TenantLoginLogoScale,
  type TenantLoginWallpaperMeta,
} from '@tvde/shared';
import {
  buildTenantLogoStorageKey,
  buildTenantWallpaperStorageKey,
  deleteTenantLogoFile,
  getTenantLogoPath,
  openTenantLogoStream,
  saveTenantLogoFile,
} from './tenant-branding-storage.service';
import { assertTenantStorageQuota } from './tenant-storage.service';

function parseBrandingFileMeta<T extends { storageKey: string }>(
  value: string | null | undefined
): T | null {
  if (!value) return null;
  try {
    const row = JSON.parse(value) as T;
    if (typeof row.storageKey !== 'string' || !row.storageKey) return null;
    return row;
  } catch {
    return null;
  }
}

async function readLogoMeta(tenantId: string): Promise<TenantCompanyLogoMeta | null> {
  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: TENANT_COMPANY_LOGO_SETTING_KEY } },
  });
  return parseBrandingFileMeta<TenantCompanyLogoMeta>(row?.value);
}

async function readWallpaperMeta(tenantId: string): Promise<TenantLoginWallpaperMeta | null> {
  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: TENANT_LOGIN_WALLPAPER_SETTING_KEY } },
  });
  return parseBrandingFileMeta<TenantLoginWallpaperMeta>(row?.value);
}

async function readLoginLogoScale(tenantId: string): Promise<TenantLoginLogoScale> {
  const row = await prisma.tenantSetting.findUnique({
    where: { tenantId_key: { tenantId, key: TENANT_LOGIN_LOGO_SCALE_SETTING_KEY } },
  });
  return parseTenantLoginLogoScale(row?.value);
}

function mapFileMeta(meta: TenantCompanyLogoMeta | TenantLoginWallpaperMeta) {
  return {
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    updatedAt: meta.updatedAt,
  };
}

export async function getTenantBranding(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error('Tenant não encontrado');

  const logo = await readLogoMeta(tenantId);
  const wallpaper = await readWallpaperMeta(tenantId);
  const loginLogoScale = await readLoginLogoScale(tenantId);
  return {
    companyName: tenant.name,
    loginLogoScale,
    logo: logo ? { hasLogo: true, ...mapFileMeta(logo) } : { hasLogo: false },
    wallpaper: wallpaper
      ? { hasWallpaper: true, ...mapFileMeta(wallpaper) }
      : { hasWallpaper: false },
  };
}

export async function updateTenantLoginLogoScale(tenantId: string, scale: TenantLoginLogoScale) {
  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId, key: TENANT_LOGIN_LOGO_SCALE_SETTING_KEY } },
    create: { tenantId, key: TENANT_LOGIN_LOGO_SCALE_SETTING_KEY, value: String(scale) },
    update: { value: String(scale) },
  });
  return scale;
}

export async function uploadTenantLogo(
  tenantId: string,
  input: { fileName: string; mimeType: string; buffer: Buffer }
) {
  if (input.buffer.length > TENANT_BRANDING_MAX_LOGO_BYTES) {
    throw new Error('Logotipo demasiado grande (máx. 2 MB)');
  }

  const existing = await readLogoMeta(tenantId);
  const replaceBytes = existing?.sizeBytes ?? 0;
  await assertTenantStorageQuota(prisma, tenantId, input.buffer.length, replaceBytes);

  if (existing?.storageKey) {
    await deleteTenantLogoFile(existing.storageKey).catch(() => undefined);
  }

  const storageKey = buildTenantLogoStorageKey(tenantId, input.fileName, input.mimeType);
  await saveTenantLogoFile(storageKey, input.buffer);

  const meta: TenantCompanyLogoMeta = {
    storageKey,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    updatedAt: new Date().toISOString(),
  };

  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId, key: TENANT_COMPANY_LOGO_SETTING_KEY } },
    create: { tenantId, key: TENANT_COMPANY_LOGO_SETTING_KEY, value: JSON.stringify(meta) },
    update: { value: JSON.stringify(meta) },
  });

  return meta;
}

export async function uploadTenantLoginWallpaper(
  tenantId: string,
  input: { fileName: string; mimeType: string; buffer: Buffer }
) {
  if (input.buffer.length > TENANT_BRANDING_MAX_WALLPAPER_BYTES) {
    throw new Error('Wallpaper demasiado grande (máx. 8 MB)');
  }

  const existing = await readWallpaperMeta(tenantId);
  const replaceBytes = existing?.sizeBytes ?? 0;
  await assertTenantStorageQuota(prisma, tenantId, input.buffer.length, replaceBytes);

  if (existing?.storageKey) {
    await deleteTenantLogoFile(existing.storageKey).catch(() => undefined);
  }

  const storageKey = buildTenantWallpaperStorageKey(tenantId, input.fileName, input.mimeType);
  await saveTenantLogoFile(storageKey, input.buffer);

  const meta: TenantLoginWallpaperMeta = {
    storageKey,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    updatedAt: new Date().toISOString(),
  };

  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId, key: TENANT_LOGIN_WALLPAPER_SETTING_KEY } },
    create: { tenantId, key: TENANT_LOGIN_WALLPAPER_SETTING_KEY, value: JSON.stringify(meta) },
    update: { value: JSON.stringify(meta) },
  });

  return meta;
}

export async function deleteTenantLogo(tenantId: string) {
  const existing = await readLogoMeta(tenantId);
  if (existing?.storageKey) {
    await deleteTenantLogoFile(existing.storageKey).catch(() => undefined);
  }
  await prisma.tenantSetting.deleteMany({
    where: { tenantId, key: TENANT_COMPANY_LOGO_SETTING_KEY },
  });
}

export async function deleteTenantLoginWallpaper(tenantId: string) {
  const existing = await readWallpaperMeta(tenantId);
  if (existing?.storageKey) {
    await deleteTenantLogoFile(existing.storageKey).catch(() => undefined);
  }
  await prisma.tenantSetting.deleteMany({
    where: { tenantId, key: TENANT_LOGIN_WALLPAPER_SETTING_KEY },
  });
}

export async function getTenantLogoDownload(tenantId: string) {
  const meta = await readLogoMeta(tenantId);
  if (!meta) return null;
  return {
    meta,
    stream: openTenantLogoStream(meta.storageKey),
  };
}

export async function getTenantLoginWallpaperDownload(tenantId: string) {
  const meta = await readWallpaperMeta(tenantId);
  if (!meta) return null;
  return {
    meta,
    stream: openTenantLogoStream(meta.storageKey),
  };
}

async function findTenantIdBySiteId(siteId: string): Promise<string | null> {
  const trimmed = siteId.trim();
  if (!trimmed) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { siteId: trimmed },
    select: { id: true },
  });
  return tenant?.id ?? null;
}

export async function getTenantBrandingBySiteId(siteId: string) {
  const tenantId = await findTenantIdBySiteId(siteId);
  if (!tenantId) return null;
  return getTenantBranding(tenantId);
}

export async function getTenantLogoDownloadBySiteId(siteId: string) {
  const tenantId = await findTenantIdBySiteId(siteId);
  if (!tenantId) return null;
  return getTenantLogoDownload(tenantId);
}

export async function getTenantLoginWallpaperDownloadBySiteId(siteId: string) {
  const tenantId = await findTenantIdBySiteId(siteId);
  if (!tenantId) return null;
  return getTenantLoginWallpaperDownload(tenantId);
}

export async function getTenantLogoEmailAttachment(tenantId: string): Promise<{
  filename: string;
  content: Buffer;
  cid: string;
  mimeType: string;
} | null> {
  const meta = await readLogoMeta(tenantId);
  if (!meta) return null;
  try {
    const content = await readFile(getTenantLogoPath(meta.storageKey));
    return {
      filename: meta.fileName || 'logo.png',
      content,
      cid: 'company-logo',
      mimeType: meta.mimeType,
    };
  } catch {
    return null;
  }
}

export async function buildCompanyLogoHtml(tenantId: string, companyName: string): Promise<{
  html: string;
  attachment: { filename: string; content: Buffer; cid: string } | null;
}> {
  const logo = await getTenantLogoEmailAttachment(tenantId);
  if (logo) {
    return {
      html: `<img src="cid:company-logo" alt="${companyName.replace(/"/g, '&quot;')}" style="max-height:56px;max-width:220px;display:inline-block;" />`,
      attachment: { filename: logo.filename, content: logo.content, cid: logo.cid },
    };
  }
  // Texto simples no header escuro (#1A1A2E) — evita “caixa + nome” a duplicar a marca
  const safe = companyName.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return {
    html: `<span style="color:#fff;font-size:20px;font-weight:500;letter-spacing:0.04em;">${safe}</span>`,
    attachment: null,
  };
}
