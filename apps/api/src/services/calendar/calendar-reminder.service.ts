import { prisma } from '@tvde/database';
import type { CalendarReminderChannel } from '@prisma/client';

export function computeFireAt(startAt: Date, offsetMinutes: number): Date {
  return new Date(startAt.getTime() - offsetMinutes * 60_000);
}

export async function syncEventReminders(
  eventId: string,
  tenantId: string,
  startAt: Date,
  reminders: Array<{
    userId: string;
    offsetMinutes: number;
    channel?: CalendarReminderChannel;
  }>
) {
  await prisma.calendarEventReminder.deleteMany({
    where: { eventId, status: 'pending' },
  });

  if (reminders.length === 0) return;

  await prisma.calendarEventReminder.createMany({
    data: reminders.map((r) => ({
      tenantId,
      eventId,
      userId: r.userId,
      offsetMinutes: r.offsetMinutes,
      channel: r.channel ?? 'in_app',
      fireAt: computeFireAt(startAt, r.offsetMinutes),
      status: 'pending' as const,
    })),
  });
}

export async function recalcPendingReminderFireTimes(eventId: string, startAt: Date) {
  const pending = await prisma.calendarEventReminder.findMany({
    where: { eventId, status: 'pending' },
    select: { id: true, offsetMinutes: true },
  });

  await Promise.all(
    pending.map((r) =>
      prisma.calendarEventReminder.update({
        where: { id: r.id },
        data: { fireAt: computeFireAt(startAt, r.offsetMinutes) },
      })
    )
  );
}

export async function listUpcomingReminders(
  userId: string,
  tenantId: string,
  workspaceId: string,
  options: { limit?: number; horizonDays?: number; dueOnly?: boolean; channel?: CalendarReminderChannel } = {}
) {
  const limit = Math.min(options.limit ?? 20, 100);
  const now = new Date();
  const fireAtFilter = options.dueOnly
    ? { lte: now }
    : { lte: new Date(now.getTime() + (options.horizonDays ?? 7) * 24 * 60 * 60_000) };

  return prisma.calendarEventReminder.findMany({
    where: {
      userId,
      tenantId,
      status: 'pending',
      fireAt: fireAtFilter,
      ...(options.channel ? { channel: options.channel } : {}),
      event: {
        workspaceId,
        status: { not: 'cancelled' },
      },
    },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
          allDay: true,
          calendarId: true,
          calendar: { select: { name: true, color: true } },
        },
      },
    },
    orderBy: { fireAt: 'asc' },
    take: limit,
  });
}

/** Marca lembrete in-app como enviado (toast mostrado). */
export async function acknowledgeReminder(reminderId: string, userId: string) {
  const reminder = await prisma.calendarEventReminder.findFirst({
    where: { id: reminderId, userId },
  });
  if (!reminder) throw new Error('Lembrete não encontrado');
  if (reminder.status !== 'pending') return reminder;

  return prisma.calendarEventReminder.update({
    where: { id: reminderId },
    data: { status: 'sent', sentAt: new Date() },
  });
}

export async function dismissReminder(reminderId: string, userId: string) {
  const reminder = await prisma.calendarEventReminder.findFirst({
    where: { id: reminderId, userId },
  });
  if (!reminder) throw new Error('Lembrete não encontrado');
  if (reminder.status === 'dismissed') return reminder;
  if (reminder.status !== 'pending' && reminder.status !== 'sent') {
    throw new Error('Lembrete já processado');
  }

  return prisma.calendarEventReminder.update({
    where: { id: reminderId },
    data: { status: 'dismissed', dismissedAt: new Date() },
  });
}
