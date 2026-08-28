import { prisma } from '@tvde/database';
import {
  WHATSAPP_BUSINESS_EVENT_KEYS,
  getRoleLabel,
  isDriverRole,
  type Role,
} from '@tvde/shared';
import {
  computeTempPasswordExpiresAt,
  generateSecurePasswordWithHibp,
  hashPassword,
} from '../lib/password';
import { createAuditLog } from './audit.service';
import { EmailNotConfiguredError, sendUserWelcomeEmail } from './email.service';
import { dispatchWhatsappBusinessEvent } from '../modules/whatsapp-business/whatsapp-business.notifications.service';

export class UserCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserCredentialsError';
  }
}

type TargetUser = {
  id: string;
  email: string;
  username: string | null;
  role: string;
  status: string;
  mustChangePassword: boolean;
  tenantId: string | null;
  tenant: { name: string; siteId: string } | null;
};

async function loadTargetUser(userId: string): Promise<TargetUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      status: true,
      mustChangePassword: true,
      tenantId: true,
      tenant: { select: { name: true, siteId: true } },
    },
  });
  if (!user || user.role === 'master') {
    throw new UserCredentialsError('Utilizador não encontrado');
  }
  return user;
}

async function rotateTemporaryPassword(userId: string): Promise<string> {
  const plainPassword = await generateSecurePasswordWithHibp();
  const expiresAt = computeTempPasswordExpiresAt();
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(plainPassword),
      mustChangePassword: true,
      tempPasswordExpiresAt: expiresAt,
    },
  });
  await prisma.session.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });
  return plainPassword;
}

async function notifyCredentials(
  user: TargetUser,
  plainPassword: string
): Promise<{ emailSent: boolean; whatsappSent: boolean; errors: string[] }> {
  if (!user.tenantId) {
    throw new UserCredentialsError('Utilizador sem tenant — não é possível enviar credenciais');
  }

  const roleLabel = getRoleLabel(user.role as Role);
  const eventKey = isDriverRole(user.role as Role)
    ? WHATSAPP_BUSINESS_EVENT_KEYS.userAccountDriver
    : user.role === 'superadmin'
      ? WHATSAPP_BUSINESS_EVENT_KEYS.userAccountManager
      : null;

  if (eventKey) {
    const notify = await dispatchWhatsappBusinessEvent(user.tenantId, eventKey, user.id, {
      temporaryPassword: plainPassword,
      roleLabel,
    });
    return {
      emailSent: notify.emailSent,
      whatsappSent: notify.whatsappSent,
      errors: notify.errors,
    };
  }

  // Staff / outros: email de boas-vindas directo
  await sendUserWelcomeEmail({
    tenantId: user.tenantId,
    to: user.email,
    tenantName: user.tenant?.name ?? 'TVDE',
    tenantSiteId: user.tenant?.siteId ?? '',
    userEmail: user.email,
    username: user.username ?? user.email,
    roleLabel,
    temporaryPassword: plainPassword,
  });
  return { emailSent: true, whatsappSent: false, errors: [] };
}

/**
 * Reenviar credenciais — apenas contas PENDING à espera da 1ª activação.
 */
export async function resendUserCredentials(input: {
  userId: string;
  actorUserId: string;
  ipAddress?: string;
}): Promise<{ emailSent: boolean; whatsappSent: boolean }> {
  const user = await loadTargetUser(input.userId);

  if (user.status !== 'pending') {
    throw new UserCredentialsError(
      'Reenviar credenciais só está disponível para contas PENDING (ainda não activadas).'
    );
  }

  const plainPassword = await rotateTemporaryPassword(user.id);

  let result: { emailSent: boolean; whatsappSent: boolean; errors: string[] };
  try {
    result = await notifyCredentials(user, plainPassword);
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      throw new UserCredentialsError(
        'SMTP não configurado — configure o email do tenant/plataforma e tente de novo'
      );
    }
    throw err;
  }

  if (!result.emailSent && !result.whatsappSent) {
    const detail = result.errors.length > 0 ? result.errors.join('; ') : 'nenhum canal enviou';
    throw new UserCredentialsError(`Não foi possível enviar credenciais: ${detail}`);
  }

  await createAuditLog({
    tenantId: user.tenantId,
    userId: input.actorUserId,
    action: 'user.credentials.resend',
    entityType: 'user',
    entityId: user.id,
    afterJson: {
      emailSent: result.emailSent,
      whatsappSent: result.whatsappSent,
      errors: result.errors,
    },
    ipAddress: input.ipAddress,
  });

  return { emailSent: result.emailSent, whatsappSent: result.whatsappSent };
}

/**
 * Reset de password por admin — contas ACTIVE (gera password temporária e notifica).
 */
export async function resetUserPasswordByAdmin(input: {
  userId: string;
  actorUserId: string;
  ipAddress?: string;
}): Promise<{ emailSent: boolean; whatsappSent: boolean }> {
  const user = await loadTargetUser(input.userId);

  if (user.status !== 'active') {
    throw new UserCredentialsError(
      'Reset de password só está disponível para contas ACTIVE. Use «Reenviar credenciais» se a conta estiver PENDING.'
    );
  }

  const plainPassword = await rotateTemporaryPassword(user.id);

  let result: { emailSent: boolean; whatsappSent: boolean; errors: string[] };
  try {
    result = await notifyCredentials(user, plainPassword);
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      throw new UserCredentialsError(
        'SMTP não configurado — configure o email do tenant/plataforma e tente de novo'
      );
    }
    throw err;
  }

  if (!result.emailSent && !result.whatsappSent) {
    const detail = result.errors.length > 0 ? result.errors.join('; ') : 'nenhum canal enviou';
    throw new UserCredentialsError(`Password actualizada mas falhou o envio: ${detail}`);
  }

  await createAuditLog({
    tenantId: user.tenantId,
    userId: input.actorUserId,
    action: 'user.password.reset',
    entityType: 'user',
    entityId: user.id,
    afterJson: {
      emailSent: result.emailSent,
      whatsappSent: result.whatsappSent,
      errors: result.errors,
      mustChangePassword: true,
    },
    ipAddress: input.ipAddress,
  });

  return { emailSent: result.emailSent, whatsappSent: result.whatsappSent };
}
