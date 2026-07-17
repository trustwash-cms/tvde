import type { Prisma, PrismaClient, UserDocumentType, UserDocumentVisibility } from '@tvde/database';
import {
  USER_DOCUMENT_MAX_BYTES,
  canEditUserProfile,
  canViewUserProfile,
  isAllowedUserDocumentMime,
  type Role,
  type UserDocumentItem,
  type UserProfileDetail,
  type UserProfileFields,
} from '@tvde/shared';
import { createAuditLog } from './audit.service';
import { assertTenantStorageQuota, TenantStorageQuotaError } from './tenant-storage.service';
import {
  buildUserDocumentStorageKey,
  deleteUserDocumentFile,
  saveUserDocumentFile,
} from './user-document-storage.service';

export class UserProfileAccessError extends Error {
  constructor(message = 'Sem permissão') {
    super(message);
    this.name = 'UserProfileAccessError';
  }
}

export class UserProfileNotFoundError extends Error {
  constructor(message = 'Utilizador não encontrado') {
    super(message);
    this.name = 'UserProfileNotFoundError';
  }
}

export class UserDocumentNotFoundError extends Error {
  constructor(message = 'Documento não encontrado') {
    super(message);
    this.name = 'UserDocumentNotFoundError';
  }
}

const userSelect = {
  id: true,
  email: true,
  username: true,
  fullName: true,
  phone: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  twoFaMethod: true,
  tenantId: true,
  tenant: { select: { id: true, siteId: true, name: true } },
} satisfies Prisma.UserSelect;

function mapProfile(profile: {
  nif: string | null;
  ccAutorizacaoResidencia: string | null;
  numeroOperadorTvde: string | null;
  distrito: string | null;
  concelho: string | null;
  localidade: string | null;
  arruamento: string | null;
  numeroPorta: string | null;
  codigoPostal: string | null;
} | null): UserProfileFields | null {
  if (!profile) return null;
  return {
    nif: profile.nif,
    ccAutorizacaoResidencia: profile.ccAutorizacaoResidencia,
    numeroOperadorTvde: profile.numeroOperadorTvde,
    distrito: profile.distrito,
    concelho: profile.concelho,
    localidade: profile.localidade,
    arruamento: profile.arruamento,
    numeroPorta: profile.numeroPorta,
    codigoPostal: profile.codigoPostal,
  };
}

function mapDocument(doc: {
  id: string;
  userId: string;
  documentType: UserDocumentType;
  visibility: UserDocumentVisibility;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: Date;
}): UserDocumentItem {
  return {
    id: doc.id,
    userId: doc.userId,
    documentType: doc.documentType,
    visibility: doc.visibility,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    uploadedByUserId: doc.uploadedByUserId,
    createdAt: doc.createdAt.toISOString(),
  };
}

function trimOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function getTargetUser(db: PrismaClient, userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: userSelect,
  });
}

function assertTenantScope(
  actorRole: Role,
  actorTenantId: string | null,
  targetTenantId: string | null
): void {
  if (actorRole === 'master') return;
  if (!targetTenantId || targetTenantId !== actorTenantId) {
    throw new UserProfileNotFoundError();
  }
}

export async function getUserProfileDetail(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string
): Promise<UserProfileDetail> {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master') {
    throw new UserProfileNotFoundError();
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);

  if (!canViewUserProfile(actorId, actorRole, user.id, user.role)) {
    throw new UserProfileAccessError();
  }

  const [profile, documents] = await Promise.all([
    db.userProfile.findUnique({ where: { userId: targetUserId } }),
    db.userDocument.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      twoFaMethod: user.twoFaMethod,
      tenant: user.tenant,
    },
    profile: mapProfile(profile),
    documents: documents.map(mapDocument),
  };
}

export interface UpdateUserProfileInput {
  fullName?: string;
  nif?: string;
  ccAutorizacaoResidencia?: string;
  numeroOperadorTvde?: string;
  distrito?: string;
  concelho?: string;
  localidade?: string;
  arruamento?: string;
  numeroPorta?: string;
  codigoPostal?: string;
}

export async function updateUserProfile(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string,
  input: UpdateUserProfileInput,
  ipAddress?: string
): Promise<UserProfileDetail> {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master') {
    throw new UserProfileNotFoundError();
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);

  if (!canEditUserProfile(actorId, actorRole, user.id, user.role)) {
    throw new UserProfileAccessError();
  }

  const profileData = {
    nif: trimOrNull(input.nif),
    ccAutorizacaoResidencia: trimOrNull(input.ccAutorizacaoResidencia),
    numeroOperadorTvde: trimOrNull(input.numeroOperadorTvde),
    distrito: trimOrNull(input.distrito),
    concelho: trimOrNull(input.concelho),
    localidade: trimOrNull(input.localidade),
    arruamento: trimOrNull(input.arruamento),
    numeroPorta: trimOrNull(input.numeroPorta),
    codigoPostal: trimOrNull(input.codigoPostal),
  };

  const fullName = input.fullName !== undefined ? trimOrNull(input.fullName) : undefined;

  await db.$transaction(async (tx) => {
    if (fullName !== undefined) {
      await tx.user.update({
        where: { id: targetUserId },
        data: { fullName },
      });
    }

    await tx.userProfile.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, ...profileData },
      update: profileData,
    });
  });

  await createAuditLog({
    tenantId: user.tenantId,
    userId: actorId,
    action: 'user.profile.update',
    entityType: 'user',
    entityId: targetUserId,
    afterJson: { ...profileData, fullName: fullName ?? user.fullName },
    ipAddress,
  });

  return getUserProfileDetail(db, actorId, actorRole, actorTenantId, targetUserId);
}

export async function uploadUserDocument(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string,
  input: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    documentType: UserDocumentType;
    visibility: UserDocumentVisibility;
  },
  ipAddress?: string
): Promise<UserDocumentItem> {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master') {
    throw new UserProfileNotFoundError();
  }

  if (!user.tenantId) {
    throw new Error('Utilizador sem tenant');
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);

  if (!canEditUserProfile(actorId, actorRole, user.id, user.role)) {
    throw new UserProfileAccessError();
  }

  if (input.buffer.length > USER_DOCUMENT_MAX_BYTES) {
    throw new Error('Ficheiro demasiado grande (máx. 5 MB)');
  }

  if (!isAllowedUserDocumentMime(input.mimeType)) {
    throw new Error('Tipo de ficheiro não permitido (PDF, JPG ou PNG)');
  }

  await assertTenantStorageQuota(db, user.tenantId, input.buffer.length);

  const storageKey = buildUserDocumentStorageKey(user.tenantId, targetUserId, input.fileName);
  await saveUserDocumentFile(storageKey, input.buffer);

  let doc;
  try {
    doc = await db.userDocument.create({
      data: {
        userId: targetUserId,
        tenantId: user.tenantId,
        documentType: input.documentType,
        visibility: input.visibility,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        storageKey,
        uploadedByUserId: actorId,
      },
    });
  } catch (err) {
    await deleteUserDocumentFile(storageKey);
    throw err;
  }

  await createAuditLog({
    tenantId: user.tenantId,
    userId: actorId,
    action: 'user.document.upload',
    entityType: 'user_document',
    entityId: doc.id,
    afterJson: {
      userId: targetUserId,
      documentType: input.documentType,
      fileName: input.fileName,
      sizeBytes: input.buffer.length,
    },
    ipAddress,
  });

  return mapDocument(doc);
}

export async function deleteUserDocument(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string,
  documentId: string,
  ipAddress?: string
): Promise<void> {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master') {
    throw new UserProfileNotFoundError();
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);

  if (!canEditUserProfile(actorId, actorRole, user.id, user.role)) {
    throw new UserProfileAccessError();
  }

  const doc = await db.userDocument.findFirst({
    where: { id: documentId, userId: targetUserId },
  });

  if (!doc) {
    throw new UserDocumentNotFoundError();
  }

  await db.userDocument.delete({ where: { id: documentId } });
  await deleteUserDocumentFile(doc.storageKey);

  await createAuditLog({
    tenantId: user.tenantId,
    userId: actorId,
    action: 'user.document.delete',
    entityType: 'user_document',
    entityId: documentId,
    beforeJson: { userId: targetUserId, fileName: doc.fileName },
    ipAddress,
  });
}

export async function getUserDocumentForDownload(
  db: PrismaClient,
  actorId: string,
  actorRole: Role,
  actorTenantId: string | null,
  targetUserId: string,
  documentId: string
) {
  const user = await getTargetUser(db, targetUserId);
  if (!user || user.role === 'master') {
    throw new UserProfileNotFoundError();
  }

  assertTenantScope(actorRole, actorTenantId, user.tenantId);

  if (!canViewUserProfile(actorId, actorRole, user.id, user.role)) {
    throw new UserProfileAccessError();
  }

  const doc = await db.userDocument.findFirst({
    where: { id: documentId, userId: targetUserId },
  });

  if (!doc) {
    throw new UserDocumentNotFoundError();
  }

  return doc;
}

export function handleUserProfileError(err: unknown): { status: number; message: string } {
  if (err instanceof UserProfileAccessError) {
    return { status: 403, message: err.message };
  }
  if (err instanceof UserProfileNotFoundError || err instanceof UserDocumentNotFoundError) {
    return { status: 404, message: err.message };
  }
  if (err instanceof TenantStorageQuotaError) {
    return { status: 413, message: err.message };
  }
  if (err instanceof Error) {
    return { status: 400, message: err.message };
  }
  return { status: 500, message: 'Erro interno' };
}
