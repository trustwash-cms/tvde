'use client';

import { useState, type InputHTMLAttributes } from 'react';

function normalizeDecimal(raw: string): string {
  return raw.trim().replace(',', '.');
}

/** Accept empty / partial drafts like "", "9", "9,", "9.9". */
export function isSoftDecimalDraft(raw: string): boolean {
  return raw === '' || /^-?\d*(?:[.,]\d*)?$/.test(raw);
}

export function parseSoftDecimal(raw: string): number | null {
  const t = normalizeDecimal(raw);
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type SoftDecimalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'onFocus' | 'onBlur' | 'inputMode'
> & {
  value: number;
  onValueChange: (value: number) => void;
  /** Used when the field is left empty on blur. */
  emptyAs?: number;
};

/**
 * Decimal field that keeps a local draft while focused so clearing "0"
 * does not immediately snap back to 0. Commits a number on blur.
 * Uses text + inputMode=decimal (no spinner arrows). Accepts comma or dot.
 */
export function SoftDecimalInput({
  value,
  onValueChange,
  emptyAs = 0,
  min,
  max,
  className,
  disabled,
  onKeyDown,
  ...rest
}: SoftDecimalInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  function clamp(n: number): number {
    let next = n;
    if (min != null && Number.isFinite(Number(min))) next = Math.max(Number(min), next);
    if (max != null && Number.isFinite(Number(max))) next = Math.min(Number(max), next);
    return next;
  }

  function commit(raw: string) {
    const parsed = parseSoftDecimal(raw);
    onValueChange(clamp(parsed == null ? emptyAs : parsed));
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className}
      disabled={disabled}
      value={focused ? draft : String(value)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(String(value));
        e.target.select();
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (!isSoftDecimalDraft(next)) return;
        setDraft(next);
      }}
      onBlur={() => {
        commit(draft);
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(draft);
          setFocused(false);
          (e.target as HTMLInputElement).blur();
        }
        onKeyDown?.(e);
      }}
    />
  );
}
