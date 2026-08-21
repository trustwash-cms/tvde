/**
 * Numeração de semanas Mon→Sun para motoristas.
 * Semana 1 do ano Y = a que começa na primeira segunda-feira em ou após 1 Jan Y.
 * Ex. 2026: semana 1 começa 5 Jan; 2027: semana 1 começa 4 Jan.
 */

const MS_DAY = 24 * 60 * 60 * 1000;

function utcDateOnly(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/** Segunda 00:00 UTC do calendário = primeira segunda em/após 1 Jan `year`. */
export function getYearWeekStart(year: number): Date {
  const jan1 = utcDateOnly(year, 0, 1);
  const dow = jan1.getUTCDay(); // Sun=0 … Sat=6
  const add = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  return utcDateOnly(year, 0, 1 + add);
}

/** Número de semanas Mon–Sun no ano (52 ou 53). */
export function getWeeksInYear(year: number): number {
  const a = getYearWeekStart(year).getTime();
  const b = getYearWeekStart(year + 1).getTime();
  return Math.round((b - a) / (7 * MS_DAY));
}

export function getWeekRange(
  year: number,
  week: number
): {
  start: Date;
  end: Date;
  endExclusive: Date;
  year: number;
  week: number;
} {
  const maxWeek = getWeeksInYear(year);
  const w = Math.min(Math.max(1, Math.trunc(week)), maxWeek);
  const start = new Date(getYearWeekStart(year));
  start.setUTCDate(start.getUTCDate() + (w - 1) * 7);
  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 7);
  const end = new Date(endExclusive.getTime() - MS_DAY);
  return { start, end, endExclusive, year, week: w };
}

/**
 * Semana que contém `date` (usa componentes UTC Y-M-D).
 * Datas antes da semana 1 de Y pertencem à última semana de Y−1.
 */
export function getWeekNumber(date: Date): { year: number; week: number } {
  const day = utcDateOnly(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let year = day.getUTCFullYear();
  let week1 = getYearWeekStart(year);

  if (day.getTime() < week1.getTime()) {
    year -= 1;
    week1 = getYearWeekStart(year);
  } else {
    const nextWeek1 = getYearWeekStart(year + 1);
    if (day.getTime() >= nextWeek1.getTime()) {
      year += 1;
      week1 = nextWeek1;
    }
  }

  const week = Math.floor((day.getTime() - week1.getTime()) / (7 * MS_DAY)) + 1;
  return { year, week };
}

export function shiftWeek(
  year: number,
  week: number,
  delta: number
): { year: number; week: number } {
  const { start } = getWeekRange(year, week);
  const moved = new Date(start);
  moved.setUTCDate(moved.getUTCDate() + delta * 7);
  return getWeekNumber(moved);
}

/** Dia civil em Europe/Lisbon como Date UTC à meia-noite (para getWeekNumber). */
export function getLisbonCalendarDate(now: Date = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;

  return utcDateOnly(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

export function getCurrentWeek(now: Date = new Date()): { year: number; week: number } {
  return getWeekNumber(getLisbonCalendarDate(now));
}

export function parseWeekQuery(
  weekYearRaw: string | number | null | undefined,
  weekRaw: string | number | null | undefined,
  now: Date = new Date()
): { year: number; week: number } {
  const current = getCurrentWeek(now);
  const year =
    weekYearRaw != null && String(weekYearRaw).trim() !== ''
      ? Number(weekYearRaw)
      : current.year;
  const week =
    weekRaw != null && String(weekRaw).trim() !== '' ? Number(weekRaw) : current.week;

  if (!Number.isFinite(year) || year < 2000 || year > 2100) return current;
  if (!Number.isFinite(week) || week < 1) return current;

  const maxWeek = getWeeksInYear(year);
  return { year, week: Math.min(Math.trunc(week), maxWeek) };
}

export function formatWeekDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
