'use client';

import { FormEvent, useState } from 'react';
import { OtpInput } from './otp-input';

interface TwoFaVerifyPanelProps {
  title?: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (code: string) => void | Promise<void>;
  loading?: boolean;
  error?: string;
  showBackupOption?: boolean;
  submitLabel?: string;
  autoFocus?: boolean;
  autoSubmit?: boolean;
  onResendCode?: () => void | Promise<void>;
  resendLabel?: string;
}

export function TwoFaVerifyPanel({
  title = 'Autenticação de dois factores',
  description = 'Introduza o código de 6 dígitos da sua app autenticadora.',
  value,
  onChange,
  onSubmit,
  loading = false,
  error = '',
  showBackupOption = true,
  submitLabel = 'Confirmar',
  autoFocus = true,
  autoSubmit = true,
  onResendCode,
  resendLabel = 'Reenviar código',
}: TwoFaVerifyPanelProps) {
  const [useBackupCode, setUseBackupCode] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await onSubmit(value.trim());
  }

  return (
    <div className="mx-auto w-full max-w-md text-center">
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-8">
        {!useBackupCode ? (
          <OtpInput
            value={value.slice(0, 6)}
            onChange={onChange}
            onComplete={(code) => {
              if (autoSubmit && !loading) void onSubmit(code);
            }}
            disabled={loading}
            autoFocus={autoFocus}
          />
        ) : (
          <div className="text-left">
            <label className="mb-2 block text-sm font-medium text-slate-700">Código de recuperação</label>
            <input
              className="input font-mono uppercase tracking-wider"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="XXXX-XXXX"
              required
              autoFocus
            />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-left text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={loading || (!useBackupCode ? value.length < 6 : !value.trim())}
        >
          {loading ? 'A verificar...' : submitLabel}
        </button>

        {(onResendCode && !useBackupCode) || showBackupOption ? (
          <div className="flex flex-col items-center gap-3">
            {onResendCode && !useBackupCode && (
              <button
                type="button"
                className="text-sm text-[var(--color-primary)] hover:underline"
                onClick={() => void onResendCode()}
                disabled={loading}
              >
                {resendLabel}
              </button>
            )}

            {showBackupOption && (
              <button
                type="button"
                className="text-sm text-slate-500 hover:text-[var(--color-primary)]"
                onClick={() => {
                  setUseBackupCode((prev) => !prev);
                  onChange('');
                }}
              >
                {useBackupCode ? 'Usar código da app' : 'Usar código de recuperação'}
              </button>
            )}
          </div>
        ) : null}
      </form>
    </div>
  );
}
