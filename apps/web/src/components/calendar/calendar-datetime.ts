import { formatDateTimeLocal, getZonedParts, parseDateTimeLocal } from '@tvde/shared';

export function toLocalInputValue(
  date: Date,
  allDay: boolean,
  timeZone: string = 'Europe/Lisbon'
) {
  return formatDateTimeLocal(date, timeZone, allDay);
}

export function parseLocalInput(
  value: string,
  allDay: boolean,
  timeZone: string = 'Europe/Lisbon'
): Date {
  return parseDateTimeLocal(value, timeZone, allDay);
}

export function isEndAfterStart(
  start: string,
  end: string,
  allDay: boolean,
  timeZone: string = 'Europe/Lisbon'
): boolean {
  if (!start || !end) return true;
  return parseLocalInput(end, allDay, timeZone) > parseLocalInput(start, allDay, timeZone);
}

/** Fim mínimo válido: +30 min (hora) ou dia seguinte (dia inteiro). */
export function defaultEndAfterStart(
  start: string,
  allDay: boolean,
  timeZone: string = 'Europe/Lisbon'
): string {
  const startD = parseLocalInput(start, allDay, timeZone);
  if (allDay) {
    const next = new Date(startD.getTime() + 24 * 60 * 60 * 1000);
    return toLocalInputValue(next, true, timeZone);
  }
  const end = new Date(startD);
  end.setMinutes(end.getMinutes() + 30);
  return toLocalInputValue(end, false, timeZone);
}

export function coerceEndAfterStart(
  start: string,
  end: string,
  allDay: boolean,
  timeZone: string = 'Europe/Lisbon'
): string {
  if (!start) return end;
  if (!end || !isEndAfterStart(start, end, allDay, timeZone)) {
    return defaultEndAfterStart(start, allDay, timeZone);
  }
  return end;
}

export function convertRangeForAllDay(
  start: string,
  end: string,
  allDay: boolean,
  timeZone: string = 'Europe/Lisbon'
): { start: string; end: string } {
  if (!start) return { start, end };

  if (allDay) {
    const startDate = start.includes('T') ? start.slice(0, 10) : start;
    let endDate = end.includes('T') ? end.slice(0, 10) : end;
    if (!endDate || !isEndAfterStart(startDate, endDate, true, timeZone)) {
      endDate = defaultEndAfterStart(startDate, true, timeZone);
    }
    return { start: startDate, end: endDate };
  }

  const startDt = start.includes('T') ? start : `${start}T09:00`;
  let endDt = end.includes('T') ? end : `${end || start}T10:00`;
  endDt = coerceEndAfterStart(startDt, endDt, false, timeZone);
  return { start: startDt, end: endDt };
}

/** Arredonda para o próximo slot (ex. 15 min) no fuso do calendário. */
export function roundUpToSlot(
  date: Date,
  slotMinutes: number,
  timeZone: string = 'Europe/Lisbon'
): Date {
  const p = getZonedParts(date, timeZone);
  let totalMinutes = p.hour * 60 + p.minute;
  const remainder = totalMinutes % slotMinutes;
  if (remainder !== 0) {
    totalMinutes += slotMinutes - remainder;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const value = `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(hour)}:${pad(minute)}`;
  return parseDateTimeLocal(value, timeZone, false);
}

/** Intervalo por defeito para novo evento: agora (arredondado) + 30 min. */
export function buildDefaultEventRange(
  timeZone: string = 'Europe/Lisbon',
  allDay = false
): { start: Date; end: Date; allDay: boolean } {
  const now = new Date();
  if (allDay) {
    const today = formatDateTimeLocal(now, timeZone, true);
    const start = parseDateTimeLocal(today, timeZone, true);
    const end = parseDateTimeLocal(defaultEndAfterStart(today, true, timeZone), timeZone, true);
    return { start, end, allDay: true };
  }
  const start = roundUpToSlot(now, 15, timeZone);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { start, end, allDay: false };
}

/** Garante que a selecção na grelha não fica no passado. */
export function normalizeCalendarSelection(
  start: Date,
  end: Date,
  allDay: boolean,
  timeZone: string = 'Europe/Lisbon'
): { start: Date; end: Date; allDay: boolean } {
  const now = new Date();

  if (allDay) {
    const today = formatDateTimeLocal(now, timeZone, true);
    const startDay = formatDateTimeLocal(start, timeZone, true);
    if (startDay >= today) return { start, end, allDay };
    const clampedStart = parseDateTimeLocal(today, timeZone, true);
    const clampedEnd = parseDateTimeLocal(
      defaultEndAfterStart(today, true, timeZone),
      timeZone,
      true
    );
    return { start: clampedStart, end: clampedEnd, allDay: true };
  }

  let nextStart = start < now ? roundUpToSlot(now, 15, timeZone) : roundUpToSlot(start, 15, timeZone);
  let nextEnd = end > nextStart ? end : new Date(nextStart.getTime() + 30 * 60 * 1000);
  if (nextEnd <= nextStart) {
    nextEnd = new Date(nextStart.getTime() + 30 * 60 * 1000);
  }
  return { start: nextStart, end: nextEnd, allDay: false };
}
