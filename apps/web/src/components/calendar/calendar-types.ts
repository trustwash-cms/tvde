import type {
  CalendarEventType,
  CalendarScheduledInvoiceDraft,
  CalendarScheduledInvoiceSummary,
} from '@tvde/shared';

export interface CalendarUser {
  id: string;
  email: string;
  role: string;
}

export interface CalendarMember {
  id: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  notifyChanges: boolean;
  user: CalendarUser;
}

export interface CalendarRecord {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  timezone: string;
  visibility: 'private' | 'workspace' | 'shared';
  isDefault: boolean;
  ownerUserId: string;
  owner: CalendarUser;
  members: CalendarMember[];
  _count?: { events: number };
}

export interface CalendarEventAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  storageKey: string;
  createdAt: string;
  uploadedBy?: CalendarUser;
}

export interface CalendarAttendee {
  id: string;
  userId: string;
  role: string;
  responseStatus: string;
  canEdit: boolean;
  notify: boolean;
  user: CalendarUser;
}

export interface CalendarEventRecord {
  id: string;
  calendarId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  color?: string | null;
  recurrenceRule?: string | null;
  recurrenceUntil?: string | null;
  seriesMasterId?: string | null;
  originalStartAt?: string | null;
  isOccurrence?: boolean;
  attachments?: CalendarEventAttachment[];
  calendar: { id: string; name: string; color: string };
  createdBy: CalendarUser;
  attendees: CalendarAttendee[];
  guestEmails?: string[];
  guestPhones?: string[];
  eventType?: CalendarEventType;
  scheduledInvoice?: CalendarScheduledInvoiceSummary | null;
  reminders: Array<{
    id: string;
    userId: string;
    offsetMinutes: number;
    channel: string;
    fireAt: string;
    status: string;
  }>;
}

export interface CalendarReminderItem {
  id: string;
  offsetMinutes: number;
  channel: string;
  fireAt: string;
  status: string;
  event: {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    calendarId: string;
    calendar: { name: string; color: string };
  };
}
