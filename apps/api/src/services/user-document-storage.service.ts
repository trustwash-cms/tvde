import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';

function resolveUploadRoot(): string {
  const configured = env.userDocumentsUploadDir;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function buildUserDocumentStorageKey(tenantId: string, userId: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
  return path.posix.join(tenantId, userId, `${randomUUID()}-${safeName}`);
}

export function getUserDocumentPath(storageKey: string): string {
  return path.join(resolveUploadRoot(), storageKey);
}

export async function saveUserDocumentFile(storageKey: string, buffer: Buffer): Promise<void> {
  const fullPath = getUserDocumentPath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

export async function deleteUserDocumentFile(storageKey: string): Promise<void> {
  const fullPath = getUserDocumentPath(storageKey);
  if (!existsSync(fullPath)) return;
  await unlink(fullPath);
}

export function openUserDocumentStream(storageKey: string) {
  const fullPath = getUserDocumentPath(storageKey);
  if (!existsSync(fullPath)) {
    throw new Error('Ficheiro não encontrado');
  }
  return createReadStream(fullPath);
}
