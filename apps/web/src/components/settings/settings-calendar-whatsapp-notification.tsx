'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { hasMinRole, WEB_ROUTES, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';

interface CalendarWhatsappSettings {
  enabled: boolean;
  whatsapp: {
    moduleActive: boolean;
    connected: boolean;
    state: string;
    phoneNumber: string | null;
    canEnable: boolean;
  };
}

function statusLabel(settings: CalendarWhatsappSettings): {
  tone: 'ok' | 'warn' | 'error';
  text: string;
} {
  if (!settings.whatsapp.moduleActive) {
    return { tone: 'error', text: 'Módulo WhatsApp inactivo neste workspace' };
  }
  if (!settings.whatsapp.connected) {
    return {
      tone: 'warn',
      text: 'WhatsApp não ligado — escaneie o QR em Configurações → WhatsApp',
    };
  }
  return {
    tone: 'ok',
    text: settings.whatsapp.phoneNumber
      ? `Ligado (+${settings.whatsapp.phoneNumber})`
      : 'WhatsApp operacional',
  };
}

export function SettingsCalendarWhatsappNotification({
  userRole,
  workspaceId,
}: {
  userRole: Role | null;
  workspaceId: string | null;
}) {
  const canEdit = userRole ? hasMinRole(userRole, 'superadmin') : false;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [settings, setSettings] = useState<CalendarWhatsappSettings | null>(null);
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(() => {
    if (!workspaceId) {
      setSettings(null);
      return;
    }
    apiFetch<CalendarWhatsappSettings>(
      withWorkspaceQuery(API_PATHS.calendar.whatsappSettings, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) {
        setSettings(res.data);
        setEnabled(res.data.enabled);
      }
    });
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(nextEnabled: boolean) {
    if (!canEdit || !workspaceId) return;
    setLoading(true);
    setError('');
    setSuccess('');
    const res = await apiFetch(
      API_PATHS.calendar.whatsappSettings,
      {
        method: 'PUT',
        body: JSON.stringify({ workspaceId, enabled: nextEnabled }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setEnabled(nextEnabled);
      setSuccess(
        nextEnabled
          ? 'Notificações por WhatsApp activadas para compromissos'
          : 'Notificações por WhatsApp desactivadas'
      );
      load();
    } else {
      setError(getApiErrorMessage(res));
      load();
    }
  }

  if (!workspaceId) {
    return (
      <section className="card space-y-3">
        <h3 className="font-medium text-slate-900">Notificações por WhatsApp</h3>
        <p className="text-sm text-slate-500">Seleccione um workspace para ver o estado do WhatsApp.</p>
      </section>
    );
  }

  if (!settings) {
    return <p className="text-sm text-slate-400">A carregar definições de WhatsApp…</p>;
  }

  const status = statusLabel(settings);
  const statusClasses = {
    ok: 'border-green-200 bg-green-50 text-green-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-medium text-slate-900">Notificações por WhatsApp</h3>
        <p className="mt-1 text-sm text-slate-500">
          Envia mensagem WhatsApp aos convidados com telefone registado quando um evento é criado ou
          actualizado com notificação activa. Requer módulo WhatsApp activo e sessão ligada.
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

      <div className={`rounded-lg border px-3 py-2 text-sm ${statusClasses[status.tone]}`}>
        {status.text}
      </div>

      {!settings.whatsapp.moduleActive && (
        <p className="text-xs text-slate-500">
          Active o módulo em{' '}
          <Link href={WEB_ROUTES.dashboard.settings.workspaces} className="text-[var(--color-primary)] underline">
            Configurações → Workspaces
          </Link>{' '}
          e autorize-o em Tenants, se necessário.
        </p>
      )}

      {settings.whatsapp.moduleActive && !settings.whatsapp.connected && (
        <Link href={WEB_ROUTES.dashboard.settings.whatsapp} className="btn-secondary inline-flex text-sm">
          Configurar WhatsApp
        </Link>
      )}

      <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled}
          disabled={!canEdit || loading || !settings.whatsapp.canEnable}
          onChange={(e) => {
            const next = e.target.checked;
            setEnabled(next);
            void save(next);
          }}
        />
        <span className="text-sm text-slate-700">
          <span className="font-medium">Notificar compromissos por WhatsApp</span>
          <span className="mt-1 block text-xs text-slate-500">
            Usa o mesmo envio da opção «Enviar notificação aos convidados» no evento.
            Utilizadores do sistema com telefone no perfil ou convidados externos com telefone
            adicionado recebem WhatsApp.
          </span>
          {!settings.whatsapp.canEnable && (
            <span className="mt-1 block text-xs text-amber-700">
              Ligue o WhatsApp antes de activar esta opção.
            </span>
          )}
          {!canEdit && (
            <span className="mt-1 block text-xs text-amber-700">
              Apenas superadmin pode alterar esta definição.
            </span>
          )}
        </span>
      </label>
    </section>
  );
}
