import { prisma } from '@tvde/database';
import type { CalendarMemberRole, CalendarVisibility } from '@prisma/client';

const EDIT_ROLES: CalendarMemberRole[] = ['owner', 'editor'];

export class CalendarAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarAccessError';
  }
}

async function getCalendarWithAcl(calendarId: string) {
  return prisma.calendar.findUnique({
    where: { id: calendarId },
    include: {
      members: { select: { userId: true, role: true } },
    },
  });
}

export async function getCalendarMemberRole(
  userId: string,
  calendarId: string
): Promise<CalendarMemberRole | null> {
  const calendar = await getCalendarWithAcl(calendarId);
  if (!calendar) return null;
  if (calendar.ownerUserId === userId) return 'owner';
  const member = calendar.members.find((m) => m.userId === userId);
  return member?.role ?? null;
}

export async function canViewCalendar(userId: string, calendarId: string): Promise<boolean> {
  const calendar = await getCalendarWithAcl(calendarId);
  if (!calendar) return false;
  if (calendar.ownerUserId === userId) return true;
  if (calendar.members.some((m) => m.userId === userId)) return true;
  if (calendar.visibility === 'workspace') return true;
  return false;
}

export async function canEditCalendar(userId: string, calendarId: string): Promise<boolean> {
  const calendar = await getCalendarWithAcl(calendarId);
  if (!calendar) return false;
  if (calendar.ownerUserId === userId) return true;
  const member = calendar.members.find((m) => m.userId === userId);
  return member ? EDIT_ROLES.includes(member.role) : false;
}

export async function canManageCalendarMembers(userId: string, calendarId: string): Promise<boolean> {
  const role = await getCalendarMemberRole(userId, calendarId);
  return role === 'owner' || role === 'editor';
}

export async function canViewEvent(userId: string, eventId: string): Promise<boolean> {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: {
      calendarId: true,
      calendar: { select: { visibility: true, ownerUserId: true, workspaceId: true } },
      attendees: { select: { userId: true } },
    },
  });
  if (!event) return false;
  if (event.attendees.some((a) => a.userId === userId)) return true;
  return canViewCalendar(userId, event.calendarId);
}

export async function canEditEvent(userId: string, eventId: string): Promise<boolean> {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: {
      calendarId: true,
      createdByUserId: true,
      attendees: { select: { userId: true, canEdit: true } },
    },
  });
  if (!event) return false;
  if (event.createdByUserId === userId) return true;
  if (event.attendees.some((a) => a.userId === userId && a.canEdit)) return true;
  return canEditCalendar(userId, event.calendarId);
}

export async function listVisibleCalendarIds(
  userId: string,
  workspaceId: string,
  tenantId: string
): Promise<string[]> {
  const calendars = await prisma.calendar.findMany({
    where: {
      workspaceId,
      tenantId,
      OR: [
        { ownerUserId: userId },
        { members: { some: { userId } } },
        { visibility: 'workspace' as CalendarVisibility },
      ],
    },
    select: { id: true },
  });
  return calendars.map((c) => c.id);
}

export async function assertUsersInTenant(tenantId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, status: 'active' },
    select: { id: true, tenantId: true, role: true },
  });
  if (users.length !== unique.length) {
    throw new CalendarAccessError('Utilizador inválido para este tenant');
  }
  for (const user of users) {
    if (user.role === 'master') continue;
    if (user.tenantId !== tenantId) {
      throw new CalendarAccessError('Utilizador inválido para este tenant');
    }
  }
}

export async function requireCalendarView(userId: string, calendarId: string) {
  if (!(await canViewCalendar(userId, calendarId))) {
    throw new CalendarAccessError('Sem acesso a este calendário');
  }
}

export async function requireCalendarEdit(userId: string, calendarId: string) {
  if (!(await canEditCalendar(userId, calendarId))) {
    throw new CalendarAccessError('Sem permissão para editar este calendário');
  }
}

export async function requireEventView(userId: string, eventId: string) {
  if (!(await canViewEvent(userId, eventId))) {
    throw new CalendarAccessError('Sem acesso a este evento');
  }
}

export async function requireEventEdit(userId: string, eventId: string) {
  if (!(await canEditEvent(userId, eventId))) {
    throw new CalendarAccessError('Sem permissão para editar este evento');
  }
}
