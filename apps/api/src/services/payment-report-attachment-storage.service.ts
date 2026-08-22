import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';

function resolveUploadRoot(): string {
  const configured = env.paymentReceiptsUploadDir;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function buildPaymentReceiptStorageKey(
  tenantId: string,
  reportId: string,
  fileName: string
): string {
  const ext = path.extname(fileName).toLowerCase().slice(0, 10);
  const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext : '';
  return path.posix.join(tenantId, reportId, `${randomUUID()}${safeExt}`);
}

export function getPaymentReceiptPath(storageKey: string): string {
  return path.join(resolveUploadRoot(), storageKey);
}

export async function savePaymentReceiptFile(
  storageKey: string,
  buffer: Buffer
): Promise<void> {
  const fullPath = getPaymentReceiptPath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
}

export async function deletePaymentReceiptFile(storageKey: string): Promise<void> {
  const fullPath = getPaymentReceiptPath(storageKey);
  if (!existsSync(fullPath)) return;
  await unlink(fullPath);
}

export async function deletePaymentReceiptDir(
  tenantId: string,
  reportId: string
): Promise<void> {
  const dir = path.join(resolveUploadRoot(), tenantId, reportId);
  if (!existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
}

export function openPaymentReceiptStream(storageKey: string) {
  const fullPath = getPaymentReceiptPath(storageKey);
  if (!existsSync(fullPath)) {
    throw new Error('Ficheiro não encontrado');
  }
  return createReadStream(fullPath);
}
