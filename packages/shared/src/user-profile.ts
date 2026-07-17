import type { Role } from './roles';
import { canManageUser } from './permissions';

export const USER_DOCUMENT_TYPES = [
  'comprovativo_morada',
  'cc_autorizacao_residencia',
  'licenca_tvde',
  'carta_conducao',
  'contrato_motorista',
] as const;

export type UserDocumentType = (typeof USER_DOCUMENT_TYPES)[number];

export const USER_DOCUMENT_TYPE_LABELS: Record<UserDocumentType, string> = {
  comprovativo_morada: 'Comprovativo de morada',
  cc_autorizacao_residencia: 'CC ou Autorização de Residência',
  licenca_tvde: 'Licença TVDE',
  carta_conducao: 'Carta de condução',
  contrato_motorista: 'Contrato de motorista',
};

export const USER_DOCUMENT_VISIBILITIES = ['private', 'public'] as const;
export type UserDocumentVisibility = (typeof USER_DOCUMENT_VISIBILITIES)[number];

export const USER_DOCUMENT_VISIBILITY_LABELS: Record<UserDocumentVisibility, string> = {
  private: 'Privado',
  public: 'Público (tenant)',
};

export const USER_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
] as const;

export const USER_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

export interface UserProfileFields {
  nif: string | null;
  ccAutorizacaoResidencia: string | null;
  numeroOperadorTvde: string | null;
  distrito: string | null;
  concelho: string | null;
  localidade: string | null;
  arruamento: string | null;
  numeroPorta: string | null;
  codigoPostal: string | null;
}

export interface UserDocumentItem {
  id: string;
  userId: string;
  documentType: UserDocumentType;
  visibility: UserDocumentVisibility;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

export interface UserProfileDetailUser {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  phone: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  twoFaMethod: string | null;
  tenant?: { id: string; siteId: string; name: string } | null;
}

export interface UserProfileDetail {
  user: UserProfileDetailUser;
  profile: UserProfileFields | null;
  documents: UserDocumentItem[];
}

export function canViewUserProfile(
  actorId: string,
  actorRole: Role,
  targetUserId: string,
  targetRole: Role
): boolean {
  if (actorId === targetUserId) return true;
  if (targetRole === 'master') return false;
  if (actorRole === 'master') return true;
  return canManageUser(actorRole, targetRole);
}

export function canEditUserProfile(
  actorId: string,
  actorRole: Role,
  targetUserId: string,
  targetRole: Role
): boolean {
  return canViewUserProfile(actorId, actorRole, targetUserId, targetRole);
}

export function isAllowedUserDocumentMime(mime: string): boolean {
  const normalized = mime.toLowerCase();
  return USER_DOCUMENT_MIME_TYPES.some((allowed) => allowed === normalized);
}
