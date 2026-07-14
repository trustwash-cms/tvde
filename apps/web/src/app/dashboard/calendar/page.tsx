'use client';

import dynamic from 'next/dynamic';

const CalendarPanel = dynamic(() => import('@/components/calendar/calendar-panel'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[50vh] items-center justify-center bg-[#0b0f17] text-sm text-slate-400">
      A carregar calendário…
    </div>
  ),
});

export default function CalendarPage() {
  return (
    <div className="-m-8 flex min-h-[calc(100dvh)] flex-col">
      <CalendarPanel />
    </div>
  );
}
