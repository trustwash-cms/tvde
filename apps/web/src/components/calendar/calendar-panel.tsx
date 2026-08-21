'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import {
  WEB_ROUTES,
  canAccessDashboardArea,
  DEFAULT_CALENDAR_TIMEZONE,
  formatDateTimeLocal,
  parseCalendarOccurrenceId,
  type Role,
} from '@tvde/shared';
import ptLocale from '@fullcalendar/core/locales/pt';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import type {
  DateSelectArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { buildCalendarEventContent } from '@/components/calendar/calendar-event-content';
import { getTimeGreeting, greetingFirstName } from '@/components/calendar/calendar-greeting';
import { CalendarScheduledSidebar } from '@/components/calendar/calendar-scheduled-sidebar';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { CalendarEventModal } from '@/components/calendar/calendar-event-modal';
import {
  buildDefaultEventRange,
  normalizeCalendarSelection,
} from '@/components/calendar/calendar-datetime';
import type {
  CalendarEventRecord,
  CalendarRecord,
  CalendarUser,
} from '@/components/calendar/calendar-types';
import './fullcalendar-overrides.css';

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function CalendarPanel() {
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const calendarRef = useRef<FullCalendar>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [calendars, setCalendars] = useState<CalendarRecord[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const [currentUserUsername, setCurrentUserUsername] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<Role | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [gridHeight, setGridHeight] = useState(520);
  const [users, setUsers] = useState<CalendarUser[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const calendarIds = useMemo(() => calendars.map((c) => c.id), [calendars]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEventRecord | null>(null);
  const [selectRange, setSelectRange] = useState<{
    start: Date;
    end: Date;
    allDay: boolean;
  } | null>(null);

  const loadCalendars = useCallback(() => {
    if (!workspaceId) return;
    const token = getStoredToken();
    Promise.all([
      apiFetch<CalendarRecord[]>(
        withWorkspaceQuery(API_PATHS.calendar.calendars, workspaceId),
        {},
        token
      ),
      apiFetch<CalendarUser[]>(
        withWorkspaceQuery(API_PATHS.calendar.shareableUsers, workspaceId),
        {},
        token
      ),
    ]).then(([calRes, userRes]) => {
      if (calRes.data) setCalendars(calRes.data);
      if (userRes.data) setUsers(userRes.data);
    });
  }, [workspaceId]);

  const loadEvents = useCallback(
    (from: Date, to: Date, calendarIdList: string[]) => {
      if (!workspaceId || calendarIdList.length === 0) {
        setEvents([]);
        return;
      }
      setLoading(true);
      const token = getStoredToken();
      const params = new URLSearchParams({
        workspaceId,
        from: from.toISOString(),
        to: to.toISOString(),
      });
      for (const id of calendarIdList) {
        params.append('calendarIds', id);
      }

      apiFetch<CalendarEventRecord[]>(
        `${API_PATHS.calendar.events}?${params.toString()}`,
        {},
        token
      ).then((res) => {
        if (res.data) {
          setEvents(
            res.data.map((ev) => {
              const invoiceUi =
                ev.eventType === 'invoice' && ev.scheduledInvoice
                  ? ev.scheduledInvoice.status
                  : null;
              const classNames: string[] = [];
              if (invoiceUi === 'completed') classNames.push('fc-event--invoice-completed');
              if (invoiceUi === 'failed') classNames.push('fc-event--invoice-failed');
              if (invoiceUi === 'pending' || invoiceUi === 'processing') {
                classNames.push('fc-event--invoice-pending');
              }

              return {
                id: ev.id,
                title: ev.title,
                start: ev.startAt,
                end: ev.endAt,
                allDay: ev.allDay,
                backgroundColor: ev.color ?? ev.calendar.color,
                borderColor: ev.color ?? ev.calendar.color,
                classNames,
                extendedProps: { raw: ev },
              };
            })
          );
        }
        setLoading(false);
      });
    },
    [workspaceId]
  );

  const refreshEvents = useCallback(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    loadEvents(api.view.activeStart, api.view.activeEnd, calendarIds);
  }, [loadEvents, calendarIds]);

  const handleDatesSet = useCallback(
    (arg: { start: Date; end: Date }) => {
      if (calendarIds.length === 0) {
        setEvents([]);
        return;
      }
      loadEvents(arg.start, arg.end, calendarIds);
    },
    [loadEvents, calendarIds]
  );

  useEffect(() => {
    apiFetch<{
      id: string;
      email: string;
      role: Role;
      fullName?: string | null;
      username?: string | null;
    }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.id) setCurrentUserId(res.data.id);
      if (res.data?.email) setCurrentUserEmail(res.data.email);
      if (res.data) {
        setCurrentUserFullName(res.data.fullName ?? null);
        setCurrentUserUsername(res.data.username ?? null);
        setCurrentUserRole(res.data.role);
      }
    });
  }, []);

  useEffect(() => {
    if (workspaceId) loadCalendars();
  }, [workspaceId, loadCalendars]);

  useEffect(() => {
    function updateHeight() {
      if (!gridRef.current) return;
      const top = gridRef.current.getBoundingClientRect().top;
      const sidebarMin = window.innerWidth >= 1024 ? 0 : 280;
      setGridHeight(Math.max(360, window.innerHeight - top - 16 - sidebarMin));
    }
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [workspaceId, calendars.length, error]);

  useEffect(() => {
    refreshEvents();
  }, [calendarIds, refreshEvents]);

  async function patchEventTimes(
    eventId: string,
    start: Date,
    end: Date,
    allDay: boolean
  ) {
    const res = await apiFetch(
      API_PATHS.calendar.eventById(eventId),
      {
        method: 'PATCH',
        body: JSON.stringify({
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          allDay,
        }),
      },
      getStoredToken()
    );
    if (!res.success) {
      setError(getApiErrorMessage(res));
      refreshEvents();
    }
  }

  const defaultTimezone =
    calendars.find((c) => c.isDefault)?.timezone ??
    calendars[0]?.timezone ??
    DEFAULT_CALENDAR_TIMEZONE;

  const scrollTime = useMemo(() => {
    const now = new Date();
    const parts = formatDateTimeLocal(now, defaultTimezone, false).split('T')[1] ?? '08:00';
    const [h, m] = parts.split(':').map(Number);
    const scrollHour = Math.max(6, (h ?? 8) - 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(scrollHour)}:${pad(m ?? 0)}:00`;
  }, [defaultTimezone]);

  function openNewEventNow() {
    const range = buildDefaultEventRange(defaultTimezone, false);
    setEditingEvent(null);
    setSelectRange(range);
    setModalOpen(true);
  }

  function onDateClick(arg: DateClickArg) {
    const day = startOfDay(arg.date);
    setSelectedDate(day);
    calendarRef.current?.getApi()?.gotoDate(day);
  }

  const dayCellClassNames = useCallback(
    (arg: { date: Date }) => (isSameDay(arg.date, selectedDate) ? ['fc-day-selected'] : []),
    [selectedDate]
  );

  function handleSelectedDateChange(date: Date) {
    const day = startOfDay(date);
    setSelectedDate(day);
    calendarRef.current?.getApi()?.gotoDate(day);
  }

  async function openEventById(eventId: string) {
    const masterId = parseCalendarOccurrenceId(eventId)?.masterId ?? eventId;
    setSelectRange(null);
    const res = await apiFetch<CalendarEventRecord>(
      API_PATHS.calendar.eventById(masterId),
      {},
      getStoredToken()
    );
    if (res.data) {
      setEditingEvent(res.data);
      setModalOpen(true);
    } else if (res.error) {
      setError(res.error);
    }
  }

  function onSelect(arg: DateSelectArg) {
    const normalized = normalizeCalendarSelection(
      arg.start,
      arg.end,
      arg.allDay,
      defaultTimezone
    );
    setEditingEvent(null);
    setSelectRange(normalized);
    setModalOpen(true);
  }

  async function onEventClick(arg: EventClickArg) {
    await openEventById(arg.event.id);
  }

  function onEventDrop(arg: EventDropArg) {
    const { event } = arg;
    if (!event.start || !event.end) return;
    if (parseCalendarOccurrenceId(event.id)) {
      arg.revert();
      setError('Ocorrências de eventos recorrentes não podem ser arrastadas. Edite a série no evento.');
      return;
    }
    patchEventTimes(event.id, event.start, event.end, event.allDay);
  }

  function onEventResize(arg: EventResizeDoneArg) {
    const { event } = arg;
    if (!event.start || !event.end) return;
    if (parseCalendarOccurrenceId(event.id)) {
      arg.revert();
      setError('Ocorrências de eventos recorrentes não podem ser redimensionadas. Edite a série no evento.');
      return;
    }
    patchEventTimes(event.id, event.start, event.end, event.allDay);
  }

  const greetingName = greetingFirstName({
    fullName: currentUserFullName,
    username: currentUserUsername,
    email: currentUserEmail,
  });

  return (
    <div className="calendar-page calendar-pro">
      <header className="calendar-pro__header shrink-0">
        <div className="calendar-pro__greeting min-w-0">
          <h1>
            {getTimeGreeting()}, {greetingName}!
          </h1>
          <p>Aqui está a sua agenda.</p>
        </div>
        <div className="calendar-pro__actions">
          <label className="calendar-pro-search">
            <Search size={16} className="shrink-0 text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar eventos…"
              aria-label="Pesquisar eventos"
            />
          </label>
          <WorkspaceSelector
            workspaces={workspaces}
            workspaceId={workspaceId}
            onChange={(id) => {
              setWorkspaceId(id);
              setCalendars([]);
              setEvents([]);
            }}
          />
          {workspaceId && calendars.length > 0 && (
            <button type="button" className="calendar-pro-btn calendar-pro-btn--primary" onClick={openNewEventNow}>
              Novo evento
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="calendar-pro-alert shrink-0">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError('')}>
            Fechar
          </button>
        </div>
      )}

      {!wsLoading && !workspaceId && (
        <div className="calendar-pro-empty shrink-0">Seleccione um workspace.</div>
      )}

      {workspaceId && calendars.length === 0 && (
        <div className="calendar-pro-empty shrink-0">
          {currentUserRole && canAccessDashboardArea(currentUserRole, 'settings') ? (
            <>
              Sem calendários neste workspace.{' '}
              <Link href={WEB_ROUTES.dashboard.settings.calendar}>
                Criar em Configurações → Calendário
              </Link>
            </>
          ) : (
            <>
              Ainda não tem calendário. Se o problema continuar, contacte o gestor da frota.
            </>
          )}
        </div>
      )}

      {workspaceId && calendars.length > 0 && (
        <div className="calendar-pro__main min-h-0 flex-1">
          <div
            ref={gridRef}
            className="calendar-pro__grid calendar-fullpage"
            style={{ minHeight: gridHeight }}
          >
            {loading && <p className="mb-1 text-xs text-slate-500">A actualizar eventos…</p>}
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
              initialView="dayGridMonth"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
              }}
              locale={ptLocale}
              buttonText={{
                today: 'Hoje',
                month: 'Mês',
                week: 'Semana',
                day: 'Dia',
                list: 'Lista',
              }}
              height={gridHeight - (loading ? 24 : 8)}
              eventMinHeight={28}
              slotEventOverlap={false}
              displayEventTime={false}
              eventTimeFormat={{
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }}
              eventContent={buildCalendarEventContent}
              dayCellClassNames={dayCellClassNames}
              selectable
              selectMirror
              editable
              droppable
              dayMaxEvents={3}
              weekends
              allDaySlot
              slotMinTime="06:00:00"
              slotMaxTime="24:00:00"
              scrollTime={scrollTime}
              scrollTimeReset={false}
              selectAllow={(info) => {
                if (info.allDay) {
                  const startDay = formatDateTimeLocal(info.start, defaultTimezone, true);
                  const today = formatDateTimeLocal(new Date(), defaultTimezone, true);
                  return startDay >= today;
                }
                return info.end > new Date();
              }}
              events={events}
              datesSet={handleDatesSet}
              dateClick={onDateClick}
              select={onSelect}
              eventClick={onEventClick}
              eventDrop={onEventDrop}
              eventResize={onEventResize}
              nowIndicator
            />
          </div>

          <CalendarScheduledSidebar
            selectedDate={selectedDate}
            onSelectedDateChange={handleSelectedDateChange}
            events={events}
            searchQuery={searchQuery}
            onEventClick={openEventById}
          />
        </div>
      )}

      <CalendarEventModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingEvent(null);
          setSelectRange(null);
        }}
        calendars={calendars}
        users={users}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        workspaceId={workspaceId}
        event={editingEvent}
        initialRange={selectRange}
        onSaved={refreshEvents}
        onDeleted={refreshEvents}
        panelClassName="calendar-pro-modal"
      />
    </div>
  );
}
