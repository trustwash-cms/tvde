import type { CalendarEventType } from '@tvde/shared';
import { mergeGuestContactsMetadata } from './calendar-guest-emails';

export function readEventType(metadataJson: unknown): CalendarEventType {
  if (!metadataJson || typeof metadataJson !== 'object' || Array.isArray(metadataJson)) {
    return 'appointment';
  }
  const value = (metadataJson as Record<string, unknown>).eventType;
  return value === 'invoice' ? 'invoice' : 'appointment';
}

export function mergeEventMetadata(
  metadataJson: unknown,
  input: {
    eventType?: CalendarEventType;
    guestEmails?: string[];
    guestPhones?: string[];
  }
) {
  let base = mergeGuestContactsMetadata(metadataJson, {
    ...(input.guestEmails !== undefined ? { guestEmails: input.guestEmails } : {}),
    ...(input.guestPhones !== undefined ? { guestPhones: input.guestPhones } : {}),
  });

  if (input.eventType !== undefined) {
    base = { ...base, eventType: input.eventType };
  }

  return base;
}
