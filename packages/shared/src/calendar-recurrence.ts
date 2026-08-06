/** Presets de recorrência expostos na UI (mapeiam para RRULE RFC 5545). */
export type CalendarRecurrencePreset =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly';

export const CALENDAR_RECURRENCE_OPTIONS: Array<{
  value: CalendarRecurrencePreset;
  label: string;
}> = [
  { value: 'none', label: 'Não repetir' },
  { value: 'daily', label: 'Diariamente' },
  { value: 'weekly', label: 'Semanalmente' },
  { value: 'biweekly', label: 'Quinzenalmente' },
  { value: 'monthly', label: 'Mensalmente' },
];

/** Presets permitidos em faturas agendadas (avenças). */
export const CALENDAR_INVOICE_RECURRENCE_OPTIONS: Array<{
  value: Extract<CalendarRecurrencePreset, 'none' | 'monthly'>;
  label: string;
}> = [
  { value: 'none', label: 'Não repetir' },
  { value: 'monthly', label: 'Mensalmente' },
];

const OCCURRENCE_ID_SEP = '__';

export function buildRecurrenceRule(preset: CalendarRecurrencePreset): string | null {
  switch (preset) {
    case 'none':
      return null;
    case 'daily':
      return 'FREQ=DAILY;INTERVAL=1';
    case 'weekly':
      return 'FREQ=WEEKLY;INTERVAL=1';
    case 'biweekly':
      return 'FREQ=WEEKLY;INTERVAL=2';
    case 'monthly':
      return 'FREQ=MONTHLY;INTERVAL=1';
    default:
      return null;
  }
}

export function parseRecurrencePreset(rule: string | null | undefined): CalendarRecurrencePreset {
  if (!rule?.trim()) return 'none';
  const normalized = rule.trim().toUpperCase();
  if (normalized === 'FREQ=DAILY;INTERVAL=1' || normalized === 'FREQ=DAILY') return 'daily';
  if (normalized === 'FREQ=WEEKLY;INTERVAL=1' || normalized === 'FREQ=WEEKLY') return 'weekly';
  if (normalized === 'FREQ=WEEKLY;INTERVAL=2') return 'biweekly';
  if (normalized === 'FREQ=MONTHLY;INTERVAL=1' || normalized === 'FREQ=MONTHLY') return 'monthly';
  return 'none';
}

export function getRecurrenceLabel(rule: string | null | undefined): string | null {
  const preset = parseRecurrencePreset(rule);
  if (preset === 'none') return null;
  return CALENDAR_RECURRENCE_OPTIONS.find((o) => o.value === preset)?.label ?? 'Recorrente';
}

export function buildCalendarOccurrenceId(masterId: string, occurrenceStart: Date): string {
  return `${masterId}${OCCURRENCE_ID_SEP}${occurrenceStart.toISOString()}`;
}

export function parseCalendarOccurrenceId(
  id: string
): { masterId: string; occurrenceStart: Date } | null {
  const sep = id.indexOf(OCCURRENCE_ID_SEP);
  if (sep <= 0) return null;
  const masterId = id.slice(0, sep);
  const occurrenceStart = new Date(id.slice(sep + OCCURRENCE_ID_SEP.length));
  if (Number.isNaN(occurrenceStart.getTime())) return null;
  return { masterId, occurrenceStart };
}
