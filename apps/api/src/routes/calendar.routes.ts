import type { FastifyInstance } from 'fastify';
import { TenantStorageQuotaError } from '../services/tenant-storage.service';
import { z } from 'zod';
import { resolveWorkspaceTenantScope } from '../lib/workspace-scope';
import { createAuditLog } from '../services/audit.service';
import { env } from '../config/env';
import { openCalendarAttachmentStream } from '../services/calendar/calendar-attachment-storage.service';
import {
  addEventAttachment,
  createCalendar,
  createEvent,
  CalendarAccessError,
  deleteCalendar,
  deleteEvent,
  deleteEventAttachment,
  getCalendar,
  getEvent,
  getEventAttachmentForDownload,
  listCalendars,
  listEventAttachments,
  listEvents,
  listTodayEvents,
  setCalendarMembers,
  updateCalendar,
  updateEvent,
  uploadEventAttachment,
} from '../services/calendar/calendar.service';
import {
  dismissReminder,
  listUpcomingReminders,
} from '../services/calendar/calendar-reminder.service';
import {
  getCalendarEmailTemplateSettings,
  getCalendarWhatsappSettings,
  saveCalendarEmailTemplateSettings,
  saveCalendarWhatsappSettings,
  sendCalendarAppointmentEmails,
  sendCalendarAppointmentWhatsApp,
} from '../services/calendar/calendar-notification.service';
import {
  getCalendarScheduledInvoiceSettings,
  saveCalendarScheduledInvoiceSettings,
} from '../services/calendar/calendar-scheduled-invoice-settings.service';
import { generateMapImageBuffer } from '../services/calendar/calendar-map-image.service';
import {
  buildMapPreviewImageUrl,
  resolveCoordinatesForMap,
} from '../services/calendar/calendar-location-format';
import { hasMinRole } from '@tvde/shared';

const visibilitySchema = z.enum(['private', 'workspace', 'shared']);
const memberRoleSchema = z.enum(['owner', 'editor', 'viewer']);
const attendeeRoleSchema = z.enum(['organizer', 'required', 'optional']);
const reminderChannelSchema = z.enum(['in_app', 'email', 'push']);
const eventStatusSchema = z.enum(['confirmed', 'tentative', 'cancelled']);

const attendeeSchema = z.object({
  userId: z.string().uuid(),
  role: attendeeRoleSchema.optional(),
  canEdit: z.boolean().optional(),
  notify: z.boolean().optional(),
});

const reminderSchema = z.object({
  userId: z.string().uuid().optional(),
  offsetMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30),
  channel: reminderChannelSchema.optional(),
});

const guestEmailsSchema = z
  .array(z.string().email())
  .max(50)
  .optional()
  .transform((emails) => emails?.map((e) => e.trim().toLowerCase()));

const guestPhonesSchema = z
  .array(z.string().min(8).max(32))
  .max(50)
  .optional();

const eventTypeSchema = z.enum(['appointment', 'invoice']).optional();

const scheduledInvoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  moloniProductId: z.coerce.number().optional(),
  moloniTaxId: z.coerce.number().optional(),
  moloniExemptionReason: z.string().min(2).max(8).optional(),
});

const scheduledInvoiceSchema = z
  .object({
    billingEntityId: z.string().uuid(),
    clientEmail: z.string().email(),
    lines: z.array(scheduledInvoiceLineSchema).min(1),
    documentType: z.string().optional(),
    notes: z.string().max(5000).optional(),
    autoIssue: z.boolean().optional(),
    sendEmail: z.boolean().optional(),
  })
  .transform((data) => ({
    ...data,
    autoIssue: data.autoIssue ?? true,
    sendEmail: data.sendEmail ?? true,
  }));

function handleCalendarError(err: unknown) {
  if (err instanceof CalendarAccessError) {
    return { status: 403, message: err.message };
  }
  if (err instanceof TenantStorageQuotaError) {
    return { status: 413, message: err.message };
  }
  if (err instanceof Error) {
    return { status: 400, message: err.message };
  }
  return { status: 500, message: 'Erro interno' };
}

export async function calendarPublicRoutes(fastify: FastifyInstance) {
  fastify.get('/calendar/map-preview', async (request, reply) => {
    const query = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        z: z.coerce.number().int().min(10).max(17).optional(),
      })
      .parse(request.query);

    const image = await generateMapImageBuffer(query.lat, query.lng);
    if (!image) {
      return reply.status(404).send({ success: false, error: 'Mapa indisponível' });
    }

    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'public, max-age=86400')
      .send(image);
  });
}

export async function calendarRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: env.calendarMaxAttachmentBytes },
  });

  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('calendar'));

  fastify.get('/calendar/users', async (request, reply) => {
    const { tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.query as { workspaceId?: string }).workspaceId
    );

    const users = await fastify.db.user.findMany({
      where: {
        tenantId,
        status: 'active',
        role: { not: 'master' },
        id: { not: request.user.sub },
      },
      select: { id: true, email: true, role: true },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
    });

    return reply.send({ success: true, data: users });
  });

  fastify.get('/calendar/calendars', async (request, reply) => {
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.query as { workspaceId?: string }).workspaceId
    );

    const data = await listCalendars(request.user.sub, workspaceId, tenantId);
    return reply.send({ success: true, data });
  });

  fastify.post('/calendar/calendars', async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        timezone: z.string().min(1).max(64).optional(),
        visibility: visibilitySchema.optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await createCalendar(request.user.sub, tenantId, workspaceId, body);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'calendar.created',
        entityType: 'calendar',
        entityId: data?.id,
        ipAddress: request.ip,
        afterJson: { name: body.name },
      });

      return reply.status(201).send({ success: true, data, message: 'Calendário criado' });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/calendar/calendars/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const data = await getCalendar(request.user.sub, id);
      if (!data) {
        return reply.status(404).send({ success: false, error: 'Calendário não encontrado' });
      }
      return reply.send({ success: true, data });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.patch('/calendar/calendars/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        timezone: z.string().min(1).max(64).optional(),
        visibility: visibilitySchema.optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(request.body);

    try {
      const data = await updateCalendar(request.user.sub, id, body);

      await createAuditLog({
        tenantId: data?.tenantId,
        userId: request.user.sub,
        action: 'calendar.updated',
        entityType: 'calendar',
        entityId: id,
        ipAddress: request.ip,
        afterJson: body,
      });

      return reply.send({ success: true, data, message: 'Calendário actualizado' });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.delete('/calendar/calendars/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteCalendar(request.user.sub, id);

      await createAuditLog({
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        action: 'calendar.deleted',
        entityType: 'calendar',
        entityId: id,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, message: 'Calendário eliminado' });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.put('/calendar/calendars/:id/members', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        members: z.array(
          z.object({
            userId: z.string().uuid(),
            role: memberRoleSchema,
            notifyChanges: z.boolean().optional(),
          })
        ),
      })
      .parse(request.body);

    const { tenantId } = await resolveWorkspaceTenantScope(fastify, request.user);

    try {
      const data = await setCalendarMembers(request.user.sub, id, tenantId, body.members);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'calendar.members_updated',
        entityType: 'calendar',
        entityId: id,
        ipAddress: request.ip,
        afterJson: { memberCount: body.members.length },
      });

      return reply.send({ success: true, data, message: 'Membros actualizados' });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/calendar/events/today', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        timezone: z.string().max(64).optional(),
      })
      .parse(request.query);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await listTodayEvents(
      request.user.sub,
      workspaceId,
      tenantId,
      query.timezone ?? 'Europe/Lisbon'
    );

    return reply.send({ success: true, data });
  });

  fastify.get('/calendar/events', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        from: z.coerce.date(),
        to: z.coerce.date(),
        calendarIds: z
          .union([z.string().uuid(), z.array(z.string().uuid())])
          .optional()
          .transform((v) => (v == null ? undefined : Array.isArray(v) ? v : [v])),
      })
      .parse(request.query);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    if (query.to <= query.from) {
      return reply.status(400).send({ success: false, error: 'Intervalo de datas inválido' });
    }

    const data = await listEvents(request.user.sub, workspaceId, tenantId, {
      from: query.from,
      to: query.to,
      calendarIds: query.calendarIds,
    });

    return reply.send({ success: true, data });
  });

  fastify.post('/calendar/events', async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        calendarId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        location: z.string().max(500).optional(),
        startAt: z.coerce.date(),
        endAt: z.coerce.date(),
        allDay: z.boolean().optional(),
        timezone: z.string().max(64).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        recurrenceRule: z.string().max(500).optional(),
        recurrenceUntil: z.coerce.date().optional(),
        attendees: z.array(attendeeSchema).optional(),
        reminders: z.array(reminderSchema).optional(),
        guestEmails: guestEmailsSchema,
        guestPhones: guestPhonesSchema,
        notifyAttendeesByEmail: z.boolean().optional(),
        eventType: eventTypeSchema,
        scheduledInvoice: scheduledInvoiceSchema.optional(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await createEvent(request.user.sub, tenantId, workspaceId, body);

      let emailNotifications = null;
      let whatsappNotifications = null;
      if (data?.id && body.notifyAttendeesByEmail && body.eventType !== 'invoice') {
        try {
          emailNotifications = await sendCalendarAppointmentEmails(tenantId, data.id);
        } catch (emailErr) {
          emailNotifications = {
            sent: 0,
            skipped: 0,
            errors: [
              emailErr instanceof Error
                ? emailErr.message
                : 'Falha ao enviar notificações por email',
            ],
          };
        }
        try {
          whatsappNotifications = await sendCalendarAppointmentWhatsApp(
            tenantId,
            workspaceId,
            data.id
          );
        } catch (whatsappErr) {
          whatsappNotifications = {
            sent: 0,
            skipped: 0,
            errors: [
              whatsappErr instanceof Error
                ? whatsappErr.message
                : 'Falha ao enviar notificações por WhatsApp',
            ],
          };
        }
      }

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'calendar.event_created',
        entityType: 'calendar_event',
        entityId: data?.id,
        ipAddress: request.ip,
        afterJson: { title: body.title, calendarId: body.calendarId },
      });

      return reply.status(201).send({
        success: true,
        data,
        emailNotifications,
        whatsappNotifications,
        message: 'Evento criado',
      });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/calendar/events/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const data = await getEvent(request.user.sub, id);
      if (!data) {
        return reply.status(404).send({ success: false, error: 'Evento não encontrado' });
      }
      return reply.send({ success: true, data });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.patch('/calendar/events/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).nullable().optional(),
        location: z.string().max(500).nullable().optional(),
        startAt: z.coerce.date().optional(),
        endAt: z.coerce.date().optional(),
        allDay: z.boolean().optional(),
        timezone: z.string().max(64).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
        status: eventStatusSchema.optional(),
        recurrenceRule: z.string().max(500).nullable().optional(),
        recurrenceUntil: z.coerce.date().nullable().optional(),
        calendarId: z.string().uuid().optional(),
        attendees: z.array(attendeeSchema).optional(),
        reminders: z.array(reminderSchema).optional(),
        guestEmails: guestEmailsSchema,
        guestPhones: guestPhonesSchema,
        notifyAttendeesByEmail: z.boolean().optional(),
        eventType: eventTypeSchema,
        scheduledInvoice: scheduledInvoiceSchema.optional(),
      })
      .parse(request.body);

    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(fastify, request.user);

    try {
      const data = await updateEvent(request.user.sub, tenantId, id, body);

      let emailNotifications = null;
      let whatsappNotifications = null;
      const eventWorkspaceId =
        (data as { workspaceId?: string } | null)?.workspaceId ?? workspaceId;

      if (body.notifyAttendeesByEmail && data?.id && body.eventType !== 'invoice') {
        try {
          emailNotifications = await sendCalendarAppointmentEmails(tenantId, data.id);
        } catch (emailErr) {
          emailNotifications = {
            sent: 0,
            skipped: 0,
            errors: [
              emailErr instanceof Error
                ? emailErr.message
                : 'Falha ao enviar notificações por email',
            ],
          };
        }
        try {
          whatsappNotifications = await sendCalendarAppointmentWhatsApp(
            tenantId,
            eventWorkspaceId,
            data.id
          );
        } catch (whatsappErr) {
          whatsappNotifications = {
            sent: 0,
            skipped: 0,
            errors: [
              whatsappErr instanceof Error
                ? whatsappErr.message
                : 'Falha ao enviar notificações por WhatsApp',
            ],
          };
        }
      }

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'calendar.event_updated',
        entityType: 'calendar_event',
        entityId: id,
        ipAddress: request.ip,
        afterJson: body,
      });

      return reply.send({
        success: true,
        data,
        emailNotifications,
        whatsappNotifications,
        message: 'Evento actualizado',
      });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.delete('/calendar/events/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteEvent(request.user.sub, id);

      await createAuditLog({
        tenantId: request.user.tenantId,
        userId: request.user.sub,
        action: 'calendar.event_deleted',
        entityType: 'calendar_event',
        entityId: id,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, message: 'Evento eliminado' });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/calendar/events/:id/attachments', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const data = await listEventAttachments(request.user.sub, id);
      return reply.send({ success: true, data });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.post('/calendar/events/:id/attachments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        fileName: z.string().min(1).max(255),
        storageKey: z.string().min(1).max(500),
        mimeType: z.string().min(1).max(120),
        sizeBytes: z.coerce.bigint().nonnegative(),
      })
      .parse(request.body);

    const { tenantId } = await resolveWorkspaceTenantScope(fastify, request.user);

    try {
      const data = await addEventAttachment(request.user.sub, tenantId, id, body);
      return reply.status(201).send({ success: true, data, message: 'Anexo registado' });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.delete('/calendar/events/:eventId/attachments/:attachmentId', async (request, reply) => {
    const { eventId, attachmentId } = request.params as { eventId: string; attachmentId: string };
    try {
      await deleteEventAttachment(request.user.sub, eventId, attachmentId);
      return reply.send({ success: true, message: 'Anexo eliminado' });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.post('/calendar/events/:id/attachments/upload', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = await resolveWorkspaceTenantScope(fastify, request.user);

    try {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
      }

      const buffer = await file.toBuffer();
      const fileName = file.filename?.trim() || 'ficheiro';
      const mimeType = file.mimetype || 'application/octet-stream';

      const data = await uploadEventAttachment(request.user.sub, tenantId, id, {
        fileName,
        mimeType,
        buffer,
      });

      return reply.status(201).send({ success: true, data, message: 'Anexo carregado' });
    } catch (err) {
      const { status, message } = handleCalendarError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get(
    '/calendar/events/:eventId/attachments/:attachmentId/download',
    async (request, reply) => {
      const { eventId, attachmentId } = request.params as {
        eventId: string;
        attachmentId: string;
      };

      try {
        const attachment = await getEventAttachmentForDownload(
          request.user.sub,
          eventId,
          attachmentId
        );
        const stream = openCalendarAttachmentStream(attachment.storageKey);
        const safeName = attachment.fileName.replace(/[^\w.\-() ]+/g, '_');

        return reply
          .header('Content-Type', attachment.mimeType)
          .header('Content-Disposition', `attachment; filename="${safeName}"`)
          .send(stream);
      } catch (err) {
        const { status, message } = handleCalendarError(err);
        return reply.status(status).send({ success: false, error: message });
      }
    }
  );

  fastify.get('/calendar/reminders/upcoming', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        horizonDays: z.coerce.number().int().min(1).max(30).optional(),
      })
      .parse(request.query);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await listUpcomingReminders(request.user.sub, tenantId, workspaceId, {
      limit: query.limit,
      horizonDays: query.horizonDays,
    });

    return reply.send({ success: true, data });
  });

  fastify.get('/calendar/geocode', async (request, reply) => {
    const { address } = z.object({ address: z.string().min(1).max(500) }).parse(request.query);
    const coords = await resolveCoordinatesForMap(address);
    if (!coords) {
      return reply.send({ success: true, data: null });
    }
    return reply.send({
      success: true,
      data: {
        lat: coords.lat,
        lng: coords.lng,
        mapsUrl: `https://www.google.com/maps?q=${coords.lat},${coords.lng}`,
        previewImageUrl: buildMapPreviewImageUrl(coords.lat, coords.lng),
      },
    });
  });

  fastify.get('/calendar/settings/email-template', async (request, reply) => {
    if (!hasMinRole(request.user.role, 'staff')) {
      return reply.status(403).send({ success: false, error: 'Sem permissão' });
    }
    const { tenantId } = await resolveWorkspaceTenantScope(fastify, request.user);
    const data = await getCalendarEmailTemplateSettings(tenantId);
    return reply.send({ success: true, data });
  });

  fastify.put('/calendar/settings/email-template', async (request, reply) => {
    if (!hasMinRole(request.user.role, 'superadmin')) {
      return reply.status(403).send({ success: false, error: 'Sem permissão' });
    }
    const body = z
      .object({
        mode: z.enum(['default', 'custom']),
        subject: z.string().min(1).max(500).optional(),
        htmlBody: z.string().min(1).optional(),
      })
      .parse(request.body);

    const { tenantId } = await resolveWorkspaceTenantScope(fastify, request.user);

    try {
      const data = await saveCalendarEmailTemplateSettings(tenantId, body);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'calendar.email_template_updated',
        entityType: 'email_template',
        ipAddress: request.ip,
        afterJson: { mode: body.mode },
      });
      return reply.send({ success: true, data, message: 'Template de email guardado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao guardar template';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/calendar/settings/whatsapp', async (request, reply) => {
    if (!hasMinRole(request.user.role, 'staff')) {
      return reply.status(403).send({ success: false, error: 'Sem permissão' });
    }
    const query = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await getCalendarWhatsappSettings(tenantId, workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.put('/calendar/settings/whatsapp', async (request, reply) => {
    if (!hasMinRole(request.user.role, 'superadmin')) {
      return reply.status(403).send({ success: false, error: 'Sem permissão' });
    }
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        enabled: z.boolean(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await saveCalendarWhatsappSettings(tenantId, workspaceId, body.enabled);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'calendar.whatsapp_notifications_updated',
        entityType: 'tenant_setting',
        ipAddress: request.ip,
        afterJson: { enabled: body.enabled },
      });
      return reply.send({ success: true, data, message: 'Notificações WhatsApp actualizadas' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao guardar definições';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/calendar/settings/scheduled-invoice', async (request, reply) => {
    if (!hasMinRole(request.user.role, 'staff')) {
      return reply.status(403).send({ success: false, error: 'Sem permissão' });
    }
    const query = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await getCalendarScheduledInvoiceSettings(tenantId, workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.put('/calendar/settings/scheduled-invoice', async (request, reply) => {
    if (!hasMinRole(request.user.role, 'superadmin')) {
      return reply.status(403).send({ success: false, error: 'Sem permissão' });
    }
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        enabled: z.boolean().optional(),
        defaultCategoryId: z.number().int().positive().nullable().optional(),
      })
      .refine((b) => b.enabled != null || b.defaultCategoryId !== undefined, {
        message: 'Nada para actualizar',
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await saveCalendarScheduledInvoiceSettings(tenantId, workspaceId, {
        enabled: body.enabled,
        defaultCategoryId: body.defaultCategoryId,
      });
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'calendar.scheduled_invoice_updated',
        entityType: 'tenant_setting',
        ipAddress: request.ip,
        afterJson: { enabled: body.enabled, defaultCategoryId: body.defaultCategoryId },
      });
      return reply.send({ success: true, data, message: 'Autofaturação no calendário actualizada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao guardar definições';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.patch('/calendar/reminders/:id/dismiss', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const data = await dismissReminder(id, request.user.sub);
      return reply.send({ success: true, data, message: 'Lembrete dispensado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao dispensar lembrete';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}
