import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  WHATSAPP_BUSINESS_EVENT_KEYS,
  WHATSAPP_PROVIDERS,
  WHATSAPP_TEMPLATE_CATEGORIES,
  WHATSAPP_TEMPLATE_NAME_PATTERN,
  findTemplatePortalUrlMismatches,
  type WhatsappBusinessEventKey,
} from '@tvde/shared';
import { createAuditLog } from '../../services/audit.service';
import {
  getWhatsappBusinessConfigPublic,
  getWhatsappBusinessConfigRecord,
  getWhatsappBusinessTemplateHeaderUrl,
  listWhatsappBusinessNotificationEvents,
  saveWhatsappBusinessTemplateHeaderUrl,
  upsertWhatsappBusinessConfig,
  upsertWhatsappBusinessNotificationEvent,
} from './whatsapp-business.config.service';
import {
  checkWhatsappBusinessStatus,
  createWhatsappBusinessTemplate,
  deleteWhatsappBusinessTemplate,
  listWhatsappBusinessTemplates,
  sendWhatsappBusinessTemplateMessage,
  sendWhatsappBusinessTextMessage,
} from './whatsapp-business.graph.client';
import {
  assertWhatsappProviderActive,
  getDefaultPortalPublicUrl,
  getWhatsappActiveProvider,
  getWhatsappProviderStatus,
  setWhatsappActiveProvider,
} from './whatsapp-provider.service';
import {
  resolveWhatsappBusinessTenantId,
  whatsappBusinessAccess,
} from './whatsapp-business.access';

const configSchema = z.object({
  accessToken: z.string().optional(),
  phoneNumberId: z
    .string()
    .min(1)
    .regex(/^\d+$/, 'Phone Number ID deve conter apenas dígitos'),
  businessAccountId: z
    .string()
    .optional()
    .nullable()
    .refine((value) => !value || /^\d+$/.test(value), {
      message: 'Business Account ID deve conter apenas dígitos',
    }),
  apiVersion: z.string().min(2).optional(),
  webhookVerifyToken: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
  testMode: z.boolean().optional(),
  portalPublicUrl: z
    .string()
    .optional()
    .nullable()
    .refine((value) => !value || /^https?:\/\//i.test(value), {
      message: 'URL do portal inválida',
    }),
});

const eventKeySchema = z.enum([
  WHATSAPP_BUSINESS_EVENT_KEYS.driverWeeklyPayment,
  WHATSAPP_BUSINESS_EVENT_KEYS.userAccountDriver,
  WHATSAPP_BUSINESS_EVENT_KEYS.userAccountManager,
]);

export async function whatsappBusinessRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  const access = { preHandler: [whatsappBusinessAccess(fastify)] };

  fastify.get('/whatsapp-business/provider', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    const data = await getWhatsappProviderStatus(tenantId);
    return reply.send({ success: true, data });
  });

  fastify.patch('/whatsapp-business/provider', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    const body = z.object({ provider: z.enum(WHATSAPP_PROVIDERS) }).parse(request.body);
    const data = await setWhatsappActiveProvider(tenantId, body.provider);

    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'whatsapp_business.provider_changed',
      entityType: 'whatsapp_provider',
      ipAddress: request.ip,
      afterJson: data,
    });

    const status = await getWhatsappProviderStatus(tenantId);
    return reply.send({
      success: true,
      data: status,
      message:
        body.provider === 'official'
          ? 'API Oficial WhatsApp activada (API Genérica desactivada)'
          : 'API Genérica WhatsApp activada (API Oficial desactivada)',
    });
  });

  fastify.get('/whatsapp-business/config', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    const data = await getWhatsappBusinessConfigPublic(tenantId);
    return reply.send({ success: true, data });
  });

  fastify.put('/whatsapp-business/config', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    const body = configSchema.parse(request.body);
    await assertWhatsappProviderActive(tenantId, 'official');
    await upsertWhatsappBusinessConfig(tenantId, body);
    if (body.enabled !== false) {
      await setWhatsappActiveProvider(tenantId, 'official');
    }

    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'whatsapp_business.config_updated',
      entityType: 'whatsapp_business_config',
      ipAddress: request.ip,
    });

    const data = await getWhatsappBusinessConfigPublic(tenantId);
    return reply.send({ success: true, data, message: 'Configurações guardadas' });
  });

  fastify.get('/whatsapp-business/status', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    const config = await getWhatsappBusinessConfigRecord(tenantId);
    if (!config) {
      return reply.send({
        success: true,
        data: {
          configured: false,
          enabled: true,
          testMode: false,
          accountStatus: null,
          warnings: ['Configure Access Token e Phone Number ID'],
        },
      });
    }
    const data = await checkWhatsappBusinessStatus(config);
    return reply.send({ success: true, data });
  });

  fastify.post('/whatsapp-business/messages/send', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    await assertWhatsappProviderActive(tenantId, 'official');
    const body = z
      .object({
        phone: z.string().min(8),
        message: z.string().min(1).max(4096),
      })
      .parse(request.body);

    const config = await getWhatsappBusinessConfigRecord(tenantId);
    if (!config) {
      return reply.status(400).send({ success: false, error: 'API Oficial WhatsApp não configurada' });
    }

    try {
      const result = await sendWhatsappBusinessTextMessage(config, body.phone, body.message);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whatsapp_business.test_message_sent',
        entityType: 'whatsapp_business_message',
        ipAddress: request.ip,
        afterJson: { to: body.phone, messageId: result.messageId },
      });
      return reply.send({
        success: true,
        data: result,
        message: result.mocked ? 'Mensagem simulada (modo teste)' : 'Mensagem enviada',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar mensagem';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/whatsapp-business/templates', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    await assertWhatsappProviderActive(tenantId, 'official');
    const config = await getWhatsappBusinessConfigRecord(tenantId);
    if (!config) {
      return reply.status(400).send({ success: false, error: 'API Oficial WhatsApp não configurada' });
    }

    try {
      const templates = await listWhatsappBusinessTemplates(config, { approvedOnly: true });
      const portalUrl = config.portalPublicUrl ?? getDefaultPortalPublicUrl();
      const portalMismatches = findTemplatePortalUrlMismatches(templates, portalUrl);
      return reply.send({
        success: true,
        data: templates,
        total: templates.length,
        portalPublicUrl: portalUrl,
        portalMismatches,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar templates';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/whatsapp-business/templates/manage', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    await assertWhatsappProviderActive(tenantId, 'official');
    const config = await getWhatsappBusinessConfigRecord(tenantId);
    if (!config) {
      return reply.status(400).send({ success: false, error: 'API Oficial WhatsApp não configurada' });
    }

    try {
      const templates = await listWhatsappBusinessTemplates(config, { approvedOnly: false });
      return reply.send({ success: true, data: templates, total: templates.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar templates';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/whatsapp-business/templates', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    await assertWhatsappProviderActive(tenantId, 'official');
    const body = z
      .object({
        name: z
          .string()
          .min(1)
          .max(512)
          .regex(WHATSAPP_TEMPLATE_NAME_PATTERN, 'Nome: apenas a-z, 0-9 e underscore'),
        language: z.string().min(2),
        category: z.enum(WHATSAPP_TEMPLATE_CATEGORIES),
        bodyText: z.string().min(1).max(1024),
        bodyExamples: z.array(z.string()).optional(),
        headerText: z.string().max(60).optional().nullable(),
        footerText: z.string().max(60).optional().nullable(),
        buttonText: z.string().max(25).optional().nullable(),
        buttonUrl: z
          .string()
          .optional()
          .nullable()
          .refine((value) => !value || /^https?:\/\//i.test(value), {
            message: 'URL do botão inválida',
          }),
        allowCategoryChange: z.boolean().optional(),
      })
      .parse(request.body);

    const config = await getWhatsappBusinessConfigRecord(tenantId);
    if (!config) {
      return reply.status(400).send({ success: false, error: 'API Oficial WhatsApp não configurada' });
    }

    try {
      const result = await createWhatsappBusinessTemplate(config, body);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whatsapp_business.template_created',
        entityType: 'whatsapp_business_template',
        ipAddress: request.ip,
        afterJson: { ...body, result },
      });

      return reply.send({
        success: true,
        data: result,
        message: `Template «${body.name}» enviado para revisão (${result.status})`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao criar template';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/whatsapp-business/templates', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    await assertWhatsappProviderActive(tenantId, 'official');
    const query = z
      .object({
        name: z.string().min(1),
        hsmId: z.string().optional(),
      })
      .parse(request.query);

    const config = await getWhatsappBusinessConfigRecord(tenantId);
    if (!config) {
      return reply.status(400).send({ success: false, error: 'API Oficial WhatsApp não configurada' });
    }

    try {
      await deleteWhatsappBusinessTemplate(config, query.name, query.hsmId);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whatsapp_business.template_deleted',
        entityType: 'whatsapp_business_template',
        ipAddress: request.ip,
        afterJson: query,
      });

      return reply.send({
        success: true,
        message: `Template «${query.name}» apagado`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao apagar template';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/whatsapp-business/templates/send', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    await assertWhatsappProviderActive(tenantId, 'official');
    const body = z
      .object({
        phone: z.string().min(8),
        templateName: z.string().min(1),
        languageCode: z.string().min(2),
        parameters: z.array(z.string()).optional(),
        parameterNames: z.array(z.string()).optional(),
        headerMediaUrl: z.string().optional().nullable(),
      })
      .parse(request.body);

    const config = await getWhatsappBusinessConfigRecord(tenantId);
    if (!config) {
      return reply.status(400).send({ success: false, error: 'API Oficial WhatsApp não configurada' });
    }

    try {
      const templates = await listWhatsappBusinessTemplates(config);
      const templateInfo =
        templates.find(
          (item) => item.name === body.templateName && item.language === body.languageCode
        ) ?? null;

      let headerMediaUrl = body.headerMediaUrl ?? null;
      if (!headerMediaUrl && templateInfo?.headerFormat) {
        headerMediaUrl = await getWhatsappBusinessTemplateHeaderUrl(
          tenantId,
          body.templateName,
          body.languageCode
        );
      }

      const result = await sendWhatsappBusinessTemplateMessage(config, {
        to: body.phone,
        templateName: body.templateName,
        languageCode: body.languageCode,
        parameters: body.parameters,
        parameterNames: body.parameterNames,
        headerMediaUrl,
        templateInfo,
      });

      if (body.headerMediaUrl?.trim()) {
        await saveWhatsappBusinessTemplateHeaderUrl(
          tenantId,
          body.templateName,
          body.languageCode,
          body.headerMediaUrl
        );
      }

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whatsapp_business.template_sent',
        entityType: 'whatsapp_business_template',
        ipAddress: request.ip,
        afterJson: {
          to: body.phone,
          templateName: body.templateName,
          messageId: result.messageId,
        },
      });

      return reply.send({
        success: true,
        data: result,
        message: result.mocked ? 'Template simulado (modo teste)' : 'Template enviado',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar template';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/whatsapp-business/templates/header-url', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    const query = z
      .object({
        templateName: z.string().min(1),
        languageCode: z.string().min(2),
      })
      .parse(request.query);

    const url = await getWhatsappBusinessTemplateHeaderUrl(
      tenantId,
      query.templateName,
      query.languageCode
    );
    return reply.send({ success: true, data: { url } });
  });

  fastify.get('/whatsapp-business/notification-events', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    const data = await listWhatsappBusinessNotificationEvents(tenantId);
    return reply.send({ success: true, data });
  });

  fastify.put('/whatsapp-business/notification-events/:eventKey', access, async (request, reply) => {
    const tenantId = await resolveWhatsappBusinessTenantId(request);
    const { eventKey } = request.params as { eventKey: string };
    const parsedEventKey = eventKeySchema.parse(eventKey) as WhatsappBusinessEventKey;
    const body = z
      .object({
        emailEnabled: z.boolean(),
        whatsappEnabled: z.boolean(),
        whatsappTemplate: z.string().nullable().optional(),
        whatsappLanguage: z.string().min(2),
        headerMediaUrl: z.string().nullable().optional(),
      })
      .parse(request.body);

    const data = await upsertWhatsappBusinessNotificationEvent(tenantId, {
      eventKey: parsedEventKey,
      emailEnabled: body.emailEnabled,
      whatsappEnabled: body.whatsappEnabled,
      whatsappTemplate: body.whatsappTemplate ?? null,
      whatsappLanguage: body.whatsappLanguage,
      headerMediaUrl: body.headerMediaUrl,
    });

    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'whatsapp_business.notification_event_updated',
      entityType: 'whatsapp_business_notification_event',
      ipAddress: request.ip,
      afterJson: { eventKey: parsedEventKey },
    });

    return reply.send({
      success: true,
      data: {
        eventKey: data.eventKey,
        emailEnabled: data.emailEnabled,
        whatsappEnabled: data.whatsappEnabled,
        whatsappTemplate: data.whatsappTemplate,
        whatsappLanguage: data.whatsappLanguage,
        headerMediaUrl: data.headerMediaUrl ?? null,
      },
      message: 'Configuração guardada',
    });
  });
}
