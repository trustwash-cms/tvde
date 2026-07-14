import { randomInt } from 'crypto';
import { prisma } from '@tvde/database';
import { hasMinRole, type Role } from '@tvde/shared';
import { hashToken } from '../lib/crypto';
import {
  resolveSmtpConnection,
  EmailNotConfiguredError,
  sendTenantDeleteConfirmationEmail,
  sendCarwashActionConfirmationEmail,
  sendCarwashActionRequestEmail,
} from './email.service';

const OTP_EXPIRY_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 3;

function tenantDeleteMethod(tenantId: string) {
  return `tenant_delete:${tenantId}`;
}

function generateOtpCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

function maskEmail(email: string): string {
  return email.replace(/(.{2}).+(@.+)/, '$1***$2');
}

async function assertPlatformEmailAvailable() {
  try {
    await resolveSmtpConnection(null);
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      throw new Error('SMTP da plataforma não configurado — não é possível enviar código de confirmação');
    }
    throw err;
  }
}

async function assertTenantEmailAvailable(tenantId: string) {
  try {
    await resolveSmtpConnection(tenantId);
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      throw new Error(
        'Email não configurado — configure SMTP em Definições → Email ou contacte o administrador'
      );
    }
    throw err;
  }
}

async function createScopedOtp(userId: string, method: string, code: string) {
  await prisma.twoFaCode.deleteMany({ where: { userId, method } });
  await prisma.twoFaCode.create({
    data: {
      userId,
      method,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    },
  });
}

async function verifyScopedOtp(userId: string, method: string, code: string): Promise<void> {
  const record = await prisma.twoFaCode.findFirst({
    where: { userId, method },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.expiresAt < new Date()) {
    throw new Error('Código expirado — solicite um novo');
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    throw new Error('Demasiadas tentativas — solicite um novo código');
  }

  const normalized = code.replace(/\s/g, '');
  const valid = record.codeHash === hashToken(normalized);
  if (!valid) {
    await prisma.twoFaCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new Error('Código inválido');
  }

  await prisma.twoFaCode.delete({ where: { id: record.id } });
}

export async function sendTenantDeleteConfirmationCode(
  userId: string,
  tenant: { id: string; siteId: string; name: string }
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true },
  });
  if (!user || user.role !== 'master') {
    throw new Error('Apenas MASTER pode eliminar tenants');
  }

  await assertPlatformEmailAvailable();

  const code = generateOtpCode();
  const method = tenantDeleteMethod(tenant.id);
  await createScopedOtp(userId, method, code);

  await sendTenantDeleteConfirmationEmail({
    to: user.email,
    tenantName: tenant.name,
    tenantSiteId: tenant.siteId,
    confirmationCode: code,
    expiresInMinutes: 10,
  });

  return {
    sent: true as const,
    maskedEmail: maskEmail(user.email),
    expiresInMinutes: 10,
  };
}

export async function verifyTenantDeleteConfirmationCode(
  userId: string,
  tenantId: string,
  code: string
) {
  await verifyScopedOtp(userId, tenantDeleteMethod(tenantId), code);
}

export type CarwashSensitiveAction = 'reopen' | 'delete';

const CARWASH_ACTION_LABELS: Record<CarwashSensitiveAction, string> = {
  reopen: 'reabrir folha de obra',
  delete: 'eliminar folha de obra',
};

function carwashActionMethod(userId: string, workSheetId: string, action: CarwashSensitiveAction) {
  return `carwash_${action}:${userId}:${workSheetId}`;
}

async function getTenantSuperadminEmails(tenantId: string) {
  const users = await prisma.user.findMany({
    where: { tenantId, role: 'superadmin', status: 'active' },
    select: { id: true, email: true },
  });
  return users;
}

export async function sendCarwashActionConfirmationCode(input: {
  userId: string;
  tenantId: string;
  workSheetId: string;
  action: CarwashSensitiveAction;
  workSheetReference: string;
  workSheetTitle: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, role: true },
  });
  if (!user || !hasMinRole(user.role as Role, 'superadmin')) {
    throw new Error('Apenas superadmin pode confirmar esta acção com código por email');
  }

  await assertPlatformEmailAvailable();

  const code = generateOtpCode();
  await createScopedOtp(
    input.userId,
    carwashActionMethod(input.userId, input.workSheetId, input.action),
    code
  );

  await sendCarwashActionConfirmationEmail({
    to: user.email,
    actionLabel: CARWASH_ACTION_LABELS[input.action],
    workSheetReference: input.workSheetReference,
    workSheetTitle: input.workSheetTitle,
    confirmationCode: code,
    expiresInMinutes: 10,
  });

  return {
    sent: true as const,
    maskedEmail: maskEmail(user.email),
    expiresInMinutes: 10,
  };
}

export async function verifyCarwashActionConfirmationCode(
  userId: string,
  workSheetId: string,
  action: CarwashSensitiveAction,
  code: string
) {
  await verifyScopedOtp(userId, carwashActionMethod(userId, workSheetId, action), code);
}

export async function requestCarwashActionAuthorization(input: {
  requesterId: string;
  requesterEmail: string;
  tenantId: string;
  workSheetId: string;
  action: CarwashSensitiveAction;
  workSheetReference: string;
  workSheetTitle: string;
}) {
  const requester = await prisma.user.findUnique({
    where: { id: input.requesterId },
    select: { role: true },
  });
  if (!requester || hasMinRole(requester.role as Role, 'superadmin')) {
    throw new Error('Superadmin deve usar confirmação por código');
  }

  await assertTenantEmailAvailable(input.tenantId);

  const superadmins = await getTenantSuperadminEmails(input.tenantId);
  if (!superadmins.length) {
    throw new Error('Nenhum superadmin activo neste tenant para autorizar a acção');
  }

  await Promise.all(
    superadmins.map((admin) =>
      sendCarwashActionRequestEmail({
        tenantId: input.tenantId,
        to: admin.email,
        actionLabel: CARWASH_ACTION_LABELS[input.action],
        workSheetReference: input.workSheetReference,
        workSheetTitle: input.workSheetTitle,
        requesterEmail: input.requesterEmail,
      })
    )
  );

  return { requested: true as const, notified: superadmins.length };
}

function carwashCashSheetEditMethod(userId: string, cashSheetId: string) {
  return `carwash_edit_cash_sheet:${userId}:${cashSheetId}`;
}

export async function sendCarwashCashSheetEditConfirmationCode(input: {
  userId: string;
  cashSheetId: string;
  businessDate: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, role: true },
  });
  if (!user || !hasMinRole(user.role as Role, 'superadmin')) {
    throw new Error('Apenas superadmin pode alterar folha de caixa fechada');
  }

  await assertPlatformEmailAvailable();

  const code = generateOtpCode();
  await createScopedOtp(input.userId, carwashCashSheetEditMethod(input.userId, input.cashSheetId), code);

  await sendCarwashActionConfirmationEmail({
    to: user.email,
    actionLabel: 'alterar folha de caixa',
    workSheetReference: input.businessDate,
    workSheetTitle: 'Mapa de vendas / fecho do dia',
    confirmationCode: code,
    expiresInMinutes: 10,
  });

  return {
    sent: true as const,
    maskedEmail: maskEmail(user.email),
    expiresInMinutes: 10,
  };
}

export async function verifyCarwashCashSheetEditConfirmationCode(
  userId: string,
  cashSheetId: string,
  code: string
) {
  await verifyScopedOtp(userId, carwashCashSheetEditMethod(userId, cashSheetId), code);
}
