'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, turnstileSiteKey } from '@/lib/api';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/turnstile-widget';

export default function ForgotPasswordPage() {
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const turnstileEnabled = mounted && Boolean(turnstileSiteKey);

  useEffect(() => {
    setMounted(true);
  }, []);

  function resetTurnstile() {
    if (!turnstileEnabled) return;
    turnstileRef.current?.reset();
    setTurnstileToken(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setResetUrl(null);

    if (turnstileEnabled && !turnstileToken) {
      setError('Complete a verificação captcha');
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch<{ resetUrl?: string }>(API_PATHS.auth.forgotPassword, {
        method: 'POST',
        body: JSON.stringify({
          email,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });

      if (res.success) {
        setMessage(res.message ?? 'Pedido enviado.');
        if (res.data?.resetUrl) setResetUrl(res.data.resetUrl);
        resetTurnstile();
      } else {
        setError(res.error ?? 'Erro ao processar pedido');
        resetTurnstile();
      }
    } catch {
      setError('Erro de ligação ao servidor');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold">Recuperar password</h1>
        <p className="mb-8 text-slate-500">Introduza o email da sua conta</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@empresa.com"
            required
          />

          {turnstileEnabled && (
            <TurnstileWidget
              ref={turnstileRef}
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
            />
          )}

          {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {message && <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>}
          {resetUrl && (
            <div className="rounded-lg bg-slate-100 p-3 text-xs break-all">
              <strong>Dev:</strong>{' '}
              <a href={resetUrl} className="text-[var(--color-primary)] underline">
                Abrir link de reset
              </a>
            </div>
          )}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={loading || (turnstileEnabled && !turnstileToken)}
          >
            {loading ? 'A enviar...' : 'Enviar link'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link href={WEB_ROUTES.login} className="text-[var(--color-primary)] hover:underline">
            Voltar ao login
          </Link>
        </p>
      </div>
    </div>
  );
}
