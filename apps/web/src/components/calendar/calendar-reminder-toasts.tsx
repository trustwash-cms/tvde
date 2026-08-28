'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, X } from 'lucide-react';
import { WEB_ROUTES, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import type { CalendarReminderItem } from '@/components/calendar/calendar-types';
import { hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';

const POLL_MS = 30_000;

function formatStart(item: CalendarReminderItem) {
  const start = new Date(item.event.startAt);
  if (item.event.allDay) return 'Dia inteiro';
  return start.toLocaleString('pt-PT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CalendarReminderToasts({
  role,
  capabilities,
}: {
  role?: Role | null;
  capabilities?: ModuleCapabilities;
}) {
  const { workspaceId } = useWorkspaceContext();
  const [toasts, setToasts] = useState<CalendarReminderItem[]>([]);
  const acknowledged = useRef(new Set<string>());
  const calendarActive = role ? hasActiveModule(role, capabilities, 'calendar') : false;

  const poll = useCallback(() => {
    if (!calendarActive || !workspaceId) return;
    const token = getStoredToken();
    if (!token) return;

    const qs = new URLSearchParams({ dueOnly: '1', channel: 'in_app', limit: '10' });
    apiFetch<CalendarReminderItem[]>(
      `${withWorkspaceQuery(API_PATHS.calendar.remindersUpcoming, workspaceId)}&${qs}`,
      {},
      token
    ).then((res) => {
      if (!res.data?.length) return;
      const fresh = res.data.filter((r) => !acknowledged.current.has(r.id));
      if (fresh.length === 0) return;

      for (const r of fresh) acknowledged.current.add(r.id);
      setToasts((prev) => {
        const ids = new Set(prev.map((t) => t.id));
        return [...prev, ...fresh.filter((r) => !ids.has(r.id))].slice(-5);
      });
    });
  }, [calendarActive, workspaceId]);

  useEffect(() => {
    poll();
    if (!calendarActive || !workspaceId) return;
    const id = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(id);
  }, [poll, calendarActive, workspaceId]);

  async function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const token = getStoredToken();
    if (token) {
      await apiFetch(API_PATHS.calendar.reminderDismiss(id), { method: 'PATCH' }, token);
    }
  }

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg shadow-slate-900/10"
        >
          <div className="flex items-start gap-2">
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${item.event.calendar.color}22`, color: item.event.calendar.color }}
            >
              <Bell size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Lembrete</p>
              <p className="truncate text-sm font-semibold text-slate-900">{item.event.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatStart(item)} · {item.event.calendar.name}
              </p>
              <Link
                href={WEB_ROUTES.dashboard.calendar}
                className="mt-1.5 inline-block text-xs font-medium text-[var(--color-primary)] hover:underline"
              >
                Abrir calendário
              </Link>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Dispensar lembrete"
              onClick={() => void dismiss(item.id)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
