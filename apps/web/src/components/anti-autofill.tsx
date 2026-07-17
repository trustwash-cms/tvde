'use client';

import type { InputHTMLAttributes, FocusEvent } from 'react';

/**
 * Absorve autofill do browser / gestores de passwords (Chrome, 1Password, LastPass…).
 * Colocar como primeiros filhos de um <form autoComplete="off">.
 */
export function AutofillDecoys() {
  return (
    <>
      <input
        type="text"
        name="tvde-fake-username"
        autoComplete="username"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        defaultValue=""
      />
      <input
        type="password"
        name="tvde-fake-password"
        autoComplete="current-password"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        defaultValue=""
      />
    </>
  );
}

type AntiAutofillInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Se true, mascara o texto como password sem type=password (menos autofill). */
  maskAsPassword?: boolean;
};

/**
 * Input resistente a autofill: readonly até focus + hints para gestores de passwords.
 */
export function AntiAutofillInput({
  maskAsPassword = false,
  className,
  onFocus,
  type,
  autoComplete,
  ...rest
}: AntiAutofillInputProps) {
  function handleFocus(e: FocusEvent<HTMLInputElement>) {
    e.currentTarget.removeAttribute('readonly');
    onFocus?.(e);
  }

  return (
    <input
      {...rest}
      type={maskAsPassword ? 'text' : type}
      autoComplete={autoComplete ?? 'off'}
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
      data-bwignore
      readOnly
      onFocus={handleFocus}
      className={[
        className,
        maskAsPassword ? '[text-security:disc] [-webkit-text-security:disc]' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
