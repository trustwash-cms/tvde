'use client';

import { currentYearMonthOptions } from '@tvde/shared';

export function MonthTotalCard({
  label = 'Valor deste mês',
  value,
  monthKey,
  onMonthChange,
  selectId = 'month-total-select',
}: {
  label?: string;
  value: string;
  monthKey: string;
  onMonthChange: (monthKey: string) => void;
  selectId?: string;
}) {
  const options = currentYearMonthOptions();

  return (
    <div className="card relative">
      <div className="absolute right-3 top-3">
        <label className="sr-only" htmlFor={selectId}>
          Mês
        </label>
        <select
          id={selectId}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600 shadow-sm"
          value={monthKey}
          onChange={(event) => onMonthChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p className="pr-24 text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
