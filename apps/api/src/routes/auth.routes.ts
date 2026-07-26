import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { login, logout, getActiveSessions, revokeSession, buildJwtPayload, requestPasswordReset, resetPassword, changePassword, verifyUserPassword, startImpersonation, stopImpersonation, ImpersonationError } from '../services/auth.service';
import {
  setup2fa,
  verify2faSetup,
  verify2faLogin,
  disable2fa,
  get2faStatus,
  sendLogin2faCode,
} from '../services/twofa.service';
import { getModuleCapabilities } from '../services/tenant-modules.service';
import { assertTurnstileIfEnabled } from '../services/turnstile.service';
import { getBearerToken } from '../lib/request-auth';
import { getClientIp } from '../lib/client-ip';
import { hashToken } from '../lib/crypto';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  siteId: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    try {
      await assertTurnstileIfEnabled(body.turnstileToken, getClientIp(request));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verificação captcha falhou';
      return reply.status(400).send({ success: false, error: message });
    }

    let result;
    try {
      result = await login({
        email: body.email,
        password: body.password,
        siteId: body.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login falhou';
      return reply.status(401).send({ success: false, error: message });
    }

    if (result.requires2fa) {
      return reply.send({
        success: true,
        data: {
          requires2fa: true,
          userId: result.userId,
          method: result.twoFaMethod,
          deliveryHint: result.deliveryHint,
        },
      });
    }

    const session = await fastify.db.session.findFirst({
      where: { userId: result.user!.id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const payload = await buildJwtPayload(result.user!.id, session!.id);
    const accessToken = fastify.jwt.sign(payload!);

    return reply.send({
      success: true,
      data: {
        accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      },
    });
  });

  fastify.post('/auth/refresh', async (request, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(request.body);
    const tokenHash = hashToken(refreshToken);

    const session = await fastify.db.session.findFirst({
      where: { tokenHash, isActive: true, expiresAt: { gt: new Date() } },
      include: { user: { include: { tenant: true } } },
    });

    if (!session || session.user.status !== 'active') {
      return reply.status(401).send({ success: false, error: 'Refresh token inválido' });
    }

    const payload = await buildJwtPayload(session.userId, session.id);
    const accessToken = fastify.jwt.sign(payload!);

    return reply.send({ success: true, data: { accessToken } });
  });

  fastify.post('/auth/logout', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    await logout(
      request.user.sessionId,
      request.user.sub,
      request.ip,
      getBearerToken(request) ?? undefined
    );
    return reply.send({ success: true, message: 'Logout efectuado' });
  });

  fastify.get('/auth/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = await fastify.db.user.findUnique({
      where: { id: request.user.sub },
      include: {
        tenant: { select: { siteId: true, name: true, plan: true } },
        workspace: { select: { id: true, name: true, slug: true } },
      },
    });

    const capabilities = await getModuleCapabilities(
      request.user.role,
      request.user.tenantId,
      request.user.workspaceId
    );

    let impersonation: {
      active: true;
      impersonatorId: string;
      impersonatorEmail: string | null;
    } | null = null;

    if (request.user.impersonatorId) {
      const master = await fastify.db.user.findUnique({
        where: { id: request.user.impersonatorId },
        select: { id: true, email: true },
      });
      if (master) {
        impersonation = {
          active: true,
          impersonatorId: master.id,
          impersonatorEmail: master.email,
        };
      }
    }

    const { passwordHash, twoFaSecret, backupCodes, ...safe } = user!;
    return reply.send({
      success: true,
      data: { ...safe, capabilities, impersonation },
    });
  });

  fastify.post('/auth/impersonate', {
    preHandler: [fastify.authenticate, fastify.requireRole('master')],
  }, async (request, reply) => {
    const body = z.object({ userId: z.string().uuid() }).parse(request.body);

    try {
      const result = await startImpersonation({
        masterId: request.user.sub,
        masterRole: request.user.role,
        masterSessionId: request.user.sessionId,
        targetUserId: body.userId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      const payload = await buildJwtPayload(result.user.id, result.sessionId);
      if (!payload) {
        return reply.status(400).send({ success: false, error: 'Não foi possível criar a sessão personificada' });
      }

      const accessToken = fastify.jwt.sign(payload);
      return reply.send({
        success: true,
        data: {
          accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        },
        message: 'Personificação iniciada',
      });
    } catch (err) {
      const message = err instanceof ImpersonationError ? err.message : 'Falha ao personificar';
      const status = err instanceof ImpersonationError ? 403 : 400;
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/impersonate/stop', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!request.user.impersonatorId) {
      return reply.status(400).send({ success: false, error: 'Não está em modo de personificação' });
    }

    try {
      const result = await stopImpersonation({
        currentUserId: request.user.sub,
        currentSessionId: request.user.sessionId,
        impersonatorId: request.user.impersonatorId,
        ipAddress: request.ip,
        accessToken: getBearerToken(request) ?? undefined,
      });

      const payload = await buildJwtPayload(result.user.id, result.sessionId);
      if (!payload) {
        return reply.status(400).send({ success: false, error: 'Não foi possível restaurar a sessão MASTER' });
      }

      const accessToken = fastify.jwt.sign(payload);
      return reply.send({
        success: true,
        data: {
          accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        },
        message: 'Personificação terminada',
      });
    } catch (err) {
      const message = err instanceof ImpersonationError ? err.message : 'Falha ao sair da personificação';
      const status = err instanceof ImpersonationError ? 403 : 400;
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/auth/sessions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const sessions = await getActiveSessions(request.user.sub);
    return reply.send({ success: true, data: sessions });
  });

  fastify.delete('/auth/sessions/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await revokeSession(id, request.user.sub);
    return reply.send({ success: true, message: 'Sessão revogada' });
  });

  fastify.post('/auth/forgot-password', async (request, reply) => {
    const body = z.object({
      email: z.string().email(),
      turnstileToken: z.string().optional(),
    }).parse(request.body);

    try {
      await assertTurnstileIfEnabled(body.turnstileToken, getClientIp(request));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verificação captcha falhou';
      return reply.status(400).send({ success: false, error: message });
    }

    const result = await requestPasswordReset(body.email, request.ip);
    return reply.send({
      success: true,
      message: 'Se o email existir, receberá instruções para redefinir a password.',
      data: result.resetUrl ? { resetUrl: result.resetUrl } : undefined,
    });
  });

  fastify.post('/auth/reset-password', async (request, reply) => {
    const body = z.object({
      token: z.string().min(1),
      password: z.string().min(12),
    }).parse(request.body);

    try {
      await resetPassword(body.token, body.password, request.ip);
      return reply.send({ success: true, message: 'Password actualizada com sucesso' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reset falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/change-password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(12),
    }).parse(request.body);

    try {
      await changePassword(request.user.sub, body.currentPassword, body.newPassword, request.ip);
      return reply.send({ success: true, message: 'Password actualizada com sucesso' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Alteração falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/auth/2fa/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const status = await get2faStatus(request.user.sub, request.user.role);
      return reply.send({ success: true, data: status });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/2fa/setup', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = z
      .object({
        method: z.enum(['totp', 'sms', 'whatsapp', 'email']),
        phone: z.string().optional(),
      })
      .parse(request.body ?? {});

    try {
      const data = await setup2fa(request.user.sub, request.user.role, body.method, body.phone);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Setup falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/2fa/verify-setup', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(6).max(12),
        method: z.enum(['totp', 'sms', 'whatsapp', 'email']),
      })
      .parse(request.body);

    try {
      const data = await verify2faSetup(request.user.sub, body.method, body.code);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verificação falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/2fa/send-code', async (request, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.body ?? {});

    try {
      const data = await sendLogin2faCode(userId);
      return reply.send({ success: true, data, message: 'Código reenviado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Envio falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/2fa/send-code/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const data = await sendLogin2faCode(request.user.sub);
      return reply.send({ success: true, data, message: 'Código enviado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Envio falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/2fa/verify', async (request, reply) => {
    const body = z.object({
      userId: z.string().uuid(),
      code: z.string().min(6).max(12),
      siteId: z.string().optional(),
    }).parse(request.body);

    try {
      const result = await verify2faLogin({
        userId: body.userId,
        code: body.code,
        siteId: body.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      const session = await fastify.db.session.findFirst({
        where: { userId: result.user!.id, isActive: true },
        orderBy: { createdAt: 'desc' },
      });

      const payload = await buildJwtPayload(result.user!.id, session!.id);
      const accessToken = fastify.jwt.sign(payload!);

      return reply.send({
        success: true,
        data: {
          accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verificação falhou';
      return reply.status(401).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/verify-password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { password } = z.object({ password: z.string().min(1) }).parse(request.body);

    try {
      await verifyUserPassword(request.user.sub, password);
      return reply.send({ success: true, message: 'Password confirmada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verificação falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/auth/2fa/disable', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = z.object({
      password: z.string().min(1),
      code: z.string().min(6).max(12),
    }).parse(request.body);

    try {
      await disable2fa(request.user.sub, body.password, body.code);
      return reply.send({ success: true, message: '2FA desactivado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Desactivação falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}
