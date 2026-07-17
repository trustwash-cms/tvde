export interface UserVehiclePeriodRecord {
  id: string;
  matricula: string;
  dataInicio: Date | string;
  dataFim: Date | string | null;
}

const DAY_MS = 86_400_000;

export function toDateOnlyUtc(value: Date | string): Date {
  const dt = typeof value === 'string' ? new Date(value) : value;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

export function overlapDays(
  startA: Date | string,
  endA: Date | string | null,
  startB: Date | string,
  endB: Date | string | null,
  openEndReference?: Date | string
): number {
  const ref = openEndReference ? toDateOnlyUtc(openEndReference) : toDateOnlyUtc(new Date());
  const aStart = toDateOnlyUtc(startA).getTime();
  const aEnd = (endA ? toDateOnlyUtc(endA) : ref).getTime();
  const bStart = toDateOnlyUtc(startB).getTime();
  const bEnd = (endB ? toDateOnlyUtc(endB) : ref).getTime();

  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);
  if (overlapEnd < overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1;
}

export function isUserVehicleActive(
  dataFim: Date | string | null,
  referenceDate: Date | string = new Date()
): boolean {
  if (!dataFim) return true;
  return toDateOnlyUtc(dataFim).getTime() >= toDateOnlyUtc(referenceDate).getTime();
}

export function pickBestUserVehicleForPeriod<T extends UserVehiclePeriodRecord>(
  records: T[],
  matricula: string,
  periodStart: Date | string,
  periodEnd: Date | string
): T | null {
  const samePlate = records.filter((record) => record.matricula === matricula);
  if (!samePlate.length) return null;

  let best: T | null = null;
  let bestOverlap = -1;

  for (const record of samePlate) {
    const days = overlapDays(record.dataInicio, record.dataFim, periodStart, periodEnd, periodEnd);
    if (days <= 0) continue;

    if (days > bestOverlap) {
      best = record;
      bestOverlap = days;
      continue;
    }

    if (days === bestOverlap && best && record.dataFim && !best.dataFim) {
      best = record;
    }
  }

  return best;
}

export function vehicleLimitUsagePercent(activeCount: number, maxVehicles: number): number {
  if (maxVehicles <= 0) return 100;
  return Math.min(100, Math.round((activeCount / maxVehicles) * 100));
}

export function vehicleLimitAlertLevel(
  usagePercent: number
): 'success' | 'info' | 'warning' | 'danger' {
  if (usagePercent >= 90) return 'danger';
  if (usagePercent >= 75) return 'warning';
  if (usagePercent >= 50) return 'info';
  return 'success';
}
