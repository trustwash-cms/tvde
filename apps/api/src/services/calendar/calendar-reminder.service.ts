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
  options: { limit?: number; horizonDays?: number } = {}
) {
  const limit = Math.min(options.limit ?? 20, 100);
  const horizonMs = (options.horizonDays ?? 7) * 24 * 60 * 60_000;
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonMs);

  return prisma.calendarEventReminder.findMany({
    where: {
      userId,
      tenantId,
      status: 'pending',
      fireAt: { lte: horizon },
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

export async function dismissReminder(reminderId: string, userId: string) {
  const reminder = await prisma.calendarEventReminder.findFirst({
    where: { id: reminderId, userId },
  });
  if (!reminder) throw new Error('Lembrete não encontrado');
  if (reminder.status !== 'pending') throw new Error('Lembrete já processado');

  return prisma.calendarEventReminder.update({
    where: { id: reminderId },
    data: { status: 'dismissed', dismissedAt: new Date() },
  });
}
