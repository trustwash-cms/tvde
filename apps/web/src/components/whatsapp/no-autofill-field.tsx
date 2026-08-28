'use client';

import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

function unlockOnFocus<T extends HTMLInputElement | HTMLTextAreaElement>(
  e: React.FocusEvent<T>,
  onFocus?: (event: React.FocusEvent<T>) => void
) {
  e.currentTarget.removeAttribute('readonly');
  onFocus?.(e);
}

export function NoAutofillInput({
  className,
  onFocus,
  autoComplete = 'off',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={className}
      autoComplete={autoComplete}
      readOnly
      onFocus={(e) => unlockOnFocus(e, onFocus)}
    />
  );
}

export function NoAutofillSecretInput({
  className,
  onFocus,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type={props.type ?? 'password'}
      className={className}
      autoComplete="new-password"
      readOnly
      onFocus={(e) => unlockOnFocus(e, onFocus)}
    />
  );
}

export function NoAutofillTextarea({
  className,
  onFocus,
  autoComplete = 'off',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={className}
      autoComplete={autoComplete}
      readOnly
      onFocus={(e) => unlockOnFocus(e, onFocus)}
    />
  );
}

/** Campos ocultos para absorver autofill do browser (email/password). */
export function AutofillTrap() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
      <input tabIndex={-1} autoComplete="username" name="_wa_trap_username" defaultValue="" />
      <input tabIndex={-1} autoComplete="current-password" name="_wa_trap_password" type="password" defaultValue="" />
    </div>
  );
}
