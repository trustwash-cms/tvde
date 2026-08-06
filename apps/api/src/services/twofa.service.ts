import { randomInt } from 'crypto';
import { prisma } from '@tvde/database';
import { getServerConfig } from '@tvde/shared/server';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import type { TwoFaMethod } from '@prisma/client';
import { decrypt, encrypt, generateToken, hashToken, isCryptoAuthFailure } from '../lib/crypto';
import { verifyPassword } from '../lib/password';
import { createAuditLog } from './audit.service';
import { assertLoginSiteId } from '../lib/login-site-id';
import { assertTenantActiveForLogin, assertTempPasswordValid } from '../lib/tenant-auth';
import { createSession } from './auth.service';
import { resolveSmtpConnection, EmailNotConfiguredError, sendTwoFaEmail } from './email.service';
import { resolveCommunicationFeatures } from './tenant-features.service';
import { getModuleCapabilities } from './tenant-modules.service';
import type { Role } from '@tvde/shared';
import { isSmsConfigured, maskPhone, sendOtpSms } from './sms.service';
import { getWhatsappBridgeStatus } from './whatsapp-bridge.client';
import { sendOtpWhatsappWithTemplate } from './whatsapp-template.service';

const BACKUP_CODE_COUNT = 8;
const OTP_EXPIRY_MS: Record<string, number> = {
  sms: 5 * 60_000,
  whatsapp: 5 * 60_000,
  email: 10 * 60_000,
};
const OTP_MAX_ATTEMPTS = 3;

export type Setup2faMethod = 'totp' | 'sms' | 'whatsapp' | 'email';

export interface TwoFaMethodOption {
  method: Setup2faMethod;
  available: boolean;
  reason?: string;
}

const METHOD_META: Record<Setup2faMethod, { label: string; description: string }> = {
  totp: { label: 'App autenticadora', description: 'Google Authenticator, Authy, etc.' },
  sms: { label: 'SMS', description: 'Código por SMS (Twilio)' },
  whatsapp: { label: 'WhatsApp', description: 'Código por WhatsApp' },
  email: { label: 'Email', description: 'Código enviado para o seu email' },
};

export function getTwoFaMethodMeta(method: Setup2faMethod) {
  return METHOD_META[method];
}

authenticator.options = { window: 1 };

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw = generateToken(4).slice(0, 8).toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

function verifyBackupCode(
  code: string,
  hashedCodes: string[]
): { valid: boolean; remaining: string[] } {
  const hash = hashToken(normalizeBackupCode(code));
  const idx = hashedCodes.indexOf(hash);
  if (idx === -1) return { valid: false, remaining: hashedCodes };
  return { valid: true, remaining: hashedCodes.filter((_, i) => i !== idx) };
}

function verifyTotpCode(encryptedSecret: string, code: string): boolean {
  const secret = decrypt(encryptedSecret);
  return authenticator.verify({ token: code.replace(/\s/g, ''), secret });
}

function generateOtpCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

function normalizeE164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) {
    throw new Error('Telefone deve estar em formato internacional (ex: +351912345678)');
  }
  return digits;
}

async function assertMethodAllowed(userId: string, role: string, method: Setup2faMethod) {
  const available = await getAvailable2faMethods(userId, role);
  if (!available.includes(method)) {
    throw new Error(`Método 2FA "${method}" não disponível`);
  }
}

async function isModuleActiveForUser(userId: string, moduleKey: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, tenantId: true, workspaceId: true },
  });
  if (!user) return false;
  const caps = await getModuleCapabilities(user.role as Role, user.tenantId, user.workspaceId);
  return caps.activeModules.includes(moduleKey);
}

export async function get2faMethodOptions(userId: string, role: string): Promise<TwoFaMethodOption[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true },
  });
  const features = await resolveCommunicationFeatures(role as Role, user?.tenantId ?? null);
  const wa = user?.tenantId
    ? await getWhatsappBridgeStatus(user.tenantId)
    : { connected: false, state: 'disconnected' as const, qrAvailable: false };

  let smsOk = false;
  try {
    smsOk = await isSmsConfigured();
  } catch {
    smsOk = false;
  }

  let emailOk = false;
  let emailReason = 'Configure SMTP da plataforma em Configurações';
  if (!user) {
    throw new Error('Utilizador não encontrado');
  }
  try {
    await resolveSmtpConnection(user?.tenantId ?? null);
    emailOk = true;
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      try {
        await resolveSmtpConnection(null);
        emailOk = true;
      } catch (inner) {
        if (!(inner instanceof EmailNotConfiguredError)) {
          // Password SMTP ilegível (ENCRYPTION_KEY) — não bloquear TOTP/SMS.
          emailReason =
            isCryptoAuthFailure(inner)
              ? 'SMTP ilegível (ENCRYPTION_KEY) — volte a guardar a password em Configurações → SMTP'
              : inner instanceof Error
                ? inner.message
                : emailReason;
        }
      }
    } else {
      emailReason = isCryptoAuthFailure(err)
        ? 'SMTP ilegível (ENCRYPTION_KEY) — volte a guardar a password em Configurações → SMTP'
        : err instanceof Error
          ? err.message
          : emailReason;
    }
  }

  const smsModuleOk = role === 'master' || (await isModuleActiveForUser(userId, 'sms'));
  const whatsappModuleOk = role === 'master' || (await isModuleActiveForUser(userId, 'whatsapp'));

  const options: TwoFaMethodOption[] = [{ method: 'totp', available: true }];

  options.push({
    method: 'sms',
    available: smsModuleOk && features.sms2faEnabled && smsOk,
    reason: !smsModuleOk
      ? 'Módulo SMS não activo para o seu tenant'
      : !features.sms2faEnabled
        ? '2FA por SMS desactivado — active em Configurações → SMS'
        : !smsOk
          ? 'SMS não configurado — contacte o administrador'
          : undefined,
  });

  options.push({
    method: 'whatsapp',
    available: whatsappModuleOk && features.whatsapp2faEnabled && wa.connected,
    reason: !whatsappModuleOk
      ? 'Módulo WhatsApp não activo para o seu tenant'
      : !features.whatsapp2faEnabled
        ? '2FA por WhatsApp desactivado — active em Configurações → WhatsApp'
        : !wa.connected
          ? 'WhatsApp não ligado — contacte o administrador'
          : undefined,
  });

  options.push({
    method: 'email',
    available: emailOk,
    reason: emailOk ? undefined : emailReason,
  });

  return options;
}

export async function getAvailable2faMethods(userId: string, role: string): Promise<Setup2faMethod[]> {
  const options = await get2faMethodOptions(userId, role);
  return options.filter((o) => o.available).map((o) => o.method);
}

export async function get2faStatus(userId: string, role: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFaMethod: true, twoFaSecret: true, phone: true },
  });
  if (!user) throw new Error('Utilizador não encontrado');

  const availableMethods = await getAvailable2faMethods(userId, role);
  const methodOptions = await get2faMethodOptions(userId, role);

  return {
    enabled: Boolean(user.twoFaMethod),
    method: user.twoFaMethod,
    pendingSetup: !user.twoFaMethod && !!user.twoFaSecret,
    phone: user.phone ? maskPhone(user.phone) : null,
    availableMethods,
    methodOptions,
  };
}

async function clearPendingCodes(userId: string) {
  await prisma.twoFaCode.deleteMany({ where: { userId } });
}

async function createOtpRecord(userId: string, method: string, code: string) {
  await clearPendingCodes(userId);
  const expiresAt = new Date(Date.now() + (OTP_EXPIRY_MS[method] ?? OTP_EXPIRY_MS.email));
  await prisma.twoFaCode.create({
    data: {
      userId,
      method,
      codeHash: hashToken(code),
      expiresAt,
    },
  });
  return expiresAt;
}

async function verifyOtpRecord(userId: string, method: string, code: string): Promise<boolean> {
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

  const valid = record.codeHash === hashToken(code.replace(/\s/g, ''));
  if (!valid) {
    await prisma.twoFaCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }

  await prisma.twoFaCode.delete({ where: { id: record.id } });
  return true;
}

async function sendEmailOtp(to: string, code: string, tenantId: string | null) {
  await sendTwoFaEmail({
    tenantId,
    to,
    code,
    expiresInMinutes: 10,
  });
}

export async function setup2fa(
  userId: string,
  role: string,
  method: Setup2faMethod,
  phone?: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Utilizador não encontrado');
  if (user.twoFaMethod) throw new Error('2FA já activo — desactive primeiro');

  await assertMethodAllowed(userId, role, method);

  if (method === 'totp') {
    return setupTotp(userId);
  }

  const code = generateOtpCode();
  await createOtpRecord(userId, method, code);

  if (method === 'sms') {
    if (!phone) throw new Error('Telefone obrigatório para 2FA SMS');
    const normalized = normalizeE164(phone);
    await sendOtpSms(normalized, code, userId);
    await prisma.user.update({
      where: { id: userId },
      data: { twoFaSecret: null, twoFaMethod: null, backupCodes: [], phone: normalized },
    });
    return { method, maskedPhone: maskPhone(normalized), message: 'Código SMS enviado' };
  }

  if (method === 'whatsapp') {
    if (!phone) throw new Error('Telefone obrigatório para 2FA WhatsApp');
    if (!user.tenantId) throw new Error('Tenant não definido');
    const normalized = normalizeE164(phone);
    await sendOtpWhatsappWithTemplate(user.tenantId, normalized, code);
    await prisma.user.update({
      where: { id: userId },
      data: { twoFaSecret: null, twoFaMethod: null, backupCodes: [], phone: normalized },
    });
    return { method, maskedPhone: maskPhone(normalized), message: 'Código WhatsApp enviado' };
  }

  if (method === 'email') {
    await sendEmailOtp(user.email, code, user.tenantId);
    await prisma.user.update({
      where: { id: userId },
      data: { twoFaSecret: null, twoFaMethod: null, backupCodes: [] },
    });
    return { method, maskedEmail: user.email.replace(/(.{2}).+(@.+)/, '$1***$2'), message: 'Código enviado por email' };
  }

  throw new Error('Método inválido');
}

export async function setupTotp(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Utilizador não encontrado');
  if (user.twoFaMethod) throw new Error('2FA já activo');

  await clearPendingCodes(userId);
  const secret = authenticator.generateSecret();
  const encrypted = encrypt(secret);

  await prisma.user.update({
    where: { id: userId },
    data: { twoFaSecret: encrypted, twoFaMethod: null, backupCodes: [] },
  });

  const { appName } = getServerConfig();
  const otpauthUrl = authenticator.keyuri(user.email, appName, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  return { method: 'totp' as const, otpauthUrl, secret, qrDataUrl };
}

export async function verify2faSetup(userId: string, method: Setup2faMethod, code: string) {
  if (method === 'totp') {
    return verifyTotpSetup(userId, code);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Utilizador não encontrado');
  if (user.twoFaMethod) throw new Error('2FA já activo');

  const valid = await verifyOtpRecord(userId, method, code);
  if (!valid) throw new Error('Código inválido');

  const backupCodes = generateBackupCodes();
  const hashedCodes = backupCodes.map((c) => hashToken(normalizeBackupCode(c)));

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFaMethod: method as TwoFaMethod,
      twoFaSecret: null,
      backupCodes: hashedCodes,
      phoneVerifiedAt: method === 'sms' || method === 'whatsapp' ? new Date() : user.phoneVerifiedAt,
    },
  });

  await createAuditLog({
    tenantId: user.tenantId,
    userId,
    action: 'auth.2fa_enabled',
    entityType: 'user',
    entityId: userId,
    afterJson: { method },
  });

  return { backupCodes, method };
}

export async function verifyTotpSetup(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFaSecret) throw new Error('Setup 2FA não iniciado');
  if (user.twoFaMethod) throw new Error('2FA já activo');

  if (!verifyTotpCode(user.twoFaSecret, code)) {
    throw new Error('Código inválido');
  }

  const backupCodes = generateBackupCodes();
  const hashedCodes = backupCodes.map((c) => hashToken(normalizeBackupCode(c)));

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFaMethod: 'totp',
      backupCodes: hashedCodes,
    },
  });

  await createAuditLog({
    tenantId: user.tenantId,
    userId,
    action: 'auth.2fa_enabled',
    entityType: 'user',
    entityId: userId,
    afterJson: { method: 'totp' },
  });

  return { backupCodes, method: 'totp' as const };
}

export async function sendLogin2faCode(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFaMethod || user.twoFaMethod === 'totp') {
    throw new Error('Este método não envia código');
  }

  const method = user.twoFaMethod;
  const code = generateOtpCode();
  await createOtpRecord(userId, method, code);

  if (method === 'sms') {
    if (!user.phone) throw new Error('Telefone não configurado');
    await sendOtpSms(user.phone, code, userId);
    return { method, maskedPhone: maskPhone(user.phone) };
  }

  if (method === 'whatsapp') {
    if (!user.phone) throw new Error('Telefone não configurado');
    if (!user.tenantId) throw new Error('Tenant não definido');
    await sendOtpWhatsappWithTemplate(user.tenantId, user.phone, code);
    return { method, maskedPhone: maskPhone(user.phone) };
  }

  if (method === 'email') {
    await sendEmailOtp(user.email, code, user.tenantId);
    return { method, maskedEmail: user.email.replace(/(.{2}).+(@.+)/, '$1***$2') };
  }

  throw new Error('Método não suportado');
}

export function get2faDeliveryHint(
  method: TwoFaMethod | null,
  user: { phone: string | null; email: string }
): string | undefined {
  if (!method || method === 'totp') return undefined;
  if (method === 'email') return user.email.replace(/(.{2}).+(@.+)/, '$1***$2');
  if (user.phone) return maskPhone(user.phone);
  return undefined;
}

interface Verify2faLoginInput {
  userId: string;
  code: string;
  siteId?: string;
  ipAddress: string;
  userAgent?: string;
}

export async function verify2faLogin(input: Verify2faLoginInput) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { tenant: true },
  });

  if (!user || user.status !== 'active' || !user.twoFaMethod) {
    throw new Error('Pedido de autenticação inválido');
  }

  assertLoginSiteId(user, input.siteId);

  let backupUsed = false;
  let remainingBackupCodes = user.backupCodes;

  if (user.twoFaMethod === 'totp') {
    if (!user.twoFaSecret) throw new Error('Configuração 2FA inválida');

    const totpValid = verifyTotpCode(user.twoFaSecret, input.code);
    if (!totpValid) {
      const backup = verifyBackupCode(input.code, user.backupCodes);
      if (!backup.valid) {
        await createAuditLog({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'auth.2fa_failed',
          entityType: 'user',
          entityId: user.id,
          ipAddress: input.ipAddress,
        });
        throw new Error('Código inválido');
      }
      backupUsed = true;
      remainingBackupCodes = backup.remaining;
    }
  } else {
    const otpValid = await verifyOtpRecord(user.id, user.twoFaMethod, input.code).catch((err) => {
      if (err instanceof Error && /expirado|tentativas/i.test(err.message)) throw err;
      return false;
    });

    if (!otpValid) {
      const backup = verifyBackupCode(input.code, user.backupCodes);
      if (!backup.valid) {
        await createAuditLog({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'auth.2fa_failed',
          entityType: 'user',
          entityId: user.id,
          ipAddress: input.ipAddress,
        });
        throw new Error('Código inválido');
      }
      backupUsed = true;
      remainingBackupCodes = backup.remaining;
    }
  }

  if (backupUsed) {
    await prisma.user.update({
      where: { id: user.id },
      data: { backupCodes: remainingBackupCodes },
    });
  }

  await createAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'auth.2fa_verified',
    entityType: 'user',
    entityId: user.id,
    ipAddress: input.ipAddress,
    afterJson: backupUsed ? { backupCodeUsed: true } : undefined,
  });

  assertTenantActiveForLogin(user);
  assertTempPasswordValid(user);

  return createSession(user, input.ipAddress, input.userAgent);
}

export async function disable2fa(userId: string, password: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFaMethod) throw new Error('2FA não activo');

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) throw new Error('Password incorrecta');

  let codeValid = false;

  if (user.twoFaMethod === 'totp' && user.twoFaSecret) {
    codeValid = verifyTotpCode(user.twoFaSecret, code);
    if (!codeValid) {
      const backup = verifyBackupCode(code, user.backupCodes);
      codeValid = backup.valid;
    }
  } else if (user.twoFaMethod !== 'totp') {
    codeValid = await verifyOtpRecord(user.id, user.twoFaMethod, code).catch(() => false);
    if (!codeValid) {
      const backup = verifyBackupCode(code, user.backupCodes);
      codeValid = backup.valid;
    }
  }

  if (!codeValid) throw new Error('Código inválido');

  await clearPendingCodes(userId);
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFaMethod: null,
      twoFaSecret: null,
      backupCodes: [],
      phone: null,
      phoneVerifiedAt: null,
    },
  });

  await createAuditLog({
    tenantId: user.tenantId,
    userId,
    action: 'auth.2fa_disabled',
    entityType: 'user',
    entityId: userId,
  });

  return { success: true };
}

/** @deprecated use disable2fa */
export const disableTotp = disable2fa;
