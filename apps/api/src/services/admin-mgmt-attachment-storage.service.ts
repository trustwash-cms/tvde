import path from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { env } from '../config/env';

function resolveUploadRoot(): string {
  const configured = env.adminMgmtUploadDir;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function buildAdminMgmtStorageKey(
  tenantId: string,
  entityType: string,
  entityId: string,
  fileName: string
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.posix.join(tenantId, entityType, entityId, safe);
}

export function getAdminMgmtAttachmentPath(storageKey: string): string {
  return path.join(resolveUploadRoot(), storageKey);
}

export async function saveAdminMgmtAttachmentFile(storageKey: string, buffer: Buffer): Promise<void> {
  const fullPath = getAdminMgmtAttachmentPath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

export async function deleteAdminMgmtAttachmentFile(storageKey: string): Promise<void> {
  try {
    await unlink(getAdminMgmtAttachmentPath(storageKey));
  } catch {
    /* ignore missing file */
  }
}

export function openAdminMgmtAttachmentStream(storageKey: string) {
  return createReadStream(getAdminMgmtAttachmentPath(storageKey));
}
