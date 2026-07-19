import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';

function resolveUploadRoot(): string {
  const configured = env.brandingUploadDir;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function safeExt(fileName: string, mimeType: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.png';
}

export function buildTenantLogoStorageKey(tenantId: string, fileName: string, mimeType: string): string {
  return path.posix.join(tenantId, `logo${safeExt(fileName, mimeType)}`);
}

export function buildTenantWallpaperStorageKey(tenantId: string, fileName: string, mimeType: string): string {
  return path.posix.join(tenantId, `wallpaper${safeExt(fileName, mimeType)}`);
}

export function getTenantLogoPath(storageKey: string): string {
  return path.join(resolveUploadRoot(), storageKey);
}

export async function saveTenantLogoFile(storageKey: string, buffer: Buffer): Promise<void> {
  const fullPath = getTenantLogoPath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

export async function deleteTenantLogoFile(storageKey: string): Promise<void> {
  const fullPath = getTenantLogoPath(storageKey);
  if (!existsSync(fullPath)) return;
  await unlink(fullPath);
}

export function openTenantLogoStream(storageKey: string) {
  const fullPath = getTenantLogoPath(storageKey);
  if (!existsSync(fullPath)) {
    throw new Error('Logotipo não encontrado');
  }
  return createReadStream(fullPath);
}
