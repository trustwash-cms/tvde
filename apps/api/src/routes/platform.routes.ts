import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import { z } from 'zod';
import { prisma } from '@tvde/database';
import { hasMinRole, type Role } from '@tvde/shared';
import {
  getPlatformFeatures,
  updatePlatformFeatures,
} from '../services/platform-features.service';
import {
  getSmsPublicInfo,
  upsertSmsConfig,
  sendSms,
  listSmsLogs,
  SmsNotConfiguredError,
} from '../services/sms.service';
import {
  getWhatsappBridgeQr,
  getWhatsappBridgeStatus,
  logoutWhatsappBridge,
  restartWhatsappBridge,
} from '../services/whatsapp-bridge.client';
import {
  listWhatsappTemplates,
  upsertWhatsappTemplate,
  sendWhatsappTemplateTest,
  WHATSAPP_TEMPLATE_KEYS,
  type WhatsappTemplateKey,
} from '../services/whatsapp-template.service';
import { createAuditLog } from '../services/audit.service';
import {
  clearFail2ban,
  FAIL2BAN_MAX,
  FAIL2BAN_TTL_SECONDS,
  listFail2banEntries,
} from '../lib/redis';
import {
  resolveCommunicationFeatures,
  updateCommunicationFeaturesForActor,
} from '../services/tenant-features.service';
import { resolveWhatsappTenantId, whatsappTenantAccess } from '../lib/whatsapp-tenant';
import {
  getWhatsappActiveProvider,
  setWhatsappActiveProvider,
} from '../modules/whatsapp-business/whatsapp-provider.service';

const featuresSchema = z.object({
  sms2faEnabled: z.boolean().optional(),
  whatsapp2faEnabled: z.boolean().optional(),
});

const smsConfigSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('twilio'),
    accountSid: z.string().min(1),
    authToken: z.string().min(1).optional(),
    fromNumber: z.string().min(8),
  }),
  z.object({
    provider: z.literal('sinch'),
    servicePlanId: z.string().min(1),
    authToken: z.string().min(1).optional(),
    apiBaseUrl: z.string().url().optional(),
    fromNumber: z.string().min(3),
  }),
]);

function masterOrModule(fastify: FastifyInstance, moduleKey: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role === 'master') return;
    if (!hasMinRole(request.user.role, 'superadmin')) {
      return reply.status(403).send({ success: false, error: 'Forbidden' });
    }
    await fastify.requireModule(moduleKey)(request);
  };
}

export async function platformRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  const masterOnly = { preHandler: [fastify.requireRole('master')] };
  const smsAccess = { preHandler: [masterOrModule(fastify, 'sms')] };
  const whatsappAccess = { preHandler: [whatsappTenantAccess(fastify)] };

  fastify.get('/platform/features', masterOnly, async (_request, reply) => {
    const features = await getPlatformFeatures();
    const sms = await getSmsPublicInfo();

    return reply.send({
      success: true,
      data: {
        features,
        sms: {
          configured: sms.configured,
          usingEnvFallback: sms.usingEnvFallback,
          devMockActive: sms.devMockActive,
          smsConfig: sms.smsConfig,
        },
        whatsapp: {
          connected: false,
          state: 'disconnected',
          qrAvailable: false,
          perTenant: true,
        },
      },
    });
  });

  fastify.patch('/platform/features', masterOnly, async (request, reply) => {
    const body = featuresSchema.parse(request.body);
    const features = await updatePlatformFeatures(body);

    await createAuditLog({
      tenantId: null,
      userId: request.user.sub,
      action: 'platform.features_updated',
      entityType: 'platform_setting',
      ipAddress: request.ip,
      afterJson: body,
    });

    return reply.send({ success: true, data: features, message: 'Funcionalidades actualizadas' });
  });

  fastify.get('/platform/sms-config', smsAccess, async (request, reply) => {
    const data = await getSmsPublicInfo();
    const features = await resolveCommunicationFeatures(
      request.user.role as Role,
      request.user.tenantId
    );
    return reply.send({
      success: true,
      data: { ...data, sms2faEnabled: features.sms2faEnabled },
    });
  });

  fastify.put('/platform/sms-config', smsAccess, async (request, reply) => {
    const body = smsConfigSchema.parse(request.body);
    const config = await upsertSmsConfig(body);

    await createAuditLog({
      tenantId: null,
      userId: request.user.sub,
      action: 'platform.sms_config_updated',
      entityType: 'sms_config',
      entityId: config.id,
      ipAddress: request.ip,
    });

    return reply.send({
      success: true,
      data: config,
      message: `SMS ${config.provider} configurado`,
    });
  });

  fastify.post('/platform/sms-config/test', smsAccess, async (request, reply) => {
    const { to } = z.object({ to: z.string().min(8) }).parse(request.body);

    try {
      const result = await sendSms(
        {
          to,
          body: 'Teste SMS — CMS plataforma. Configuração OK.',
        },
        { purpose: 'test', userId: request.user.sub }
      );

      await createAuditLog({
        tenantId: null,
        userId: request.user.sub,
        action: 'platform.sms_test_sent',
        entityType: 'sms_config',
        ipAddress: request.ip,
        afterJson: { to, id: result.id, provider: result.provider, mocked: result.mocked },
      });

      return reply.send({
        success: true,
        message: result.mocked ? 'SMS simulado (dev mock)' : 'SMS de teste enviado',
        data: result,
      });
    } catch (err) {
      const message =
        err instanceof SmsNotConfiguredError || err instanceof Error
          ? err.message
          : 'Falha ao enviar SMS';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/platform/sms-config/history', smsAccess, async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    const data = await listSmsLogs(query.page, query.limit);
    return reply.send({ success: true, data });
  });

  fastify.patch('/platform/sms-config/features', smsAccess, async (request, reply) => {
    const body = z.object({ sms2faEnabled: z.boolean() }).parse(request.body);
    const features = await updateCommunicationFeaturesForActor(
      request.user.role as Role,
      request.user.tenantId,
      { sms2faEnabled: body.sms2faEnabled }
    );

    await createAuditLog({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      action: 'platform.sms_2fa_toggled',
      entityType: 'tenant_setting',
      ipAddress: request.ip,
      afterJson: { sms2faEnabled: features.sms2faEnabled },
    });

    return reply.send({
      success: true,
      data: { sms2faEnabled: features.sms2faEnabled },
      message: 'Funcionalidade SMS actualizada',
    });
  });

  fastify.get('/platform/whatsapp/settings', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    const features = await resolveCommunicationFeatures(
      request.user.role as Role,
      tenantId
    );
    const whatsapp = await getWhatsappBridgeStatus(tenantId);
    const activeProvider = await getWhatsappActiveProvider(tenantId);
    return reply.send({
      success: true,
      data: {
        whatsapp2faEnabled: features.whatsapp2faEnabled,
        whatsapp,
        activeProvider,
      },
    });
  });

  fastify.patch('/platform/whatsapp/settings', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    const body = z.object({ whatsapp2faEnabled: z.boolean() }).parse(request.body);
    if (body.whatsapp2faEnabled) {
      await setWhatsappActiveProvider(tenantId, 'generic');
    }
    const features = await updateCommunicationFeaturesForActor(
      request.user.role as Role,
      request.user.tenantId,
      { whatsapp2faEnabled: body.whatsapp2faEnabled }
    );

    await createAuditLog({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      action: 'platform.whatsapp_2fa_toggled',
      entityType: 'tenant_setting',
      ipAddress: request.ip,
      afterJson: { whatsapp2faEnabled: features.whatsapp2faEnabled },
    });

    return reply.send({
      success: true,
      data: {
        whatsapp2faEnabled: features.whatsapp2faEnabled,
        activeProvider: body.whatsapp2faEnabled ? 'generic' : await getWhatsappActiveProvider(tenantId),
      },
      message: 'Funcionalidade WhatsApp actualizada',
    });
  });

  fastify.get('/platform/whatsapp/status', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    const status = await getWhatsappBridgeStatus(tenantId);
    return reply.send({ success: true, data: status });
  });

  fastify.get('/platform/whatsapp/qr', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    const qr = await getWhatsappBridgeQr(tenantId);
    return reply.send({ success: true, data: qr });
  });

  fastify.post('/platform/whatsapp/logout', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    try {
      const result = await logoutWhatsappBridge(tenantId);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'platform.whatsapp_logout',
        entityType: 'whatsapp_bridge',
        ipAddress: request.ip,
      });

      return reply.send({ success: true, data: result, message: 'Sessão WhatsApp terminada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge indisponível';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/platform/whatsapp/restart', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    try {
      const result = await restartWhatsappBridge(tenantId);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'platform.whatsapp_restart',
        entityType: 'whatsapp_bridge',
        ipAddress: request.ip,
      });

      return reply.send({ success: true, data: result, message: 'WhatsApp bridge reiniciado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge indisponível';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/platform/whatsapp/templates', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    const templates = await listWhatsappTemplates(tenantId);
    return reply.send({ success: true, data: templates });
  });

  fastify.put('/platform/whatsapp/templates/:key', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    const { key } = request.params as { key: string };
    if (!Object.values(WHATSAPP_TEMPLATE_KEYS).includes(key as WhatsappTemplateKey)) {
      return reply.status(400).send({ success: false, error: 'Template inválido' });
    }

    const body = z.object({ body: z.string().min(1).max(4000) }).parse(request.body);
    const template = await upsertWhatsappTemplate(tenantId, key as WhatsappTemplateKey, body);

    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'platform.whatsapp_template_updated',
      entityType: 'whatsapp_template',
      ipAddress: request.ip,
      afterJson: { key },
    });

    return reply.send({ success: true, data: template, message: 'Template WhatsApp actualizado' });
  });

  fastify.post('/platform/whatsapp/test', whatsappAccess, async (request, reply) => {
    const tenantId = resolveWhatsappTenantId(request);
    const body = z
      .object({
        to: z.string().min(8),
        templateKey: z.enum(['otp', 'plain']).default('otp'),
      })
      .parse(request.body);

    try {
      const result = await sendWhatsappTemplateTest(tenantId, body.to, body.templateKey);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'platform.whatsapp_test_sent',
        entityType: 'whatsapp_template',
        ipAddress: request.ip,
        afterJson: { to: body.to, templateKey: body.templateKey, messageId: result.messageId },
      });

      return reply.send({
        success: true,
        message: 'WhatsApp de teste enviado',
        data: result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar WhatsApp';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/platform/whatsapp/tenants', masterOnly, async (_request, reply) => {
    const tenants = await prisma.tenant.findMany({
      where: { tenantModules: { some: { moduleKey: 'whatsapp', allowed: true } } },
      select: { id: true, name: true, siteId: true },
      orderBy: { name: 'asc' },
    });

    const data = await Promise.all(
      tenants.map(async (tenant) => ({
        ...tenant,
        whatsapp: await getWhatsappBridgeStatus(tenant.id),
      }))
    );

    return reply.send({ success: true, data });
  });

  fastify.get('/platform/fail2ban', masterOnly, async (_request, reply) => {
    try {
      const entries = await listFail2banEntries();
      return reply.send({
        success: true,
        data: {
          entries,
          maxAttempts: FAIL2BAN_MAX,
          blockTtlSeconds: FAIL2BAN_TTL_SECONDS,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Redis indisponível';
      return reply.status(503).send({ success: false, error: message });
    }
  });

  fastify.post('/platform/fail2ban/unblock', masterOnly, async (request, reply) => {
    const body = z
      .object({
        ip: z
          .string()
          .trim()
          .refine((value) => isIP(value) !== 0, { message: 'IP inválido' }),
      })
      .parse(request.body);

    try {
      await clearFail2ban(body.ip);

      await createAuditLog({
        userId: request.user.sub,
        action: 'platform.fail2ban_unblock',
        entityType: 'ip_address',
        ipAddress: request.ip,
        afterJson: { unblockedIp: body.ip },
      });

      return reply.send({
        success: true,
        message: `IP ${body.ip} desbloqueado`,
        data: { ip: body.ip },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Redis indisponível';
      return reply.status(503).send({ success: false, error: message });
    }
  });
}
