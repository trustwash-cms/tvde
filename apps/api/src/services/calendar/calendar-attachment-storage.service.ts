import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';

function resolveUploadRoot(): string {
  const configured = env.calendarUploadDir;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function buildCalendarStorageKey(tenantId: string, eventId: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
  return path.posix.join(tenantId, eventId, `${randomUUID()}-${safeName}`);
}

export function getCalendarAttachmentPath(storageKey: string): string {
  return path.join(resolveUploadRoot(), storageKey);
}

export async function saveCalendarAttachmentFile(
  storageKey: string,
  buffer: Buffer
): Promise<void> {
  const fullPath = getCalendarAttachmentPath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

export async function deleteCalendarAttachmentFile(storageKey: string): Promise<void> {
  const fullPath = getCalendarAttachmentPath(storageKey);
  if (!existsSync(fullPath)) return;
  await unlink(fullPath);
}

export function openCalendarAttachmentStream(storageKey: string) {
  const fullPath = getCalendarAttachmentPath(storageKey);
  if (!existsSync(fullPath)) {
    throw new Error('Ficheiro não encontrado');
  }
  return createReadStream(fullPath);
}
