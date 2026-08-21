'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export function WeekTotalCard({
  weekNumber,
  weekYear,
  value,
  weekStart,
  weekEnd,
  onPrevWeek,
  onNextWeek,
}: {
  weekNumber: number;
  weekYear?: number;
  value: string;
  weekStart?: string;
  weekEnd?: string;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
}) {
  const rangeLabel =
    weekStart && weekEnd
      ? `${formatPtDate(weekStart)} – ${formatPtDate(weekEnd)}${weekYear ? ` · ${weekYear}` : ''}`
      : weekYear
        ? String(weekYear)
        : null;

  return (
    <div className="card relative">
      {(onPrevWeek || onNextWeek) && (
        <div className="absolute right-3 top-3 flex gap-1">
          <button
            type="button"
            className="rounded border border-slate-200 bg-white p-0.5 text-slate-600 shadow-sm disabled:opacity-40"
            aria-label="Semana anterior"
            onClick={onPrevWeek}
            disabled={!onPrevWeek}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="rounded border border-slate-200 bg-white p-0.5 text-slate-600 shadow-sm disabled:opacity-40"
            aria-label="Semana seguinte"
            onClick={onNextWeek}
            disabled={!onNextWeek}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      <p className="pr-16 text-sm text-slate-500">Semana {weekNumber}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {rangeLabel ? <p className="mt-1 text-xs text-slate-400">{rangeLabel}</p> : null}
    </div>
  );
}

function formatPtDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}
