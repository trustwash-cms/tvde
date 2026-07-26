'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  API_PATHS,
  WEB_ROUTES,
  getRoleLabel,
  type Role,
  type UserProfileDetail,
} from '@tvde/shared';
import { Camera, Shield, User } from 'lucide-react';
import { apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { useAlertDialog } from '@/hooks/use-alert-dialog';

interface SessionItem {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceInfo: string | null;
  createdAt: string;
  expiresAt: string;
}

function emptyProfileForm(detail: UserProfileDetail | null) {
  return {
    fullName: detail?.user.fullName ?? '',
    nif: detail?.profile?.nif ?? '',
    ccAutorizacaoResidencia: detail?.profile?.ccAutorizacaoResidencia ?? '',
    numeroOperadorTvde: detail?.profile?.numeroOperadorTvde ?? '',
    distrito: detail?.profile?.distrito ?? '',
    concelho: detail?.profile?.concelho ?? '',
    localidade: detail?.profile?.localidade ?? '',
    arruamento: detail?.profile?.arruamento ?? '',
    numeroPorta: detail?.profile?.numeroPorta ?? '',
    codigoPostal: detail?.profile?.codigoPostal ?? '',
  };
}

function userInitials(detail: UserProfileDetail): string {
  const name = detail.user.fullName?.trim() || detail.user.username?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const part = detail.user.email.split('@')[0] ?? detail.user.email;
  return part.slice(0, 2).toUpperCase();
}

export default function MePage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<UserProfileDetail | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [form, setForm] = useState(emptyProfileForm(null));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { alert, alertDialog } = useAlertDialog();

  function loadProfile() {
    setLoading(true);
    apiFetch<UserProfileDetail>(API_PATHS.users.meProfile).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setDetail(res.data);
        setForm(emptyProfileForm(res.data));
        return;
      }
      setError(getApiErrorMessage(res));
    });
  }

  function loadSessions() {
    apiFetch<SessionItem[]>(API_PATHS.auth.sessions).then((res) => {
      if (res.data) setSessions(res.data);
    });
  }

  useEffect(() => {
    loadProfile();
    loadSessions();
  }, []);

  useEffect(() => {
    if (!detail?.user.avatarStorageKey) {
      setAvatarUrl(null);
      return;
    }
    const token = getStoredToken();
    const version = detail.user.avatarUpdatedAt ?? String(Date.now());
    const url = `${getApiUrl()}${API_PATHS.users.meAvatar}?v=${encodeURIComponent(version)}`;
    let objectUrl: string | null = null;
    fetch(url, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setAvatarUrl(objectUrl);
        }
      })
      .catch(() => setAvatarUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [detail?.user.avatarStorageKey, detail?.user.avatarUpdatedAt]);

  async function handleAvatarFile(file: File | null) {
    if (!file) return;
    setAvatarBusy(true);
    const token = getStoredToken();
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch(`${getApiUrl()}${API_PATHS.users.meAvatar}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        await alert({
          title: 'Upload falhou',
          message: json.error || 'Não foi possível actualizar a foto.',
          variant: 'error',
        });
        return;
      }
      loadProfile();
    } finally {
      setAvatarBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemoveAvatar() {
    setAvatarBusy(true);
    try {
      const res = await apiFetch(API_PATHS.users.meAvatar, { method: 'DELETE' });
      if (!res.success) {
        await alert({
          title: 'Remoção falhou',
          message: getApiErrorMessage(res),
          variant: 'error',
        });
        return;
      }
      loadProfile();
    } finally {
      setAvatarBusy(false);
    }
  }

  async function revokeSession(sessionId: string) {
    const res = await apiFetch(API_PATHS.auth.sessionById(sessionId), { method: 'DELETE' });
    if (res.success) {
      loadSessions();
      return;
    }
    await alert({
      title: 'Não foi possível revogar',
      message: getApiErrorMessage(res),
      variant: 'error',
    });
  }

  if (loading) {
    return <p className="text-sm text-slate-500">A carregar perfil…</p>;
  }

  if (!detail) {
    return <p className="text-sm text-red-600">{error || 'Não foi possível carregar o perfil.'}</p>;
  }

  const twoFaEnabled = !!detail.user.twoFaMethod;
  const role = detail.user.role as Role;
  /** NIF / CMTVDE / morada — perfil de motorista (admin), não gestor. */
  const showDriverProfile = role === 'admin';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const body = showDriverProfile ? form : { fullName: form.fullName };

    const res = await apiFetch<UserProfileDetail>(API_PATHS.users.meProfile, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    setSubmitting(false);

    if (res.success && res.data) {
      setDetail(res.data);
      await alert({ title: 'Perfil actualizado', message: 'Os seus dados foram guardados.', variant: 'default' });
      return;
    }

    setError(getApiErrorMessage(res));
  }

  return (
    <>
      {alertDialog}
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="mb-2 text-2xl font-bold">Meu Perfil</h1>
          <p className="text-slate-500">
            {showDriverProfile
              ? 'Gerir os seus dados pessoais e sessões activas.'
              : 'Gerir o seu nome, segurança e sessões activas.'}
          </p>
        </div>

        <section className="card flex flex-wrap items-center gap-4">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Foto de perfil"
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-xl font-semibold text-[var(--color-primary)]">
                {userInitials(detail)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-slate-900">
              {detail.user.fullName || detail.user.username || detail.user.email}
            </p>
            <p className="text-sm text-slate-500">{detail.user.email}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
              {getRoleLabel(role)}
              {detail.user.tenant ? ` · ${detail.user.tenant.siteId}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void handleAvatarFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                disabled={avatarBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera size={14} />
                {avatarBusy ? 'A processar…' : 'Alterar foto'}
              </button>
              {detail.user.avatarStorageKey ? (
                <button
                  type="button"
                  className="btn-secondary text-sm text-red-600"
                  disabled={avatarBusy}
                  onClick={() => void handleRemoveAvatar()}
                >
                  Remover foto
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card space-y-3">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Segurança</h2>
          </div>
          <p className="text-sm text-slate-600">
            Autenticação de dois factores:{' '}
            <span className="font-medium">{twoFaEnabled ? 'Activada' : 'Desactivada'}</span>
          </p>
          <Link href={WEB_ROUTES.dashboard.settings.twoFa} className="btn-secondary inline-flex text-sm">
            Configurar 2FA
          </Link>
          <Link href={WEB_ROUTES.changePassword} className="btn-secondary ml-2 inline-flex text-sm">
            Alterar password
          </Link>
        </section>

        <form onSubmit={(e) => void handleSubmit(e)} className="card space-y-6">
          <div className="flex items-center gap-2">
            <User size={18} className="text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Dados pessoais</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome completo</label>
              <input
                className="input"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </div>
            {showDriverProfile ? (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">NIF</label>
                  <input
                    className="input"
                    value={form.nif}
                    onChange={(e) => setForm({ ...form, nif: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    CC / Autorização de residência
                  </label>
                  <input
                    className="input"
                    value={form.ccAutorizacaoResidencia}
                    onChange={(e) => setForm({ ...form, ccAutorizacaoResidencia: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Certificado CMTVDE</label>
                  <input
                    className="input"
                    value={form.numeroOperadorTvde}
                    onChange={(e) => setForm({ ...form, numeroOperadorTvde: e.target.value })}
                  />
                </div>
              </>
            ) : null}
          </div>

          {showDriverProfile ? (
            <>
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-800">Morada</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Distrito</label>
                    <input
                      className="input"
                      value={form.distrito}
                      onChange={(e) => setForm({ ...form, distrito: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Concelho</label>
                    <input
                      className="input"
                      value={form.concelho}
                      onChange={(e) => setForm({ ...form, concelho: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Localidade</label>
                    <input
                      className="input"
                      value={form.localidade}
                      onChange={(e) => setForm({ ...form, localidade: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Código postal</label>
                    <input
                      className="input"
                      value={form.codigoPostal}
                      onChange={(e) => setForm({ ...form, codigoPostal: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Arruamento</label>
                    <input
                      className="input"
                      value={form.arruamento}
                      onChange={(e) => setForm({ ...form, arruamento: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">N.º porta</label>
                    <input
                      className="input"
                      value={form.numeroPorta}
                      onChange={(e) => setForm({ ...form, numeroPorta: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'A guardar…' : 'Guardar perfil'}
            </button>
          </div>
        </form>

        <section className="card space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Sessões activas</h2>
          {sessions.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma sessão activa.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-slate-800">
                      {session.deviceInfo || session.userAgent || 'Dispositivo desconhecido'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {session.ipAddress ? `IP ${session.ipAddress} · ` : ''}
                      Desde {new Date(session.createdAt).toLocaleString('pt-PT')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => void revokeSession(session.id)}
                  >
                    Revogar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
