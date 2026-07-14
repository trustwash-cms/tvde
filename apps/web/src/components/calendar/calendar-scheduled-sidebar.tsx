'use client';

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import type { EventInput } from '@fullcalendar/core';
import type { CalendarEventRecord } from '@/components/calendar/calendar-types';
import { getCalendarInvoiceUi } from '@/components/calendar/calendar-invoice-ui';

interface CalendarScheduledSidebarProps {
  selectedDate: Date;
  onSelectedDateChange: (date: Date) => void;
  events: EventInput[];
  searchQuery: string;
  onEventClick: (eventId: string) => void;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatSidebarDate(date: Date) {
  return date.toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTimeRange(start: Date, end: Date, allDay: boolean) {
  if (allDay) return 'Todo o dia';
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
  return `${start.toLocaleTimeString('pt-PT', opts)} – ${end.toLocaleTimeString('pt-PT', opts)}`;
}

function formatDuration(start: Date, end: Date, allDay: boolean) {
  if (allDay) return 'Dia inteiro';
  const mins = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return h === 1 ? '1 hora' : `${h} horas`;
  return `${h}h ${m}min`;
}

function getEventRecord(ev: EventInput): CalendarEventRecord | null {
  const raw = ev.extendedProps?.raw;
  if (raw && typeof raw === 'object' && 'title' in raw) {
    return raw as CalendarEventRecord;
  }
  return null;
}

function shiftDay(date: Date, delta: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

export function CalendarScheduledSidebar({
  selectedDate,
  onSelectedDateChange,
  events,
  searchQuery,
  onEventClick,
}: CalendarScheduledSidebarProps) {
  const dayEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events
      .filter((ev) => {
        const start = ev.start instanceof Date ? ev.start : ev.start ? new Date(ev.start as string) : null;
        if (!start || !isSameDay(start, selectedDate)) return false;
        if (!q) return true;
        const title = (ev.title ?? '').toLowerCase();
        const raw = getEventRecord(ev);
        const desc = (raw?.description ?? '').toLowerCase();
        return title.includes(q) || desc.includes(q);
      })
      .sort((a, b) => {
        const sa = a.start instanceof Date ? a.start : new Date(a.start as string);
        const sb = b.start instanceof Date ? b.start : new Date(b.start as string);
        return sa.getTime() - sb.getTime();
      });
  }, [events, selectedDate, searchQuery]);

  const isToday = isSameDay(selectedDate, new Date());

  return (
    <aside className="calendar-pro-sidebar flex w-full shrink-0 flex-col lg:max-h-full lg:w-[340px] lg:flex-1 lg:shrink xl:w-[380px] xl:flex-none">
      <div className="calendar-pro-sidebar__header">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">Agenda</h2>
            <p className="mt-0.5 text-xs capitalize text-slate-400">{formatSidebarDate(selectedDate)}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="calendar-pro-icon-btn"
              aria-label="Dia anterior"
              onClick={() => onSelectedDateChange(shiftDay(selectedDate, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            {!isToday && (
              <button
                type="button"
                className="calendar-pro-icon-btn"
                aria-label="Ir para hoje"
                onClick={() => onSelectedDateChange(startOfDay(new Date()))}
              >
                <CalendarDays size={16} />
              </button>
            )}
            <button
              type="button"
              className="calendar-pro-icon-btn"
              aria-label="Dia seguinte"
              onClick={() => onSelectedDateChange(shiftDay(selectedDate, 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="calendar-pro-sidebar__body">
        {dayEvents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700/80 px-4 py-8 text-center text-sm text-slate-500">
            {searchQuery.trim()
              ? 'Nenhum evento corresponde à pesquisa neste dia.'
              : 'Sem eventos agendados para este dia.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {dayEvents.map((ev) => {
              const start = ev.start instanceof Date ? ev.start : new Date(ev.start as string);
              const end =
                ev.end instanceof Date
                  ? ev.end
                  : ev.end
                    ? new Date(ev.end as string)
                    : start;
              const raw = getEventRecord(ev);
              const color = (ev.backgroundColor as string) ?? raw?.color ?? raw?.calendar.color ?? '#534AB7';
              const invoiceUi = getCalendarInvoiceUi(raw);
              const attendees = raw?.attendees ?? [];
              const guestCount = (raw?.guestEmails?.length ?? 0) + (raw?.guestPhones?.length ?? 0);
              const totalPeople = attendees.length + guestCount;

              return (
                <li key={String(ev.id)}>
                  <button
                    type="button"
                    className="calendar-pro-event-card w-full text-left"
                    style={{ ['--event-accent' as string]: color }}
                    onClick={() => ev.id && onEventClick(String(ev.id))}
                  >
                    <div className="calendar-pro-event-card__accent" />
                    <div className="p-4">
                      <p className="text-xs font-medium text-slate-400">
                        {formatTimeRange(start, end, Boolean(ev.allDay))}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-white">{ev.title}</h3>
                      {raw?.description && (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-400">{raw.description}</p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-slate-500">
                          {formatDuration(start, end, Boolean(ev.allDay))}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          {invoiceUi?.completed && invoiceUi.emailSent && (
                            <span className="calendar-pro-invoice-pill calendar-pro-invoice-pill--email">
                              <span className="calendar-pro-invoice-pill__dot" aria-hidden />
                              Email enviado
                            </span>
                          )}
                          {invoiceUi?.completed && !invoiceUi.emailSent && invoiceUi.sendEmail && (
                            <span className="calendar-pro-invoice-pill calendar-pro-invoice-pill--warn">
                              Email pendente
                            </span>
                          )}
                          {invoiceUi?.completed && !invoiceUi.sendEmail && (
                            <span className="calendar-pro-invoice-pill calendar-pro-invoice-pill--done">
                              Concluído
                            </span>
                          )}
                          {invoiceUi?.failed && (
                            <span className="calendar-pro-invoice-pill calendar-pro-invoice-pill--failed">
                              Falhou
                            </span>
                          )}
                          {totalPeople > 0 && (
                            <span className="text-xs text-slate-500">
                              {totalPeople} convidado{totalPeople !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
