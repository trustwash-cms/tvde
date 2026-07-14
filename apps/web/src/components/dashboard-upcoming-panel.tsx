'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Clock } from 'lucide-react';
import {
  WEB_ROUTES,
  getAdminMgmtVencimentoHref,
  getAdminMgmtVencimentoOrigemLabel,
  getAdminMgmtVencimentoStatusLabel,
  vencimentoUrgencyClass,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { CalendarEventPreviewModal } from '@/components/calendar/calendar-event-preview-modal';
import type { CalendarEventRecord } from '@/components/calendar/calendar-types';

interface VencimentoItem {
  id: string;
  origemTipo: string;
  descricao: string;
  dataVencimento: string;
  valorAssociado: string | null;
  status: string;
}

function formatEventWhen(event: CalendarEventRecord): string {
  const start = new Date(event.startAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDay = new Date(start);
  eventDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((eventDay.getTime() - today.getTime()) / 86_400_000);

  let dayLabel: string;
  if (dayDiff === 0) dayLabel = 'Hoje';
  else if (dayDiff === 1) dayLabel = 'Amanhã';
  else dayLabel = start.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });

  if (event.allDay) return `${dayLabel} · Dia inteiro`;

  const time = start.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  return `${dayLabel} · ${time}`;
}

export function DashboardUpcomingPanel({
  calendarActive,
  adminMgmtActive,
}: {
  calendarActive: boolean;
  adminMgmtActive: boolean;
}) {
  const { workspaceId } = useWorkspaceContext();
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [vencimentos, setVencimentos] = useState<VencimentoItem[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [loadingVencimentos, setLoadingVencimentos] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEvent, setPreviewEvent] = useState<CalendarEventRecord | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadCalendar = useCallback(() => {
    if (!calendarActive || !workspaceId) return;
    setLoadingCalendar(true);
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 14);

    apiFetch<CalendarEventRecord[]>(
      withWorkspaceQuery(API_PATHS.calendar.events, workspaceId, {
        from: from.toISOString(),
        to: to.toISOString(),
      }),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) {
        const now = Date.now();
        setEvents(
          res.data
            .filter((e) => new Date(e.endAt).getTime() >= now && e.status !== 'cancelled')
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
            .slice(0, 8)
        );
      }
      setLoadingCalendar(false);
    });
  }, [calendarActive, workspaceId]);

  const loadVencimentos = useCallback(() => {
    if (!adminMgmtActive || !workspaceId) return;
    setLoadingVencimentos(true);
    apiFetch<{ upcoming: VencimentoItem[] }>(
      withWorkspaceQuery(API_PATHS.adminMgmt.dashboard, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data?.upcoming) setVencimentos(res.data.upcoming.slice(0, 8));
      setLoadingVencimentos(false);
    });
  }, [adminMgmtActive, workspaceId]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    loadVencimentos();
  }, [loadVencimentos]);

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
    if (res.data) setPreviewEvent(res.data);
  }

  if (!calendarActive && !adminMgmtActive) return null;

  const showCalendar = calendarActive;
  const showVencimentos = adminMgmtActive;
  const gridCols = showCalendar && showVencimentos ? 'md:grid-cols-2' : '';

  return (
    <>
      <section className={`grid gap-3 ${gridCols}`}>
        {showCalendar && (
          <div className="card !p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays size={18} className="text-sky-600" />
                <div>
                  <h2 className="font-semibold text-slate-900">Calendário</h2>
                  <p className="text-xs text-slate-500">Próximos 14 dias</p>
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
              <p className="text-sm text-slate-500">Seleccione um workspace.</p>
            ) : loadingCalendar ? (
              <p className="text-sm text-slate-400">A carregar…</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-slate-500">Sem eventos futuros.</p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => void openPreview(event.id)}
                      className="flex w-full items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2 text-left transition hover:border-[var(--color-primary)]/30 hover:bg-[var(--color-primary-light)]/40"
                    >
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: event.calendar.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{event.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatEventWhen(event)} · {event.calendar.name}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {showVencimentos && (
          <div className="card !p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock size={18} className="text-amber-700" />
                <div>
                  <h2 className="font-semibold text-slate-900">Vencimentos</h2>
                  <p className="text-xs text-slate-500">Gestão administrativa</p>
                </div>
              </div>
              <Link
                href={WEB_ROUTES.dashboard.adminMgmt.root}
                className="text-xs font-medium text-[var(--color-primary)] hover:underline"
              >
                Ver todos
              </Link>
            </div>

            {!workspaceId ? (
              <p className="text-sm text-slate-500">Seleccione um workspace.</p>
            ) : loadingVencimentos ? (
              <p className="text-sm text-slate-400">A carregar…</p>
            ) : vencimentos.length === 0 ? (
              <p className="text-sm text-slate-500">Sem vencimentos pendentes.</p>
            ) : (
              <ul className="space-y-1.5">
                {vencimentos.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={getAdminMgmtVencimentoHref(item.origemTipo)}
                      className={`block rounded-lg border px-2.5 py-2 text-sm transition hover:opacity-90 ${vencimentoUrgencyClass(item.dataVencimento, item.status)}`}
                    >
                      <p className="font-medium">{item.descricao}</p>
                      <p className="mt-0.5 text-xs opacity-80">
                        {getAdminMgmtVencimentoOrigemLabel(item.origemTipo)} ·{' '}
                        {new Date(item.dataVencimento).toLocaleDateString('pt-PT')} ·{' '}
                        {getAdminMgmtVencimentoStatusLabel(item.status)}
                        {item.valorAssociado
                          ? ` · ${Number(item.valorAssociado).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}€`
                          : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <CalendarEventPreviewModal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewEvent(null);
        }}
        event={previewEvent}
        loading={previewLoading}
      />
    </>
  );
}
