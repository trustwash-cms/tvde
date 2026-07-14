'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { hasMinRole, WEB_ROUTES, type Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';

interface CalendarScheduledInvoiceSettings {
  enabled: boolean;
  defaultCategoryId: number | null;
  moloniCategories: Array<{ id: number; name: string }>;
  billing: {
    moduleActive: boolean;
    moloniConfigured: boolean;
    moloniConnected: boolean;
    canEnable: boolean;
  };
}

function statusLabel(settings: CalendarScheduledInvoiceSettings): {
  tone: 'ok' | 'warn' | 'error';
  text: string;
} {
  if (!settings.billing.moduleActive) {
    return { tone: 'error', text: 'Módulo Facturação inactivo neste workspace' };
  }
  if (!settings.billing.moloniConnected) {
    return {
      tone: 'warn',
      text: 'Moloni não ligado — configure em Configurações → Moloni',
    };
  }
  return { tone: 'ok', text: 'Moloni operacional para autofaturação' };
}

export function SettingsCalendarScheduledInvoice({
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
  const [settings, setSettings] = useState<CalendarScheduledInvoiceSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [defaultCategoryId, setDefaultCategoryId] = useState<number | ''>('');

  const load = useCallback(() => {
    if (!workspaceId) {
      setSettings(null);
      return;
    }
    apiFetch<CalendarScheduledInvoiceSettings>(
      withWorkspaceQuery(API_PATHS.calendar.scheduledInvoiceSettings, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) {
        setSettings(res.data);
        setEnabled(res.data.enabled);
        setDefaultCategoryId(res.data.defaultCategoryId ?? '');
      }
    });
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveEnabled(nextEnabled: boolean) {
    if (!canEdit || !workspaceId) return;
    setLoading(true);
    setError('');
    setSuccess('');
    const res = await apiFetch(
      API_PATHS.calendar.scheduledInvoiceSettings,
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
          ? 'Autofaturação no calendário activada'
          : 'Autofaturação no calendário desactivada'
      );
      load();
    } else {
      setError(getApiErrorMessage(res));
      load();
    }
  }

  async function saveCategory(nextCategoryId: number | '') {
    if (!canEdit || !workspaceId) return;
    setLoading(true);
    setError('');
    setSuccess('');
    const res = await apiFetch(
      API_PATHS.calendar.scheduledInvoiceSettings,
      {
        method: 'PUT',
        body: JSON.stringify({
          workspaceId,
          defaultCategoryId: nextCategoryId === '' ? null : nextCategoryId,
        }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Categoria predefinida actualizada');
      load();
    } else {
      setError(getApiErrorMessage(res));
      load();
    }
  }

  if (!workspaceId) {
    return (
      <section className="card space-y-3">
        <h3 className="font-medium text-slate-900">Autofaturação no calendário</h3>
        <p className="text-sm text-slate-500">Seleccione um workspace.</p>
      </section>
    );
  }

  if (!settings) {
    return <p className="text-sm text-slate-400">A carregar definições de autofaturação…</p>;
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
        <h3 className="font-medium text-slate-900">Autofaturação no calendário</h3>
        <p className="mt-1 text-sm text-slate-500">
          Permite agendar eventos de fatura no calendário: define cliente, linhas e data de emissão.
          Na hora marcada, o sistema cria e emite a fatura no Moloni, envia email ao cliente e anexa
          o PDF ao evento.
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

      {!settings.billing.moduleActive && (
        <p className="text-xs text-slate-500">
          Active o módulo Facturação em{' '}
          <Link href={WEB_ROUTES.dashboard.settings.workspaces} className="text-[var(--color-primary)] underline">
            Configurações → Workspaces
          </Link>
          .
        </p>
      )}

      {settings.billing.moduleActive && !settings.billing.moloniConnected && (
        <Link href={WEB_ROUTES.dashboard.settings.moloni} className="btn-secondary inline-flex text-sm">
          Configurar Moloni
        </Link>
      )}

      <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled}
          disabled={!canEdit || loading || !settings.billing.canEnable}
          onChange={(e) => {
            const next = e.target.checked;
            setEnabled(next);
            void saveEnabled(next);
          }}
        />
        <span className="text-sm text-slate-700">
          <span className="font-medium">Permitir faturas agendadas no calendário</span>
          <span className="mt-1 block text-xs text-slate-500">
            Novos eventos podem ser do tipo «Fatura agendada» com emissão automática no Moloni.
          </span>
          {!settings.billing.canEnable && (
            <span className="mt-1 block text-xs text-amber-700">
              Ligue o Moloni antes de activar esta opção.
            </span>
          )}
          {!canEdit && (
            <span className="mt-1 block text-xs text-amber-700">
              Apenas Gestor de Frota pode alterar esta definição.
            </span>
          )}
        </span>
      </label>

      {settings.billing.moloniConnected && settings.moloniCategories.length > 0 && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <label className="block text-sm font-medium text-slate-700">
            Categoria Moloni para artigos criados automaticamente
          </label>
          <p className="text-xs text-slate-500">
            Quando uma linha da fatura agendada não tem produto Moloni, o sistema cria o artigo nesta
            categoria. Se não escolher, usa «CMS Autofatura» (criada automaticamente).
          </p>
          <select
            className="input w-full max-w-md"
            value={defaultCategoryId}
            disabled={!canEdit || loading}
            onChange={(e) => {
              const val = e.target.value;
              const next = val === '' ? '' : Number(val);
              setDefaultCategoryId(next);
              void saveCategory(next);
            }}
          >
            <option value="">CMS Autofatura (predefinição)</option>
            {settings.moloniCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}
