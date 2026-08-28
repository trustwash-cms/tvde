import { prisma, setTenantContext } from '@tvde/database';
import { getSessionRefreshExpiresMs } from '@tvde/shared/server';
import type { JwtPayload } from '@tvde/shared';
import { generateToken, hashToken } from '../lib/crypto';
import { verifyPassword, validatePassword, validatePasswordWithHibp, hashPassword, isPasswordReused } from '../lib/password';
import { revokeAccessToken } from '../lib/token-blacklist';
import { getServerConfig } from '@tvde/shared/server';
import { WEB_ROUTES } from '@tvde/shared';
import { checkFail2ban, recordFailedLogin, clearFail2ban } from '../lib/redis';
import { createAuditLog } from './audit.service';
import { sendPasswordResetEmail, EmailNotConfiguredError } from './email.service';
import { sendLogin2faCode, get2faDeliveryHint } from './twofa.service';
import { assertLoginSiteId } from '../lib/login-site-id';
import { assertTenantActiveForLogin, assertTempPasswordValid } from '../lib/tenant-auth';

interface LoginInput {
  email: string;
  password: string;
  siteId?: string;
  ipAddress: string;
  userAgent?: string;
}

interface LoginResult {
  requires2fa: boolean;
  userId?: string;
  twoFaMethod?: string;
  deliveryHint?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: {
    id: string;
    email: string;
    role: string;
    tenantId: string | null;
    workspaceId: string | null;
    siteId: string | null;
    mustChangePassword: boolean;
  };
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const { blocked } = await checkFail2ban(input.ipAddress);
  if (blocked) {
    throw new Error('IP temporariamente bloqueado. Tente novamente em 15 minutos.');
  }

  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { tenant: true },
  });

  // PENDING: permitido só para activar conta (password temporária / 1º login).
  // SUSPENDED: bloqueado.
  const canLogin =
    user &&
    (user.status === 'active' ||
      (user.status === 'pending' && user.mustChangePassword));
  if (!canLogin) {
    await recordFailedLogin(input.ipAddress);
    await prisma.loginAttempt.create({
      data: {
        email: input.email,
        ipAddress: input.ipAddress,
        success: false,
        failureReason: 'invalid_credentials',
        tenantId: user?.tenantId ?? null,
      },
    });
    throw new Error('Credenciais inválidas');
  }

  assertLoginSiteId(user, input.siteId);

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(input.ipAddress);
    await prisma.loginAttempt.create({
      data: {
        email: input.email,
        ipAddress: input.ipAddress,
        success: false,
        failureReason: 'invalid_password',
        tenantId: user.tenantId,
      },
    });
    throw new Error('Credenciais inválidas');
  }

  assertTenantActiveForLogin(user);
  assertTempPasswordValid(user);

  await clearFail2ban(input.ipAddress);
  await prisma.loginAttempt.create({
    data: {
      email: input.email,
      ipAddress: input.ipAddress,
      success: true,
      tenantId: user.tenantId,
    },
  });

  if (user.twoFaMethod) {
    if (user.twoFaMethod !== 'totp') {
      await sendLogin2faCode(user.id);
    }
    return {
      requires2fa: true,
      userId: user.id,
      twoFaMethod: user.twoFaMethod,
      deliveryHint: get2faDeliveryHint(user.twoFaMethod, user) ?? undefined,
    };
  }

  return createSession(user, input.ipAddress, input.userAgent);
}

async function createSession(
  user: {
    id: string;
    email: string;
    role: string;
    tenantId: string | null;
    workspaceId: string | null;
    mustChangePassword: boolean;
    tenant: { siteId: string } | null;
  },
  ipAddress: string,
  userAgent?: string
): Promise<LoginResult> {
  const refreshToken = generateToken(48);
  const expiresAt = new Date(Date.now() + getSessionRefreshExpiresMs());

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      tokenHash: hashToken(refreshToken),
      ipAddress,
      userAgent: userAgent ?? null,
      deviceInfo: userAgent?.slice(0, 100) ?? null,
      expiresAt,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await createAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'auth.login',
    entityType: 'session',
    entityId: session.id,
    ipAddress,
  });

  return {
    requires2fa: false,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      siteId: user.tenant?.siteId ?? null,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function buildJwtPayload(
  userId: string,
  sessionId: string
): Promise<JwtPayload | null> {
  const [user, session] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    }),
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { impersonatorId: true, isActive: true },
    }),
  ]);
  const canUseSession =
    user &&
    (user.status === 'active' ||
      (user.status === 'pending' && user.mustChangePassword));
  if (!canUseSession) return null;
  if (!session || !session.isActive) return null;

  try {
    assertTenantActiveForLogin(user);
  } catch {
    return null;
  }

  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role as JwtPayload['role'],
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    siteId: user.tenant?.siteId ?? null,
    sessionId,
  };

  if (session.impersonatorId) {
    payload.impersonatorId = session.impersonatorId;
  }

  return payload;
}

export class ImpersonationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImpersonationError';
  }
}

export async function startImpersonation(input: {
  masterId: string;
  masterRole: string;
  masterSessionId: string;
  targetUserId: string;
  ipAddress: string;
  userAgent?: string;
}): Promise<{
  refreshToken: string;
  sessionId: string;
  user: {
    id: string;
    email: string;
    role: string;
    tenantId: string | null;
    workspaceId: string | null;
    siteId: string | null;
    mustChangePassword: boolean;
  };
}> {
  if (input.masterRole !== 'master') {
    throw new ImpersonationError('Apenas o MASTER pode personificar utilizadores');
  }

  const masterSession = await prisma.session.findFirst({
    where: {
      id: input.masterSessionId,
      userId: input.masterId,
      isActive: true,
      expiresAt: { gt: new Date() },
    },
  });

  if (!masterSession) {
    throw new ImpersonationError('Sessão MASTER inválida');
  }

  if (masterSession.impersonatorId) {
    throw new ImpersonationError('Já está em modo de personificação — saia primeiro');
  }

  if (input.targetUserId === input.masterId) {
    throw new ImpersonationError('Não pode personificar a sua própria conta');
  }

  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    include: { tenant: true },
  });

  if (!target || target.status !== 'active') {
    throw new ImpersonationError('Utilizador alvo inválido ou inactivo');
  }

  if (target.role === 'master') {
    throw new ImpersonationError('Não é permitido personificar outro MASTER');
  }

  try {
    assertTenantActiveForLogin(target);
  } catch (err) {
    throw new ImpersonationError(err instanceof Error ? err.message : 'Tenant inactivo');
  }

  const refreshToken = generateToken(48);
  const expiresAt = new Date(Date.now() + getSessionRefreshExpiresMs());

  const session = await prisma.session.create({
    data: {
      userId: target.id,
      tenantId: target.tenantId,
      tokenHash: hashToken(refreshToken),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent ?? null,
      deviceInfo: input.userAgent?.slice(0, 100) ?? null,
      expiresAt,
      impersonatorId: input.masterId,
      originalMasterSessionId: input.masterSessionId,
    },
  });

  await createAuditLog({
    tenantId: target.tenantId,
    userId: input.masterId,
    action: 'auth.impersonation_start',
    entityType: 'session',
    entityId: session.id,
    afterJson: {
      targetUserId: target.id,
      targetRole: target.role,
      targetEmail: target.email,
      originalMasterSessionId: input.masterSessionId,
      impersonationSessionId: session.id,
    },
    ipAddress: input.ipAddress,
  });

  return {
    refreshToken,
    sessionId: session.id,
    user: {
      id: target.id,
      email: target.email,
      role: target.role,
      tenantId: target.tenantId,
      workspaceId: target.workspaceId,
      siteId: target.tenant?.siteId ?? null,
      mustChangePassword: target.mustChangePassword,
    },
  };
}

export async function stopImpersonation(input: {
  currentUserId: string;
  currentSessionId: string;
  impersonatorId: string;
  ipAddress: string;
  accessToken?: string;
}): Promise<{
  refreshToken: string;
  sessionId: string;
  user: {
    id: string;
    email: string;
    role: string;
    tenantId: string | null;
    workspaceId: string | null;
    siteId: string | null;
    mustChangePassword: boolean;
  };
}> {
  const currentSession = await prisma.session.findFirst({
    where: {
      id: input.currentSessionId,
      userId: input.currentUserId,
      isActive: true,
    },
  });

  if (
    !currentSession?.impersonatorId ||
    !currentSession.originalMasterSessionId ||
    currentSession.impersonatorId !== input.impersonatorId
  ) {
    throw new ImpersonationError('Não está em modo de personificação');
  }

  if (input.accessToken) {
    try {
      await revokeAccessToken(input.accessToken);
    } catch (err) {
      console.error('[blacklist] Falha ao revogar token no stop impersonation:', err);
    }
  }

  await prisma.session.update({
    where: { id: currentSession.id },
    data: { isActive: false },
  });

  let masterSession = await prisma.session.findFirst({
    where: {
      id: currentSession.originalMasterSessionId,
      userId: currentSession.impersonatorId,
      isActive: true,
      expiresAt: { gt: new Date() },
    },
  });

  const master = await prisma.user.findUnique({
    where: { id: currentSession.impersonatorId },
    include: { tenant: true },
  });

  if (!master || master.status !== 'active' || master.role !== 'master') {
    throw new ImpersonationError('Conta MASTER original indisponível — faça login novamente');
  }

  const refreshToken = generateToken(48);
  const expiresAt = new Date(Date.now() + getSessionRefreshExpiresMs());

  if (masterSession) {
    await prisma.session.update({
      where: { id: masterSession.id },
      data: {
        tokenHash: hashToken(refreshToken),
        expiresAt,
        ipAddress: input.ipAddress,
        userAgent: currentSession.userAgent,
      },
    });
  } else {
    masterSession = await prisma.session.create({
      data: {
        userId: master.id,
        tenantId: master.tenantId,
        tokenHash: hashToken(refreshToken),
        ipAddress: input.ipAddress,
        userAgent: currentSession.userAgent,
        deviceInfo: currentSession.deviceInfo,
        expiresAt,
      },
    });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: input.currentUserId },
    select: { email: true, role: true },
  });

  await createAuditLog({
    tenantId: currentSession.tenantId,
    userId: master.id,
    action: 'auth.impersonation_stop',
    entityType: 'session',
    entityId: currentSession.id,
    afterJson: {
      targetUserId: input.currentUserId,
      targetEmail: targetUser?.email ?? null,
      targetRole: targetUser?.role ?? null,
      restoredMasterSessionId: masterSession.id,
      impersonationSessionId: currentSession.id,
    },
    ipAddress: input.ipAddress,
  });

  return {
    refreshToken,
    sessionId: masterSession.id,
    user: {
      id: master.id,
      email: master.email,
      role: master.role,
      tenantId: master.tenantId,
      workspaceId: master.workspaceId,
      siteId: master.tenant?.siteId ?? null,
      mustChangePassword: master.mustChangePassword,
    },
  };
}

export async function logout(sessionId: string, userId: string, ip?: string, accessToken?: string) {
  if (accessToken) {
    try {
      await revokeAccessToken(accessToken);
    } catch (err) {
      console.error('[blacklist] Falha ao revogar token no logout:', err);
    }
  }

  await prisma.session.updateMany({
    where: { id: sessionId, userId },
    data: { isActive: false },
  });
  await createAuditLog({
    userId,
    action: 'auth.logout',
    entityType: 'session',
    entityId: sessionId,
    ipAddress: ip,
  });
}

export async function getActiveSessions(userId: string) {
  return prisma.session.findMany({
    where: {
      userId,
      isActive: true,
      expiresAt: { gt: new Date() },
      impersonatorId: null,
    },
    select: {
      id: true,
      ipAddress: true,
      deviceInfo: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeSession(sessionId: string, userId: string) {
  await prisma.session.updateMany({
    where: { id: sessionId, userId },
    data: { isActive: false },
  });
}

export { validatePassword, hashPassword, createSession };

const PASSWORD_HISTORY_LIMIT = 5;

export async function requestPasswordReset(email: string, ipAddress?: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || user.status !== 'active') {
    return { sent: true as const, resetToken: null, resetUrl: null };
  }

  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, used: false },
    data: { used: true },
  });

  const rawToken = generateToken(32);
  const { passwordResetExpiresMs, webPublicUrl, exposeResetToken, nodeEnv } = getServerConfig();

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + passwordResetExpiresMs),
    },
  });

  await createAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'auth.password_reset_requested',
    entityType: 'user',
    entityId: user.id,
    ipAddress,
  });

  const resetPath = `${WEB_ROUTES.resetPassword}?token=${rawToken}`;
  const resetUrl = webPublicUrl ? `${webPublicUrl.replace(/\/$/, '')}${resetPath}` : null;

  let emailSent = false;
  if (resetUrl) {
    try {
      await sendPasswordResetEmail({
        tenantId: user.tenantId,
        to: user.email,
        resetUrl,
        userName: user.email.split('@')[0],
      });
      emailSent = true;
    } catch (err) {
      if (!(err instanceof EmailNotConfiguredError)) {
        console.error('[password-reset] Falha ao enviar email:', err);
      }
    }
  }

  const expose = (exposeResetToken || nodeEnv === 'development') && !emailSent;

  return {
    sent: true as const,
    resetToken: expose ? rawToken : null,
    resetUrl: expose ? resetUrl : null,
    emailSent,
  };
}

export async function resetPassword(rawToken: string, newPassword: string, ipAddress?: string) {
  const pwdCheck = await validatePasswordWithHibp(newPassword);
  if (!pwdCheck.valid) {
    throw new Error(pwdCheck.errors.join('; '));
  }

  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, used: false, expiresAt: { gt: new Date() } },
    include: { user: true },
  });

  if (!record || record.user.status !== 'active') {
    throw new Error('Token inválido ou expirado');
  }

  const reused = await isPasswordReused(record.userId, newPassword, async (userId) => {
    const rows = await prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: PASSWORD_HISTORY_LIMIT,
      select: { passwordHash: true },
    });
    return rows.map((r) => r.passwordHash);
  });

  if (reused) {
    throw new Error('Não pode reutilizar uma das últimas 5 passwords');
  }

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: newHash },
    }),
    prisma.passwordHistory.create({
      data: { userId: record.userId, passwordHash: record.user.passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { used: true },
    }),
    prisma.session.updateMany({
      where: { userId: record.userId, isActive: true },
      data: { isActive: false },
    }),
  ]);

  // Trim history to last N entries
  const history = await prisma.passwordHistory.findMany({
    where: { userId: record.userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (history.length > PASSWORD_HISTORY_LIMIT) {
    await prisma.passwordHistory.deleteMany({
      where: { id: { in: history.slice(PASSWORD_HISTORY_LIMIT).map((h) => h.id) } },
    });
  }

  await createAuditLog({
    tenantId: record.user.tenantId,
    userId: record.userId,
    action: 'auth.password_reset_completed',
    entityType: 'user',
    entityId: record.userId,
    ipAddress,
  });

  return { success: true };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ipAddress?: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const canChange =
    user &&
    (user.status === 'active' ||
      (user.status === 'pending' && user.mustChangePassword));
  if (!canChange) {
    throw new Error('Utilizador inválido');
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new Error('Password actual incorrecta');
  }

  const pwdCheck = await validatePasswordWithHibp(newPassword);
  if (!pwdCheck.valid) {
    throw new Error(pwdCheck.errors.join('; '));
  }

  const reused = await isPasswordReused(userId, newPassword, async (uid) => {
    const rows = await prisma.passwordHistory.findMany({
      where: { userId: uid },
      orderBy: { createdAt: 'desc' },
      take: PASSWORD_HISTORY_LIMIT,
      select: { passwordHash: true },
    });
    return rows.map((r) => r.passwordHash);
  });

  if (reused) {
    throw new Error('Não pode reutilizar uma das últimas 5 passwords');
  }

  const newHash = await hashPassword(newPassword);
  const activatePending = user.status === 'pending';

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        tempPasswordExpiresAt: null,
        ...(activatePending ? { status: 'active' as const } : {}),
      },
    }),
    prisma.passwordHistory.create({
      data: { userId, passwordHash: user.passwordHash },
    }),
  ]);

  const history = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (history.length > PASSWORD_HISTORY_LIMIT) {
    await prisma.passwordHistory.deleteMany({
      where: { id: { in: history.slice(PASSWORD_HISTORY_LIMIT).map((h) => h.id) } },
    });
  }

  await createAuditLog({
    tenantId: user.tenantId,
    userId,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: userId,
    ipAddress,
  });

  return { success: true as const };
}

export async function verifyUserPassword(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Utilizador não encontrado');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new Error('Password incorrecta');

  return { verified: true as const };
}
