import { prisma } from '@tvde/database';
import type {
  CalendarAttendeeRole,
  CalendarMemberRole,
  CalendarReminderChannel,
  CalendarVisibility,
  Prisma,
} from '@prisma/client';

function asMetadataJson(value: ReturnType<typeof mergeEventMetadata>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
import {
  assertUsersInTenant,
  CalendarAccessError,
  listVisibleCalendarIds,
  requireCalendarEdit,
  requireCalendarView,
  requireEventEdit,
  requireEventView,
} from './calendar-access.service';
import { mergeGuestContactsMetadata, readGuestEmails, readGuestPhones } from './calendar-guest-emails';
import { mergeEventMetadata, readEventType } from './calendar-event-metadata';
import {
  cancelPendingScheduledInvoicesForEvent,
  serializeScheduledInvoice,
  upsertScheduledInvoiceForEvent,
} from './calendar-scheduled-invoice.service';
import { isCalendarScheduledInvoiceEnabled } from './calendar-scheduled-invoice-settings.service';
import type { CalendarScheduledInvoiceDraft } from '@tvde/shared';
import {
  DEFAULT_CALENDAR_TIMEZONE,
  formatDateTimeLocal,
  getTodayRangeInTimezone,
  parseCalendarOccurrenceId,
} from '@tvde/shared';
import { env } from '../../config/env';
import { assertTenantStorageQuota } from '../tenant-storage.service';
import {
  buildCalendarStorageKey,
  deleteCalendarAttachmentFile,
  saveCalendarAttachmentFile,
} from './calendar-attachment-storage.service';
import { expandRecurringEvent } from './calendar-recurrence-expand.service';
import { recalcPendingReminderFireTimes, syncEventReminders } from './calendar-reminder.service';

function assertStartNotInPast(startAt: Date, allDay: boolean, timeZone: string) {
  const now = new Date();
  if (allDay) {
    const startDay = formatDateTimeLocal(startAt, timeZone, true);
    const today = formatDateTimeLocal(now, timeZone, true);
    if (startDay < today) {
      throw new Error('A data de início não pode ser no passado');
    }
    return;
  }
  if (startAt < now) {
    throw new Error('A data de início não pode ser anterior à hora actual');
  }
}

const calendarInclude = {
  owner: { select: { id: true, email: true } },
  members: {
    include: { user: { select: { id: true, email: true, role: true } } },
    orderBy: { addedAt: 'asc' as const },
  },
  _count: { select: { events: true } },
} satisfies Prisma.CalendarInclude;

const eventInclude = {
  calendar: { select: { id: true, name: true, color: true } },
  createdBy: { select: { id: true, email: true } },
  attendees: {
    include: { user: { select: { id: true, email: true, role: true } } },
    orderBy: { invitedAt: 'asc' as const },
  },
  reminders: {
    where: { status: 'pending' },
    select: {
      id: true,
      userId: true,
      offsetMinutes: true,
      channel: true,
      fireAt: true,
      status: true,
    },
  },
  attachments: {
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
      createdAt: true,
      uploadedBy: { select: { id: true, email: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { scheduledInvoices: true } },
  scheduledInvoices: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      billingEntityId: true,
      invoiceId: true,
      errorMessage: true,
      emailSentAt: true,
      emailErrorMessage: true,
      draftPayloadJson: true,
      billingEntity: { select: { id: true, name: true, email: true } },
      invoice: { select: { emailSentAt: true } },
    },
  },
} satisfies Prisma.CalendarEventInclude;

function serializeAttachment<T extends { sizeBytes: bigint }>(row: T) {
  return { ...row, sizeBytes: row.sizeBytes.toString() };
}

function serializeEvent<
  T extends {
    attachments?: Array<{ sizeBytes: bigint }>;
    metadataJson?: unknown;
    scheduledInvoices?: Array<{
      id: string;
      status: string;
      scheduledAt: Date;
      billingEntityId: string;
      invoiceId: string | null;
      errorMessage: string | null;
      emailSentAt?: Date | null;
      emailErrorMessage?: string | null;
      draftPayloadJson: unknown;
      billingEntity: { id: string; name: string; email: string | null };
      invoice?: { emailSentAt: Date | null } | null;
    }>;
  },
>(event: T) {
  const guestEmails = readGuestEmails(event.metadataJson);
  const guestPhones = readGuestPhones(event.metadataJson);
  const eventType = readEventType(event.metadataJson);
  const scheduledInvoiceRow = event.scheduledInvoices?.[0];
  const scheduledInvoice = scheduledInvoiceRow
    ? serializeScheduledInvoice(scheduledInvoiceRow)
    : null;
  const withGuests = { ...event, guestEmails, guestPhones, eventType, scheduledInvoice };
  if (!event.attachments) {
    const { scheduledInvoices: _omit, ...rest } = withGuests as T & {
      scheduledInvoices?: unknown;
    };
    return rest;
  }
  const { scheduledInvoices: _omit, ...rest } = withGuests as T & { scheduledInvoices?: unknown };
  return {
    ...rest,
    attachments: event.attachments.map(serializeAttachment),
  };
}

export async function listCalendars(
  userId: string,
  workspaceId: string,
  tenantId: string
) {
  const ids = await listVisibleCalendarIds(userId, workspaceId, tenantId);
  if (ids.length === 0) return [];

  return prisma.calendar.findMany({
    where: { id: { in: ids } },
    include: calendarInclude,
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

export async function getCalendar(userId: string, calendarId: string) {
  await requireCalendarView(userId, calendarId);
  return prisma.calendar.findUnique({
    where: { id: calendarId },
    include: calendarInclude,
  });
}

export async function createCalendar(
  userId: string,
  tenantId: string,
  workspaceId: string,
  input: {
    name: string;
    description?: string;
    color?: string;
    timezone?: string;
    visibility?: CalendarVisibility;
    isDefault?: boolean;
  }
) {
  if (input.isDefault) {
    await prisma.calendar.updateMany({
      where: { ownerUserId: userId, workspaceId, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.$transaction(async (tx) => {
    const calendar = await tx.calendar.create({
      data: {
        tenantId,
        workspaceId,
        ownerUserId: userId,
        name: input.name,
        description: input.description,
        color: input.color ?? '#3b82f6',
        timezone: input.timezone ?? 'Europe/Lisbon',
        visibility: input.visibility ?? 'private',
        isDefault: input.isDefault ?? false,
      },
    });

    await tx.calendarMember.create({
      data: {
        calendarId: calendar.id,
        userId,
        role: 'owner',
        addedByUserId: userId,
      },
    });

    return tx.calendar.findUnique({
      where: { id: calendar.id },
      include: calendarInclude,
    });
  });
}

export async function updateCalendar(
  userId: string,
  calendarId: string,
  input: {
    name?: string;
    description?: string | null;
    color?: string;
    timezone?: string;
    visibility?: CalendarVisibility;
    isDefault?: boolean;
  }
) {
  await requireCalendarEdit(userId, calendarId);

  const existing = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!existing) throw new CalendarAccessError('Calendário não encontrado');

  if (input.isDefault) {
    await prisma.calendar.updateMany({
      where: {
        ownerUserId: existing.ownerUserId,
        workspaceId: existing.workspaceId,
        isDefault: true,
        id: { not: calendarId },
      },
      data: { isDefault: false },
    });
  }

  return prisma.calendar.update({
    where: { id: calendarId },
    data: {
      name: input.name,
      description: input.description,
      color: input.color,
      timezone: input.timezone,
      visibility: input.visibility,
      isDefault: input.isDefault,
    },
    include: calendarInclude,
  });
}

export async function deleteCalendar(userId: string, calendarId: string) {
  const role = await prisma.calendarMember.findFirst({
    where: { calendarId, userId, role: 'owner' },
  });
  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar || calendar.ownerUserId !== userId || !role) {
    throw new CalendarAccessError('Apenas o proprietário pode eliminar o calendário');
  }

  await prisma.calendar.delete({ where: { id: calendarId } });
  return { success: true };
}

export async function setCalendarMembers(
  userId: string,
  calendarId: string,
  tenantId: string,
  members: Array<{
    userId: string;
    role: CalendarMemberRole;
    notifyChanges?: boolean;
  }>
) {
  await requireCalendarEdit(userId, calendarId);

  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) throw new CalendarAccessError('Calendário não encontrado');

  const memberIds = members.map((m) => m.userId).filter((id) => id !== calendar.ownerUserId);
  await assertUsersInTenant(tenantId, memberIds);

  for (const m of members) {
    if (m.role === 'owner' && m.userId !== calendar.ownerUserId) {
      throw new CalendarAccessError('Não é possível atribuir outro proprietário');
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.calendarMember.deleteMany({
      where: { calendarId, userId: { not: calendar.ownerUserId } },
    });

    if (memberIds.length > 0) {
      await tx.calendarMember.createMany({
        data: members
          .filter((m) => m.userId !== calendar.ownerUserId)
          .map((m) => ({
            calendarId,
            userId: m.userId,
            role: m.role === 'owner' ? 'editor' : m.role,
            notifyChanges: m.notifyChanges ?? true,
            addedByUserId: userId,
          })),
        skipDuplicates: true,
      });
    }
  });

  return getCalendar(userId, calendarId);
}

type AttendeeInput = {
  userId: string;
  role?: CalendarAttendeeRole;
  canEdit?: boolean;
  notify?: boolean;
};

type ReminderInput = {
  userId?: string;
  offsetMinutes: number;
  channel?: CalendarReminderChannel;
};

export async function listEvents(
  userId: string,
  workspaceId: string,
  tenantId: string,
  query: {
    from: Date;
    to: Date;
    calendarIds?: string[];
  }
) {
  const visibleIds = await listVisibleCalendarIds(userId, workspaceId, tenantId);
  let calendarFilter = visibleIds;

  if (query.calendarIds?.length) {
    const allowed = new Set(visibleIds);
    calendarFilter = query.calendarIds.filter((id) => allowed.has(id));
    if (calendarFilter.length === 0) return [];
  }

  if (calendarFilter.length === 0) return [];

  const events = await prisma.calendarEvent.findMany({
    where: {
      workspaceId,
      tenantId,
      calendarId: { in: calendarFilter },
      seriesMasterId: null,
      AND: [
        {
          OR: [
            { calendarId: { in: visibleIds } },
            { attendees: { some: { userId } } },
          ],
        },
        {
          OR: [
            {
              recurrenceRule: null,
              startAt: { lt: query.to },
              endAt: { gt: query.from },
            },
            {
              recurrenceRule: { not: null },
              startAt: { lte: query.to },
              OR: [
                { recurrenceUntil: null },
                { recurrenceUntil: { gte: query.from } },
              ],
            },
          ],
        },
      ],
    },
    include: eventInclude,
    orderBy: { startAt: 'asc' },
  });

  const expanded: Array<ReturnType<typeof serializeEvent>> = [];

  for (const event of events) {
    if (event.recurrenceRule) {
      for (const occurrence of expandRecurringEvent(
        {
          ...event,
          recurrenceRule: event.recurrenceRule,
        },
        query.from,
        query.to
      )) {
        expanded.push(serializeEvent(occurrence as typeof event));
      }
      continue;
    }
    expanded.push(serializeEvent(event));
  }

  return expanded.sort((a, b) => {
    const aStart = (a as unknown as { startAt: Date | string }).startAt;
    const bStart = (b as unknown as { startAt: Date | string }).startAt;
    return new Date(aStart).getTime() - new Date(bStart).getTime();
  });
}

export async function listTodayEvents(
  userId: string,
  workspaceId: string,
  tenantId: string,
  timezone: string = DEFAULT_CALENDAR_TIMEZONE
) {
  const { from, to } = getTodayRangeInTimezone(timezone);
  return listEvents(userId, workspaceId, tenantId, { from, to });
}

export async function getEvent(userId: string, eventId: string) {
  const occurrence = parseCalendarOccurrenceId(eventId);
  const masterId = occurrence?.masterId ?? eventId;

  await requireEventView(userId, masterId);
  const event = await prisma.calendarEvent.findUnique({
    where: { id: masterId },
    include: eventInclude,
  });
  if (!event) return null;

  const serialized = serializeEvent(event);
  if (!occurrence) return serialized;

  const durationMs = event.endAt.getTime() - event.startAt.getTime();
  const startAt = occurrence.occurrenceStart;
  const endAt = new Date(startAt.getTime() + durationMs);

  return {
    ...serialized,
    id: eventId,
    startAt,
    endAt,
    seriesMasterId: masterId,
    originalStartAt: startAt,
    isOccurrence: true,
  };
}

function buildReminderTargets(
  creatorUserId: string,
  attendees: AttendeeInput[],
  reminders: ReminderInput[]
): ReminderInput[] {
  if (reminders.length === 0) {
    return [{ userId: creatorUserId, offsetMinutes: 15, channel: 'in_app' }];
  }

  const notifyUserIds = new Set<string>([creatorUserId]);
  for (const a of attendees) {
    if (a.notify !== false) notifyUserIds.add(a.userId);
  }

  const resolved: ReminderInput[] = [];
  for (const r of reminders) {
    if (r.userId) {
      resolved.push(r);
    } else {
      for (const uid of notifyUserIds) {
        resolved.push({ ...r, userId: uid });
      }
    }
  }
  return resolved;
}

export async function createEvent(
  userId: string,
  tenantId: string,
  workspaceId: string,
  input: {
    calendarId: string;
    title: string;
    description?: string;
    location?: string;
    startAt: Date;
    endAt: Date;
    allDay?: boolean;
    timezone?: string;
    color?: string;
    recurrenceRule?: string;
    recurrenceUntil?: Date;
    eventType?: 'appointment' | 'invoice';
    scheduledInvoice?: CalendarScheduledInvoiceDraft;
    attendees?: AttendeeInput[];
    reminders?: ReminderInput[];
    guestEmails?: string[];
    guestPhones?: string[];
  }
) {
  await requireCalendarEdit(userId, input.calendarId);

  const eventType = input.eventType ?? 'appointment';
  if (eventType === 'invoice') {
    if (input.recurrenceRule) {
      throw new Error('Eventos de fatura agendada não suportam recorrência');
    }
    const enabled = await isCalendarScheduledInvoiceEnabled(tenantId, workspaceId);
    if (!enabled) {
      throw new Error('Autofaturação no calendário não está activa');
    }
    if (!input.scheduledInvoice) {
      throw new Error('Dados de fatura agendada em falta');
    }
  }

  const calendar = await prisma.calendar.findFirst({
    where: { id: input.calendarId, workspaceId, tenantId },
  });
  if (!calendar) throw new CalendarAccessError('Calendário não encontrado');

  if (input.endAt <= input.startAt) {
    throw new Error('A data de fim deve ser posterior à data de início');
  }

  assertStartNotInPast(
    input.startAt,
    input.allDay ?? false,
    input.timezone ?? calendar.timezone
  );

  const attendees = eventType === 'invoice' ? [] : (input.attendees ?? []);
  const attendeeIds = [...new Set(attendees.map((a) => a.userId))];
  if (attendeeIds.length > 0) {
    await assertUsersInTenant(tenantId, attendeeIds);
  }

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.calendarEvent.create({
      data: {
        tenantId,
        workspaceId,
        calendarId: input.calendarId,
        createdByUserId: userId,
        title: input.title,
        description: input.description,
        location: eventType === 'invoice' ? null : input.location,
        startAt: input.startAt,
        endAt: input.endAt,
        allDay: eventType === 'invoice' ? false : (input.allDay ?? false),
        timezone: input.timezone ?? calendar.timezone,
        color: input.color ?? (eventType === 'invoice' ? '#f59e0b' : undefined),
        recurrenceRule: eventType === 'invoice' ? null : input.recurrenceRule,
        recurrenceUntil: eventType === 'invoice' ? null : input.recurrenceUntil,
        metadataJson: asMetadataJson(
          mergeEventMetadata({}, {
            eventType,
            guestEmails: input.guestEmails ?? [],
            guestPhones: input.guestPhones ?? [],
          })
        ),
      },
    });

    const attendeeRows: Array<{
      eventId: string;
      userId: string;
      role: CalendarAttendeeRole;
      canEdit: boolean;
      notify: boolean;
      invitedByUserId: string;
    }> = [
      {
        eventId: created.id,
        userId,
        role: 'organizer',
        canEdit: true,
        notify: true,
        invitedByUserId: userId,
      },
    ];

    for (const a of attendees) {
      if (a.userId === userId) continue;
      attendeeRows.push({
        eventId: created.id,
        userId: a.userId,
        role: a.role ?? 'required',
        canEdit: a.canEdit ?? false,
        notify: a.notify ?? true,
        invitedByUserId: userId,
      });
    }

    await tx.calendarEventAttendee.createMany({ data: attendeeRows, skipDuplicates: true });

    return created;
  });

  if (eventType === 'invoice' && input.scheduledInvoice) {
    await upsertScheduledInvoiceForEvent({
      tenantId,
      workspaceId,
      eventId: event.id,
      createdByUserId: userId,
      scheduledAt: input.startAt,
      draft: input.scheduledInvoice,
    });
  }

  if (eventType !== 'invoice') {
    const reminderTargets = buildReminderTargets(userId, attendees, input.reminders ?? []);
    const reminderUsers = reminderTargets
      .filter((r): r is ReminderInput & { userId: string } => Boolean(r.userId))
      .map((r) => ({
        userId: r.userId,
        offsetMinutes: r.offsetMinutes,
        channel: r.channel,
      }));

    await assertUsersInTenant(tenantId, reminderUsers.map((r) => r.userId));
    await syncEventReminders(event.id, tenantId, event.startAt, reminderUsers);
  }

  return getEvent(userId, event.id);
}

export async function updateEvent(
  userId: string,
  tenantId: string,
  eventId: string,
  input: {
    title?: string;
    description?: string | null;
    location?: string | null;
    startAt?: Date;
    endAt?: Date;
    allDay?: boolean;
    timezone?: string;
    color?: string | null;
    status?: 'confirmed' | 'tentative' | 'cancelled';
    calendarId?: string;
    recurrenceRule?: string | null;
    recurrenceUntil?: Date | null;
    eventType?: 'appointment' | 'invoice';
    scheduledInvoice?: CalendarScheduledInvoiceDraft | null;
    attendees?: AttendeeInput[];
    reminders?: ReminderInput[];
    guestEmails?: string[];
    guestPhones?: string[];
  }
) {
  const masterId = parseCalendarOccurrenceId(eventId)?.masterId ?? eventId;
  await requireEventEdit(userId, masterId);

  const existing = await prisma.calendarEvent.findUnique({ where: { id: masterId } });
  if (!existing) throw new CalendarAccessError('Evento não encontrado');

  const currentEventType = readEventType(existing.metadataJson);
  const nextEventType = input.eventType ?? currentEventType;

  if (nextEventType === 'invoice') {
    if (input.recurrenceRule) {
      throw new Error('Eventos de fatura agendada não suportam recorrência');
    }
    const enabled = await isCalendarScheduledInvoiceEnabled(tenantId, existing.workspaceId);
    if (!enabled) {
      throw new Error('Autofaturação no calendário não está activa');
    }
  }

  if (input.calendarId && input.calendarId !== existing.calendarId) {
    await requireCalendarEdit(userId, input.calendarId);
  }

  const startAt = input.startAt ?? existing.startAt;
  const endAt = input.endAt ?? existing.endAt;
  if (endAt <= startAt) {
    throw new Error('A data de fim deve ser posterior à data de início');
  }

  if (input.startAt && input.startAt.getTime() !== existing.startAt.getTime()) {
    assertStartNotInPast(
      input.startAt,
      input.allDay ?? existing.allDay,
      input.timezone ?? existing.timezone
    );
  }

  const metadataUpdate =
    input.guestEmails !== undefined ||
    input.guestPhones !== undefined ||
    input.eventType !== undefined
      ? mergeEventMetadata(existing.metadataJson, {
          ...(input.guestEmails !== undefined ? { guestEmails: input.guestEmails } : {}),
          ...(input.guestPhones !== undefined ? { guestPhones: input.guestPhones } : {}),
          ...(input.eventType !== undefined ? { eventType: input.eventType } : {}),
        })
      : undefined;

  await prisma.calendarEvent.update({
    where: { id: masterId },
    data: {
      title: input.title,
      description: input.description,
      location: nextEventType === 'invoice' ? null : input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: nextEventType === 'invoice' ? false : input.allDay,
      timezone: input.timezone,
      color: input.color,
      status: input.status,
      calendarId: input.calendarId,
      recurrenceRule: nextEventType === 'invoice' ? null : input.recurrenceRule,
      recurrenceUntil: nextEventType === 'invoice' ? null : input.recurrenceUntil,
      ...(metadataUpdate !== undefined ? { metadataJson: asMetadataJson(metadataUpdate) } : {}),
    },
  });

  if (nextEventType === 'invoice' && input.scheduledInvoice) {
    const latest = await prisma.calendarScheduledInvoice.findFirst({
      where: { eventId: masterId },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && ['completed', 'processing'].includes(latest.status)) {
      throw new Error('Esta fatura agendada já foi processada e não pode ser alterada');
    }
    await upsertScheduledInvoiceForEvent({
      tenantId,
      workspaceId: existing.workspaceId,
      eventId: masterId,
      createdByUserId: userId,
      scheduledAt: startAt,
      draft: input.scheduledInvoice,
    });
  } else if (nextEventType === 'appointment' && currentEventType === 'invoice') {
    await cancelPendingScheduledInvoicesForEvent(masterId);
  } else if (nextEventType === 'invoice' && input.startAt) {
    await prisma.calendarScheduledInvoice.updateMany({
      where: { eventId: masterId, status: 'pending' },
      data: { scheduledAt: startAt },
    });
  }

  if (input.attendees && nextEventType !== 'invoice') {
    await assertUsersInTenant(
      tenantId,
      input.attendees.map((a) => a.userId)
    );

    await prisma.$transaction(async (tx) => {
      await tx.calendarEventAttendee.deleteMany({
        where: { eventId: masterId, role: { not: 'organizer' } },
      });

      const rows = input.attendees!
        .filter((a) => a.userId !== userId)
        .map((a) => ({
          eventId: masterId,
          userId: a.userId,
          role: a.role ?? ('required' as const),
          canEdit: a.canEdit ?? false,
          notify: a.notify ?? true,
          invitedByUserId: userId,
        }));

      if (rows.length > 0) {
        await tx.calendarEventAttendee.createMany({ data: rows, skipDuplicates: true });
      }
    });
  }

  if (input.startAt || input.endAt) {
    await recalcPendingReminderFireTimes(masterId, startAt);
  }

  if (input.reminders && nextEventType !== 'invoice') {
    const attendees =
      input.attendees ??
      (await prisma.calendarEventAttendee.findMany({
        where: { eventId: masterId },
        select: { userId: true, notify: true, canEdit: true, role: true },
      })).map((a) => ({
        userId: a.userId,
        role: a.role,
        canEdit: a.canEdit,
        notify: a.notify,
      }));

    const reminderTargets = buildReminderTargets(userId, attendees, input.reminders);
    const reminderUsers = reminderTargets
      .filter((r): r is ReminderInput & { userId: string } => Boolean(r.userId))
      .map((r) => ({
        userId: r.userId,
        offsetMinutes: r.offsetMinutes,
        channel: r.channel,
      }));

    await assertUsersInTenant(tenantId, reminderUsers.map((r) => r.userId));
    await syncEventReminders(masterId, tenantId, startAt, reminderUsers);
  }

  return getEvent(userId, masterId);
}

export async function deleteEvent(userId: string, eventId: string) {
  const masterId = parseCalendarOccurrenceId(eventId)?.masterId ?? eventId;
  await requireEventEdit(userId, masterId);

  await cancelPendingScheduledInvoicesForEvent(masterId);

  const attachments = await prisma.calendarEventAttachment.findMany({
    where: { eventId: masterId },
    select: { storageKey: true },
  });

  await prisma.calendarEvent.delete({ where: { id: masterId } });

  await Promise.all(attachments.map((a) => deleteCalendarAttachmentFile(a.storageKey)));
  return { success: true };
}

export async function listEventAttachments(userId: string, eventId: string) {
  await requireEventView(userId, eventId);
  const rows = await prisma.calendarEventAttachment.findMany({
    where: { eventId },
    include: { uploadedBy: { select: { id: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(serializeAttachment);
}

export async function addEventAttachment(
  userId: string,
  tenantId: string,
  eventId: string,
  input: {
    fileName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint;
  }
) {
  await requireEventEdit(userId, eventId);

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, tenantId },
  });
  if (!event) throw new CalendarAccessError('Evento não encontrado');

  const row = await prisma.calendarEventAttachment.create({
    data: {
      tenantId,
      eventId,
      fileName: input.fileName,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedByUserId: userId,
    },
    include: { uploadedBy: { select: { id: true, email: true } } },
  });

  return serializeAttachment(row);
}

export async function deleteEventAttachment(
  userId: string,
  eventId: string,
  attachmentId: string
) {
  const masterId = parseCalendarOccurrenceId(eventId)?.masterId ?? eventId;
  await requireEventEdit(userId, masterId);

  const attachment = await prisma.calendarEventAttachment.findFirst({
    where: { id: attachmentId, eventId: masterId },
  });
  if (!attachment) throw new Error('Anexo não encontrado');

  await prisma.calendarEventAttachment.delete({ where: { id: attachmentId } });
  await deleteCalendarAttachmentFile(attachment.storageKey);
  return { success: true, storageKey: attachment.storageKey };
}

export async function uploadEventAttachment(
  userId: string,
  tenantId: string,
  eventId: string,
  input: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }
) {
  const masterId = parseCalendarOccurrenceId(eventId)?.masterId ?? eventId;

  if (input.buffer.length > env.calendarMaxAttachmentBytes) {
    throw new Error(
      `Ficheiro demasiado grande (máx. ${Math.round(env.calendarMaxAttachmentBytes / 1024 / 1024)} MB)`
    );
  }

  await requireEventEdit(userId, masterId);

  const event = await prisma.calendarEvent.findFirst({
    where: { id: masterId, tenantId },
  });
  if (!event) throw new CalendarAccessError('Evento não encontrado');

  await assertTenantStorageQuota(prisma, tenantId, input.buffer.length);

  const storageKey = buildCalendarStorageKey(tenantId, masterId, input.fileName);
  await saveCalendarAttachmentFile(storageKey, input.buffer);

  try {
    const row = await prisma.calendarEventAttachment.create({
      data: {
        tenantId,
        eventId: masterId,
        fileName: input.fileName,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.buffer.length),
        uploadedByUserId: userId,
      },
      include: { uploadedBy: { select: { id: true, email: true } } },
    });
    return serializeAttachment(row);
  } catch (err) {
    await deleteCalendarAttachmentFile(storageKey);
    throw err;
  }
}

export async function getEventAttachmentForDownload(
  userId: string,
  eventId: string,
  attachmentId: string
) {
  const masterId = parseCalendarOccurrenceId(eventId)?.masterId ?? eventId;
  await requireEventView(userId, masterId);

  const attachment = await prisma.calendarEventAttachment.findFirst({
    where: { id: attachmentId, eventId: masterId },
  });
  if (!attachment) throw new Error('Anexo não encontrado');

  return serializeAttachment(attachment);
}

export { CalendarAccessError };
