import { RRule } from 'rrule';
import { buildCalendarOccurrenceId } from '@tvde/shared';

type RecurringMaster = {
  id: string;
  startAt: Date;
  endAt: Date;
  recurrenceRule: string;
  recurrenceUntil: Date | null;
};

export function expandRecurringEvent<T extends RecurringMaster>(
  master: T,
  rangeFrom: Date,
  rangeTo: Date
): Array<T & { id: string; startAt: Date; endAt: Date; isOccurrence: true; seriesMasterId: string; originalStartAt: Date }> {
  const durationMs = master.endAt.getTime() - master.startAt.getTime();
  if (durationMs <= 0) return [];

  let rule: RRule;
  try {
    const options = RRule.parseString(master.recurrenceRule);
    rule = new RRule({
      ...options,
      dtstart: master.startAt,
      until: master.recurrenceUntil ?? undefined,
    });
  } catch {
    return [];
  }

  const occurrences = rule.between(rangeFrom, rangeTo, true);
  const expanded: Array<
    T & {
      id: string;
      startAt: Date;
      endAt: Date;
      isOccurrence: true;
      seriesMasterId: string;
      originalStartAt: Date;
    }
  > = [];

  for (const startAt of occurrences) {
    const endAt = new Date(startAt.getTime() + durationMs);
    if (endAt <= rangeFrom || startAt >= rangeTo) continue;

    expanded.push({
      ...master,
      id: buildCalendarOccurrenceId(master.id, startAt),
      startAt,
      endAt,
      isOccurrence: true,
      seriesMasterId: master.id,
      originalStartAt: startAt,
    });
  }

  return expanded;
}
