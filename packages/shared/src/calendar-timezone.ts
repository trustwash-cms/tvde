export const CALENDAR_TIMEZONE_OPTIONS = [
  { value: 'Europe/Lisbon', label: 'Lisboa (WET/WEST)' },
  { value: 'Atlantic/Azores', label: 'Açores (AZOT/AZOST)' },
  { value: 'Atlantic/Madeira', label: 'Madeira (WET/WEST)' },
  { value: 'Europe/London', label: 'Londres (GMT/BST)' },
  { value: 'Europe/Madrid', label: 'Madrid (CET/CEST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlim (CET/CEST)' },
  { value: 'UTC', label: 'UTC' },
] as const;

export const DEFAULT_CALENDAR_TIMEZONE = 'Europe/Lisbon';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPart['type']) =>
    parts.find((p) => p.type === type)?.value ?? '0';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
  };
}

export function formatDateTimeLocal(date: Date, timeZone: string, allDay: boolean): string {
  const p = getZonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (allDay) return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function parseDateTimeLocal(value: string, timeZone: string, allDay: boolean): Date {
  if (allDay) {
    return parseDateTimeLocal(`${value}T00:00`, timeZone, false);
  }
  const [datePart, timePart = '00:00'] = value.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);

  let utc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);

  for (let i = 0; i < 6; i++) {
    const p = getZonedParts(new Date(utc), timeZone);
    const diffMinutes =
      (y - p.year) * 525600 +
      (mo - p.month) * 43200 +
      (d - p.day) * 1440 +
      (h - p.hour) * 60 +
      (mi - p.minute);
    if (diffMinutes === 0) return new Date(utc);
    utc += diffMinutes * 60 * 1000;
  }

  return new Date(utc);
}

export function minStartDateTimeLocal(timeZone: string, allDay: boolean): string {
  return formatDateTimeLocal(new Date(), timeZone, allDay);
}

export function isStartInPast(value: string, timeZone: string, allDay: boolean): boolean {
  const start = parseDateTimeLocal(value, timeZone, allDay);
  const now = new Date();
  if (allDay) {
    const s = formatDateTimeLocal(start, timeZone, true);
    const n = formatDateTimeLocal(now, timeZone, true);
    return s < n;
  }
  return start < now;
}

export function formatTimezoneLabel(timeZone: string): string {
  return CALENDAR_TIMEZONE_OPTIONS.find((o) => o.value === timeZone)?.label ?? timeZone;
}

/** Início e fim do dia civil no fuso indicado (fim exclusivo). */
export function getTodayRangeInTimezone(timeZone: string): { from: Date; to: Date } {
  const today = formatDateTimeLocal(new Date(), timeZone, true);
  return getBusinessDayRange(today, timeZone);
}

/** Intervalo [início, fim) de um dia civil AAAA-MM-DD no fuso indicado. */
export function getBusinessDayRange(
  dateStr: string,
  timeZone: string = DEFAULT_CALENDAR_TIMEZONE
): { from: Date; to: Date } {
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Data inválida — use AAAA-MM-DD');
  const from = parseDateTimeLocal(`${dateStr}T00:00`, timeZone, false);
  const nextDay = formatDateTimeLocal(
    new Date(from.getTime() + 24 * 60 * 60 * 1000),
    timeZone,
    true
  );
  const to = parseDateTimeLocal(`${nextDay}T00:00`, timeZone, false);
  return { from, to };
}
