import { createReadStream, existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@tvde/database';
import { env } from '../config/env';

const AVATAR_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function resolveAvatarRoot(): string {
  const configured = env.userDocumentsUploadDir;
  const base = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  return path.join(path.dirname(base), 'avatars');
}

export function isAllowedAvatarMime(mime: string): boolean {
  return AVATAR_MIME.has(mime.toLowerCase());
}

export function getAvatarMaxBytes(): number {
  return AVATAR_MAX_BYTES;
}

function avatarPath(storageKey: string): string {
  return path.join(resolveAvatarRoot(), storageKey);
}

export async function uploadUserAvatar(
  db: PrismaClient,
  userId: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ avatarStorageKey: string; avatarUpdatedAt: string }> {
  if (!isAllowedAvatarMime(mimeType)) {
    throw new Error('Formato inválido — use JPEG, PNG ou WebP');
  }
  if (buffer.length > AVATAR_MAX_BYTES) {
    throw new Error('Foto demasiado grande (máx. 2 MB)');
  }

  const ext =
    mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const storageKey = path.posix.join(userId, `${randomUUID()}.${ext}`);
  const fullPath = avatarPath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);

  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { avatarStorageKey: true },
  });
  if (existing?.avatarStorageKey) {
    const oldPath = avatarPath(existing.avatarStorageKey);
    if (existsSync(oldPath)) await unlink(oldPath).catch(() => undefined);
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      avatarStorageKey: storageKey,
      avatarMimeType: mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType.toLowerCase(),
      avatarUpdatedAt: new Date(),
    },
    select: { avatarStorageKey: true, avatarUpdatedAt: true },
  });

  return {
    avatarStorageKey: updated.avatarStorageKey!,
    avatarUpdatedAt: updated.avatarUpdatedAt!.toISOString(),
  };
}

export async function deleteUserAvatar(db: PrismaClient, userId: string): Promise<void> {
  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { avatarStorageKey: true },
  });
  if (!existing?.avatarStorageKey) return;

  const fullPath = avatarPath(existing.avatarStorageKey);
  if (existsSync(fullPath)) await unlink(fullPath).catch(() => undefined);

  await db.user.update({
    where: { id: userId },
    data: {
      avatarStorageKey: null,
      avatarMimeType: null,
      avatarUpdatedAt: null,
    },
  });
}

export async function getUserAvatarDownload(
  db: PrismaClient,
  userId: string
): Promise<{ stream: ReturnType<typeof createReadStream>; mimeType: string } | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { avatarStorageKey: true, avatarMimeType: true },
  });
  if (!user?.avatarStorageKey) return null;
  const fullPath = avatarPath(user.avatarStorageKey);
  if (!existsSync(fullPath)) return null;
  return {
    stream: createReadStream(fullPath),
    mimeType: user.avatarMimeType ?? 'image/jpeg',
  };
}
