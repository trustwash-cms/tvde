'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { DEFAULT_CALENDAR_TIMEZONE, WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { CalendarEventPreviewModal } from '@/components/calendar/calendar-event-preview-modal';
import type { CalendarEventRecord } from '@/components/calendar/calendar-types';

function formatEventTime(event: CalendarEventRecord) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  if (event.allDay) {
    return 'Dia inteiro';
  }
  const startLabel = start.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const endLabel = end.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  return `${startLabel} – ${endLabel}`;
}

export function DashboardRemindersWidget({ moduleActive }: { moduleActive: boolean }) {
  const { workspaceId } = useWorkspaceContext();
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEvent, setPreviewEvent] = useState<CalendarEventRecord | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(() => {
    if (!moduleActive || !workspaceId) return;
    setLoading(true);
    const token = getStoredToken();
    const params = new URLSearchParams({ timezone: DEFAULT_CALENDAR_TIMEZONE });
    apiFetch<CalendarEventRecord[]>(
      `${withWorkspaceQuery(API_PATHS.calendar.eventsToday, workspaceId)}&${params}`,
      {},
      token
    ).then((res) => {
      if (res.data) setEvents(res.data);
      setLoading(false);
    });
  }, [moduleActive, workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function openPreview(eventId: string) {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewEvent(null);

    const res = await apiFetch<CalendarEventRecord>(
      API_PATHS.calendar.eventById(eventId),
      {},
      getStoredToken()
    );

    setPreviewLoading(false);
    if (res.data) {
      setPreviewEvent(res.data);
    }
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewEvent(null);
  }

  if (!moduleActive) return null;

  const todayLabel = new Date().toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <>
      <section className="card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-[var(--color-primary)]" />
            <div>
              <h2 className="font-semibold text-slate-900">Compromissos de hoje</h2>
              <p className="text-xs capitalize text-slate-500">{todayLabel}</p>
            </div>
          </div>
          <Link
            href={WEB_ROUTES.dashboard.calendar}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline"
          >
            Abrir calendário
          </Link>
        </div>

        {!workspaceId ? (
          <p className="text-sm text-slate-500">Seleccione um workspace para ver os compromissos.</p>
        ) : loading ? (
          <p className="text-sm text-slate-400">A carregar…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-slate-500">Sem compromissos agendados para hoje.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => openPreview(event.id)}
                  className="flex w-full items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-left transition hover:border-[var(--color-primary)]/30 hover:bg-[var(--color-primary-light)]/40"
                >
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: event.calendar.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{event.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatEventTime(event)} · {event.calendar.name}
                    </p>
                    {event.location && (
                      <p className="mt-0.5 truncate text-xs text-slate-400">{event.location}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CalendarEventPreviewModal
        open={previewOpen}
        onClose={closePreview}
        event={previewEvent}
        loading={previewLoading}
      />
    </>
  );
}
