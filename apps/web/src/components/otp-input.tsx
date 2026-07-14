'use client';

import { ClipboardEvent, KeyboardEvent, useEffect, useRef } from 'react';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = false,
}: OtpInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const skipInputRef = useRef(false);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) {
      inputsRef.current[0]?.focus();
    }
  }, [autoFocus]);

  function focusAt(index: number) {
    const el = inputsRef.current[Math.max(0, Math.min(index, length - 1))];
    el?.focus();
    el?.select();
  }

  function applyCode(raw: string) {
    const code = raw.replace(/\D/g, '').slice(0, length);
    onChange(code);
    if (code.length === length && /^\d+$/.test(code)) {
      onComplete?.(code);
    }
    focusAt(Math.min(Math.max(code.length - 1, 0), length - 1));
  }

  function updateDigit(index: number, digit: string) {
    const next = [...digits];
    next[index] = digit;
    const code = next.join('').slice(0, length);
    onChange(code);
    if (code.length === length && /^\d+$/.test(code)) {
      onComplete?.(code);
    }
  }

  function handleChange(index: number, raw: string) {
    if (skipInputRef.current) return;

    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly.length > 1) {
      applyCode(digitsOnly);
      return;
    }

    const digit = digitsOnly.slice(-1);
    updateDigit(index, digit);
    if (digit && index < length - 1) focusAt(index + 1);
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        updateDigit(index, '');
      } else if (index > 0) {
        focusAt(index - 1);
      }
      return;
    }

    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusAt(index - 1);
    }

    if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      focusAt(index + 1);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    skipInputRef.current = true;
    applyCode(e.clipboardData.getData('text'));
    window.setTimeout(() => {
      skipInputRef.current = false;
    }, 0);
  }

  return (
    <div className="flex justify-center gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputsRef.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          value={digit}
          disabled={disabled}
          aria-label={`Dígito ${index + 1} de ${length}`}
          className="h-14 w-12 rounded-xl border border-slate-200 bg-white text-center text-xl font-semibold text-slate-900 shadow-sm outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/15 disabled:opacity-50 sm:h-16 sm:w-14 sm:text-2xl"
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
