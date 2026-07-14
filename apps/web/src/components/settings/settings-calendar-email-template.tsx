'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { hasMinRole } from '@tvde/shared';

interface EmailTemplateSettings {
  mode: 'default' | 'custom';
  variables: string[];
  subject: string;
  htmlBody?: string;
}

export function SettingsCalendarEmailTemplate({ userRole }: { userRole: Role | null }) {
  const canEdit = userRole ? hasMinRole(userRole, 'superadmin') : false;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [settings, setSettings] = useState<EmailTemplateSettings | null>(null);
  const [mode, setMode] = useState<'default' | 'custom'>('default');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');

  function load() {
    apiFetch<EmailTemplateSettings>(API_PATHS.calendar.emailTemplate, {}, getStoredToken()).then(
      (res) => {
        if (res.data) {
          setSettings(res.data);
          setMode(res.data.mode);
          setSubject(res.data.subject);
          setHtmlBody(res.data.htmlBody ?? '');
        }
      }
    );
  }

  useEffect(() => {
    load();
  }, []);

  async function saveDefault() {
    setLoading(true);
    setError('');
    setSuccess('');
    const res = await apiFetch(API_PATHS.calendar.emailTemplate, {
      method: 'PUT',
      body: JSON.stringify({ mode: 'default' }),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('A usar template padrão do sistema');
      setMode('default');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setLoading(true);
    setError('');
    setSuccess('');
    const res = await apiFetch(API_PATHS.calendar.emailTemplate, {
      method: 'PUT',
      body: JSON.stringify({ mode: 'custom', subject, htmlBody }),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Template personalizado guardado');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  if (!settings) {
    return <p className="text-sm text-slate-400">A carregar template de email…</p>;
  }

  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-medium text-slate-900">Notificações por email</h3>
        <p className="mt-1 text-sm text-slate-500">
          Email enviado aos participantes quando um evento é criado ou actualizado com notificação
          activa. Requer SMTP configurado.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {success}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            mode === 'default'
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-slate-100 text-slate-700'
          }`}
          disabled={!canEdit || loading}
          onClick={() => {
            if (settings.mode === 'default' && mode === 'default') return;
            setMode('default');
            if (canEdit) saveDefault();
          }}
        >
          Usar padrão
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            mode === 'custom'
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-slate-100 text-slate-700'
          }`}
          disabled={!canEdit}
          onClick={() => setMode('custom')}
        >
          Personalizado
        </button>
      </div>

      {mode === 'default' ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Template padrão activo</p>
          <p className="mt-2">
            Assunto: <span className="font-mono text-xs">{settings.subject}</span>
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Variáveis disponíveis:{' '}
            {settings.variables.map((v) => `{{${v}}}`).join(', ')}
          </p>
          {!canEdit && (
            <p className="mt-2 text-xs text-amber-700">
              Apenas Gestor de Frota pode alterar o template de email.
            </p>
          )}
        </div>
      ) : (
        canEdit && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-xs text-slate-500">
              Variáveis: {settings.variables.map((v) => `{{${v}}}`).join(', ')}
            </p>
            <input
              className="input"
              placeholder="Assunto"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
            <textarea
              className="input min-h-[280px] font-mono text-xs"
              placeholder="HTML do template"
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary" disabled={loading}>
              Guardar template personalizado
            </button>
          </form>
        )
      )}
    </section>
  );
}
