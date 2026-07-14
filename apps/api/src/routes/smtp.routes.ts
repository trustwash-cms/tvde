import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  EMAIL_TEMPLATE_KEYS,
  getSmtpPublicInfo,
  upsertSmtpConfig,
  upsertEmailRoutingSettings,
  sendEmail,
  resolveSmtpConnection,
  listEmailTemplates,
  upsertEmailTemplate,
  resolveSmtpScopeForUser,
  type EmailTemplateKey,
} from '../services/email.service';
import { createAuditLog } from '../services/audit.service';

const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().min(1).optional(),
  tls: z.boolean().default(true),
  fromName: z.string().max(120).optional().nullable(),
});

const templateSchema = z.object({
  subject: z.string().min(1).max(200),
  htmlBody: z.string().min(1),
});

const emailRoutingSchema = z.object({
  defaultCc: z.string().max(2000).optional(),
  defaultBcc: z.string().max(2000).optional(),
});

function getSmtpOwner(request: { user: { role: string; tenantId: string | null } }) {
  try {
    return resolveSmtpScopeForUser(request.user.role, request.user.tenantId);
  } catch {
    return null;
  }
}

export async function smtpRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireRole('superadmin'));

  fastify.get('/smtp-config', async (request, reply) => {
    const owner = getSmtpOwner(request);
    if (!owner) {
      return reply.status(400).send({ success: false, error: 'Sem permissão para configurar SMTP' });
    }

    const data = await getSmtpPublicInfo(owner.ownerTenantId);
    return reply.send({ success: true, data });
  });

  fastify.put('/smtp-config', async (request, reply) => {
    const owner = getSmtpOwner(request);
    if (!owner) {
      return reply.status(400).send({ success: false, error: 'Sem permissão para configurar SMTP' });
    }

    const body = smtpSchema.parse(request.body);
    const config = await upsertSmtpConfig(owner.ownerTenantId, body);

    await createAuditLog({
      tenantId: owner.ownerTenantId,
      userId: request.user.sub,
      action: owner.scope === 'platform' ? 'smtp.platform_config_updated' : 'smtp.config_updated',
      entityType: 'smtp_config',
      entityId: config.id,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: config, message: 'SMTP configurado' });
  });

  fastify.put('/smtp-config/email-routing', async (request, reply) => {
    const owner = getSmtpOwner(request);
    if (!owner) {
      return reply.status(400).send({ success: false, error: 'Sem permissão para configurar SMTP' });
    }

    const body = emailRoutingSchema.parse(request.body);
    if (body.defaultCc === undefined && body.defaultBcc === undefined) {
      return reply.status(400).send({ success: false, error: 'Nada para guardar' });
    }

    try {
      const emailRouting = await upsertEmailRoutingSettings(owner.ownerTenantId, body);

      await createAuditLog({
        tenantId: owner.ownerTenantId,
        userId: request.user.sub,
        action:
          owner.scope === 'platform'
            ? 'smtp.platform_email_routing_updated'
            : 'smtp.email_routing_updated',
        entityType: 'smtp_config',
        ipAddress: request.ip,
        afterJson: { scope: owner.scope, ...emailRouting },
      });

      return reply.send({
        success: true,
        data: emailRouting,
        message: 'Cópias automáticas guardadas',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao guardar cópias automáticas';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/smtp-config/test', async (request, reply) => {
    const owner = getSmtpOwner(request);
    if (!owner) {
      return reply.status(400).send({ success: false, error: 'Sem permissão para testar SMTP' });
    }

    const { to } = z.object({ to: z.string().email() }).parse(request.body);

    try {
      const smtp = await resolveSmtpConnection(
        owner.scope === 'tenant' ? owner.ownerTenantId : null
      );
      const fromName = smtp.fromName ?? 'CMS';
      const result = await sendEmail({
        tenantId: owner.scope === 'tenant' ? owner.ownerTenantId : null,
        to,
        subject: owner.scope === 'platform' ? `Teste SMTP plataforma — ${fromName}` : `Teste SMTP — ${fromName}`,
        html: `<p>Email de teste (${owner.scope}) enviado com sucesso a partir do <strong>${fromName}</strong>.</p>`,
      });

      await createAuditLog({
        tenantId: owner.ownerTenantId,
        userId: request.user.sub,
        action: owner.scope === 'platform' ? 'smtp.platform_test_sent' : 'smtp.test_sent',
        entityType: 'smtp_config',
        ipAddress: request.ip,
        afterJson: { to, source: result.source, scope: owner.scope },
      });

      return reply.send({
        success: true,
        message: 'Email de teste enviado',
        data: { messageId: result.messageId, source: result.source, scope: owner.scope },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar email';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/email-templates', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const owner = getSmtpOwner(request);
    if (!owner) {
      return reply.status(400).send({ success: false, error: 'Sem permissão' });
    }

    const templates = await listEmailTemplates(owner.ownerTenantId);
    return reply.send({ success: true, data: templates, scope: owner.scope });
  });

  fastify.put('/email-templates/:key', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const owner = getSmtpOwner(request);
    if (!owner) {
      return reply.status(400).send({ success: false, error: 'Sem permissão' });
    }

    const { key } = request.params as { key: string };
    if (!Object.values(EMAIL_TEMPLATE_KEYS).includes(key as EmailTemplateKey)) {
      return reply.status(400).send({ success: false, error: 'Template inválido' });
    }

    const body = templateSchema.parse(request.body);
    const template = await upsertEmailTemplate(
      owner.ownerTenantId,
      key as EmailTemplateKey,
      body
    );

    await createAuditLog({
      tenantId: owner.ownerTenantId,
      userId: request.user.sub,
      action: owner.scope === 'platform' ? 'email.platform_template_updated' : 'email.template_updated',
      entityType: 'email_template',
      entityId: template.id,
      ipAddress: request.ip,
      afterJson: { key, scope: owner.scope },
    });

    return reply.send({ success: true, data: template, message: 'Template actualizado' });
  });
}
