'use client';

import Link from 'next/link';
import {
  DEFAULT_CALENDAR_TIMEZONE,
  formatTimezoneLabel,
  getRecurrenceLabel,
  WEB_ROUTES,
} from '@tvde/shared';
import { Modal } from '@/components/modal';
import { parseLocation } from '@/components/calendar/calendar-location';
import { LocationMapPreview } from '@/components/calendar/location-map-preview';
import { API_PATHS, getApiUrl, getStoredToken } from '@/lib/api';
import type { CalendarEventAttachment, CalendarEventRecord } from '@/components/calendar/calendar-types';

function formatEventRange(event: CalendarEventRecord): string {
  const tz = event.timezone ?? DEFAULT_CALENDAR_TIMEZONE;
  const dateFmt = new Intl.DateTimeFormat('pt-PT', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat('pt-PT', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  });
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);

  if (event.allDay) {
    const startDate = dateFmt.format(start);
    const endDate = dateFmt.format(end);
    if (startDate === endDate) {
      return `${startDate} · Dia inteiro`;
    }
    return `${startDate} → ${endDate} · Dia inteiro`;
  }

  const sameDay = dateFmt.format(start) === dateFmt.format(end);
  if (sameDay) {
    return `${dateFmt.format(start)}, ${timeFmt.format(start)} → ${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)}, ${timeFmt.format(start)} → ${dateFmt.format(end)}, ${timeFmt.format(end)}`;
}

async function downloadAttachment(eventId: string, attachment: CalendarEventAttachment) {
  const token = getStoredToken();
  const res = await fetch(
    `${getApiUrl()}${API_PATHS.calendar.eventAttachmentDownload(eventId, attachment.id)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function collectGuestLabels(event: CalendarEventRecord): string[] {
  const labels = new Set<string>();
  for (const a of event.attendees) {
    if (a.role !== 'organizer') labels.add(a.user.email);
  }
  for (const e of event.guestEmails ?? []) {
    labels.add(e);
  }
  for (const p of event.guestPhones ?? []) {
    labels.add(p);
  }
  return Array.from(labels);
}

interface CalendarEventPreviewModalProps {
  open: boolean;
  onClose: () => void;
  event: CalendarEventRecord | null;
  loading?: boolean;
}

export function CalendarEventPreviewModal({
  open,
  onClose,
  event,
  loading = false,
}: CalendarEventPreviewModalProps) {
  const parsedLocation = event ? parseLocation(event.location ?? '') : null;
  const guests = event ? collectGuestLabels(event) : [];
  const recurrenceLabel = event ? getRecurrenceLabel(event.recurrenceRule) : null;
  const attachmentEventId = event ? event.seriesMasterId ?? event.id : '';

  const footer = (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary" onClick={onClose}>
        Fechar
      </button>
      {event && (
        <Link href={WEB_ROUTES.dashboard.calendar} className="btn-primary">
          Abrir calendário
        </Link>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Detalhes do compromisso"
      panelClassName="max-w-md"
      scrollBody
      footer={footer}
    >
      {loading ? (
        <p className="text-sm text-slate-400">A carregar…</p>
      ) : !event ? (
        <p className="text-sm text-slate-500">Evento não encontrado.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: event.calendar.color }}
              />
              <span className="text-xs text-slate-500">{event.calendar.name}</span>
            </div>
            <h4 className="text-lg font-semibold text-slate-900">{event.title}</h4>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              Data &amp; hora
            </p>
            <p className="text-sm text-slate-800">{formatEventRange(event)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {formatTimezoneLabel(event.timezone ?? DEFAULT_CALENDAR_TIMEZONE)}
            </p>
            {recurrenceLabel && (
              <p className="mt-1 text-xs text-slate-500">Repetição: {recurrenceLabel}</p>
            )}
          </div>

          {event.location && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Morada
              </p>
              <p className="text-sm text-slate-800">{event.location}</p>
              {parsedLocation?.kind === 'url' && parsedLocation.mapsUrl && (
                <a
                  href={parsedLocation.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs font-medium text-[var(--color-primary)] hover:underline"
                >
                  Abrir videochamada
                </a>
              )}
              {parsedLocation && parsedLocation.kind !== 'url' && (
                <LocationMapPreview location={event.location} />
              )}
            </div>
          )}

          {event.description && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Descrição
              </p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{event.description}</p>
            </div>
          )}

          {guests.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Convidados
              </p>
              <ul className="space-y-1">
                {guests.map((email) => (
                  <li key={email} className="text-sm text-slate-700">
                    {email}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(event.attachments?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Anexos
              </p>
              <ul className="space-y-1">
                {event.attachments!.map((attachment) => (
                  <li key={attachment.id}>
                    <button
                      type="button"
                      className="text-sm text-[var(--color-primary)] hover:underline"
                      onClick={() => void downloadAttachment(attachmentEventId, attachment)}
                    >
                      {attachment.fileName}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
