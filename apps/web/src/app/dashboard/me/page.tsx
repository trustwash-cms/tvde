'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  API_PATHS,
  WEB_ROUTES,
  getRoleLabel,
  type Role,
  type UserDocumentItem,
  type UserProfileDetail,
} from '@tvde/shared';
import { Shield, User } from 'lucide-react';
import { UserDocumentsSection } from '@/components/users/user-documents-section';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
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

function userInitials(email: string): string {
  const part = email.split('@')[0] ?? email;
  return part.slice(0, 2).toUpperCase();
}

export default function MePage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<UserProfileDetail | null>(null);
  const [documents, setDocuments] = useState<UserDocumentItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [form, setForm] = useState(emptyProfileForm(null));
  const { alert, alertDialog } = useAlertDialog();

  function loadProfile() {
    setLoading(true);
    apiFetch<UserProfileDetail>(API_PATHS.users.meProfile).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setDetail(res.data);
        setDocuments(res.data.documents);
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const res = await apiFetch<UserProfileDetail>(API_PATHS.users.meProfile, {
      method: 'PATCH',
      body: JSON.stringify(form),
    });

    setSubmitting(false);

    if (res.success && res.data) {
      setDetail(res.data);
      setDocuments(res.data.documents);
      await alert({ title: 'Perfil actualizado', message: 'Os seus dados foram guardados.', variant: 'default' });
      return;
    }

    setError(getApiErrorMessage(res));
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

  return (
    <>
      {alertDialog}
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="mb-2 text-2xl font-bold">Meu Perfil</h1>
          <p className="text-slate-500">Gerir os seus dados pessoais, documentos e sessões activas.</p>
        </div>

        <section className="card flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-xl font-semibold text-[var(--color-primary)]">
            {userInitials(detail.user.email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-slate-900">
              {detail.user.fullName || detail.user.username || detail.user.email}
            </p>
            <p className="text-sm text-slate-500">{detail.user.email}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
              {getRoleLabel(detail.user.role as Role)}
              {detail.user.tenant ? ` · ${detail.user.tenant.siteId}` : ''}
            </p>
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

        <form onSubmit={handleSubmit} className="card space-y-6">
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
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">NIF</label>
              <input className="input" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">CC / Autorização de residência</label>
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
          </div>

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

          <UserDocumentsSection
            userId={detail.user.id}
            documents={documents}
            onDocumentsChange={setDocuments}
            selfMode
          />

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
                    onClick={() => revokeSession(session.id)}
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
