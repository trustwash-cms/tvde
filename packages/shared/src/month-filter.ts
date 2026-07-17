export const PT_MONTH_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

/** Mês no formato YYYY-MM (1–12). */
export function currentMonthKey(reference = new Date()): string {
  const year = reference.getFullYear();
  const month = String(reference.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function parseMonthKey(value: string | null | undefined, reference = new Date()): {
  year: number;
  month: number;
  key: string;
} {
  const match = value?.trim().match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
      return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
    }
  }

  const key = currentMonthKey(reference);
  return {
    year: reference.getFullYear(),
    month: reference.getMonth() + 1,
    key,
  };
}

/** Intervalo UTC [start, endExclusive) para o mês pedido. */
export function getMonthUtcRange(monthKey: string | null | undefined, reference = new Date()): {
  start: Date;
  endExclusive: Date;
  year: number;
  month: number;
  key: string;
} {
  const { year, month, key } = parseMonthKey(monthKey, reference);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const endExclusive = new Date(Date.UTC(year, month, 1));
  return { start, endExclusive, year, month, key };
}

/** Opções do ano corrente (Jan … mês actual). */
export function currentYearMonthOptions(reference = new Date()): Array<{ value: string; label: string }> {
  const year = reference.getFullYear();
  const maxMonth = reference.getMonth() + 1;
  const options: Array<{ value: string; label: string }> = [];
  for (let month = 1; month <= maxMonth; month += 1) {
    options.push({
      value: `${year}-${String(month).padStart(2, '0')}`,
      label: PT_MONTH_LABELS[month - 1]!,
    });
  }
  return options;
}
