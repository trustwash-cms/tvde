'use client';

import { FormEvent, useState } from 'react';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
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

    setLoading(true);
    try {
      const res = await apiFetch(API_PATHS.auth.changePassword, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword: password }),
      }, getStoredToken());

      if (res.success) {
        window.location.href = WEB_ROUTES.dashboard.root;
      } else {
        setError(res.error ?? 'Alteração falhou');
      }
    } catch {
      setError('Erro de ligação ao servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="mb-2 text-2xl font-bold">Definir nova password</h1>
      <p className="mb-8 text-slate-500">
        Por segurança, deve alterar a password temporária antes de continuar. Mínimo 12 caracteres com
        maiúscula, minúscula, número e símbolo.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          className="input"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Password actual (temporária)"
          required
          autoComplete="current-password"
        />
        <input
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nova password"
          required
          minLength={12}
          autoComplete="new-password"
        />
        <input
          type="password"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirmar nova password"
          required
          autoComplete="new-password"
        />
        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'A guardar...' : 'Guardar e continuar'}
        </button>
      </form>
    </div>
  );
}
