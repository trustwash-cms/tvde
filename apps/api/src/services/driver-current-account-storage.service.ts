import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';

function resolveUploadRoot(): string {
  const configured = env.driverCurrentAccountUploadDir;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function buildDriverCurrentAccountStorageKey(
  tenantId: string,
  entryId: string,
  fileName: string
): string {
  const ext = path.extname(fileName).toLowerCase().slice(0, 10);
  const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext : '';
  return path.posix.join(tenantId, entryId, `${randomUUID()}${safeExt}`);
}

export function getDriverCurrentAccountPath(storageKey: string): string {
  return path.join(resolveUploadRoot(), storageKey);
}

export async function saveDriverCurrentAccountFile(
  storageKey: string,
  buffer: Buffer
): Promise<void> {
  const fullPath = getDriverCurrentAccountPath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

export async function deleteDriverCurrentAccountFile(storageKey: string): Promise<void> {
  const fullPath = getDriverCurrentAccountPath(storageKey);
  if (!existsSync(fullPath)) return;
  await unlink(fullPath);
}

export function openDriverCurrentAccountStream(storageKey: string) {
  const fullPath = getDriverCurrentAccountPath(storageKey);
  if (!existsSync(fullPath)) {
    throw new Error('Ficheiro não encontrado');
  }
  return createReadStream(fullPath);
}
