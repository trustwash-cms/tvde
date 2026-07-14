'use client';

import Link from 'next/link';
import { FormEvent, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch } from '@/lib/api';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('As passwords não coincidem');
      return;
    }
    if (!token) {
      setError('Token em falta — use o link recebido por email');
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch(API_PATHS.auth.resetPassword, {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });

      if (res.success) {
        router.push(WEB_ROUTES.login);
      } else {
        setError(res.error ?? 'Reset falhou');
      }
    } catch {
      setError('Erro de ligação ao servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="mb-2 text-2xl font-bold">Nova password</h1>
      <p className="mb-8 text-slate-500">Mínimo 12 caracteres com maiúscula, minúscula, número e símbolo</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nova password"
          required
          minLength={12}
        />
        <input
          type="password"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirmar password"
          required
        />
        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'A guardar...' : 'Definir password'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm">
        <Link href={WEB_ROUTES.login} className="text-[var(--color-primary)] hover:underline">
          Voltar ao login
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Suspense fallback={<div className="text-slate-500">A carregar...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
