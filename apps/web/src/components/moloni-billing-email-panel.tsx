'use client';

import { FormEvent, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';

export type BillingEmailSettingsData = {
  brandName: string | null;
  footerText: string | null;
  supportEmail: string | null;
  smtpConfigured: boolean;
  brandingConfigured: boolean;
  smtp: {
    host: string | null;
    port: number | null;
    username: string | null;
    fromEmail: string | null;
    fromName: string | null;
    tls: boolean;
  } | null;
};

interface MoloniBillingEmailPanelProps {
  workspaceId: string | null;
  companyName?: string | null;
  initial?: BillingEmailSettingsData | null;
  disabled?: boolean;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
  onSaved?: (data: BillingEmailSettingsData) => void;
}

export function MoloniBillingEmailPanel({
  workspaceId,
  companyName,
  initial,
  disabled,
  onSuccess,
  onError,
  onSaved,
}: MoloniBillingEmailPanelProps) {
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({
    brandName: '',
    footerText: '',
    supportEmail: '',
    smtpHost: '',
    smtpPort: '587',
    smtpUsername: '',
    smtpPassword: '',
    smtpFromEmail: '',
    smtpFromName: '',
    smtpTls: true,
  });
  const [smtpConfigured, setSmtpConfigured] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setSmtpConfigured(initial.smtpConfigured);
    setForm({
      brandName: initial.brandName ?? '',
      footerText: initial.footerText ?? '',
      supportEmail: initial.supportEmail ?? '',
      smtpHost: initial.smtp?.host ?? '',
      smtpPort: String(initial.smtp?.port ?? 587),
      smtpUsername: initial.smtp?.username ?? '',
      smtpPassword: '',
      smtpFromEmail: initial.smtp?.fromEmail ?? '',
      smtpFromName: initial.smtp?.fromName ?? '',
      smtpTls: initial.smtp?.tls ?? true,
    });
  }, [initial]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setLoading(true);
    const token = getStoredToken();
    const payload: Record<string, unknown> = {
      workspaceId,
      brandName: form.brandName.trim() || null,
      footerText: form.footerText.trim() || null,
      supportEmail: form.supportEmail.trim() || null,
      smtpHost: form.smtpHost.trim() || null,
      smtpPort: form.smtpHost.trim() ? Number(form.smtpPort) || 587 : null,
      smtpUsername: form.smtpUsername.trim() || null,
      smtpFromEmail: form.smtpFromEmail.trim() || null,
      smtpFromName: form.smtpFromName.trim() || null,
      smtpTls: form.smtpTls,
    };
    if (form.smtpPassword.trim()) payload.smtpPassword = form.smtpPassword.trim();

    const res = await apiFetch<BillingEmailSettingsData>(
      API_PATHS.billing.moloniEmailConfig,
      { method: 'PUT', body: JSON.stringify(payload) },
      token
    );
    setLoading(false);
    if (!res.success || !res.data) {
      onError?.(getApiErrorMessage(res) || 'Falha ao guardar email de facturação');
      return;
    }
    setSmtpConfigured(res.data.smtpConfigured);
    setForm((f) => ({ ...f, smtpPassword: '' }));
    onSaved?.(res.data);
    onSuccess?.('Email de facturação guardado');
  }

  async function sendTest() {
    if (!workspaceId) return;
    const to = form.supportEmail.trim() || form.smtpFromEmail.trim() || form.smtpUsername.trim();
    if (!to || !to.includes('@')) {
      onError?.('Indique um email de suporte ou remetente válido para o teste');
      return;
    }
    setTesting(true);
    const res = await apiFetch(
      API_PATHS.billing.moloniEmailTest,
      { method: 'POST', body: JSON.stringify({ workspaceId, to }) },
      getStoredToken()
    );
    setTesting(false);
    if (!res.success) {
      onError?.(getApiErrorMessage(res) || 'Falha no teste SMTP');
      return;
    }
    onSuccess?.(`Email de teste enviado para ${to}`);
  }

  const brandHint = companyName
    ? `Se vazio, usa o nome da empresa Moloni («${companyName}») e depois o nome do sistema.`
    : 'Se vazio, usa o nome da empresa Moloni (se disponível) e depois o nome do sistema.';

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Email de faturas (Moloni)</h3>
        <p className="mt-1 text-xs text-slate-500">
          Branding e SMTP <strong>próprios da facturação</strong>, separados do SMTP e templates TVDE do
          sistema (Configurações → SMTP). Usado na emissão Moloni e na autofaturação do calendário.
        </p>
      </div>

      {!form.brandName.trim() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Configure o nome da marca no cabeçalho para não aparecer «TVDE» nos emails de faturas.
        </div>
      )}

      <form onSubmit={save} className="grid gap-3 md:grid-cols-2" autoComplete="off">
        <div className="md:col-span-2 space-y-1">
          <label className="block text-xs font-medium text-slate-600">Nome no cabeçalho (marca)</label>
          <input
            className="input"
            placeholder="ex.: projetox"
            value={form.brandName}
            onChange={(e) => setForm({ ...form, brandName: e.target.value })}
            disabled={disabled || !workspaceId}
          />
          <p className="text-xs text-slate-500">{brandHint}</p>
        </div>
        <div className="md:col-span-2 space-y-1">
          <label className="block text-xs font-medium text-slate-600">Texto do rodapé / empresa</label>
          <input
            className="input"
            placeholder="ex.: Fatura123 Unip. LDA"
            value={form.footerText}
            onChange={(e) => setForm({ ...form, footerText: e.target.value })}
            disabled={disabled || !workspaceId}
          />
        </div>
        <div className="md:col-span-2 space-y-1">
          <label className="block text-xs font-medium text-slate-600">Email de suporte (opcional)</label>
          <input
            className="input"
            type="email"
            placeholder="suporte@empresa.pt"
            value={form.supportEmail}
            onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
            disabled={disabled || !workspaceId}
          />
        </div>

        <div className="md:col-span-2 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-700">SMTP de facturação (workspace)</p>
          <p className="mt-1 text-xs text-slate-500">
            Se não configurar, usa o SMTP do sistema como fallback. Recomendado: SMTP da empresa
            emissora.
          </p>
          {smtpConfigured ? (
            <p className="mt-1 text-xs text-emerald-700">SMTP de facturação configurado</p>
          ) : (
            <p className="mt-1 text-xs text-amber-700">SMTP de facturação ainda não configurado</p>
          )}
        </div>

        <input
          className="input"
          placeholder="Host SMTP"
          value={form.smtpHost}
          onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
          disabled={disabled || !workspaceId}
          autoComplete="off"
        />
        <input
          className="input"
          placeholder="Porta"
          value={form.smtpPort}
          onChange={(e) => setForm({ ...form, smtpPort: e.target.value })}
          disabled={disabled || !workspaceId}
          autoComplete="off"
        />
        <input
          className="input"
          placeholder="Utilizador SMTP"
          value={form.smtpUsername}
          onChange={(e) => setForm({ ...form, smtpUsername: e.target.value })}
          disabled={disabled || !workspaceId}
          autoComplete="off"
        />
        <input
          className="input"
          type="password"
          placeholder={smtpConfigured ? 'Nova password (opcional)' : 'Password SMTP'}
          value={form.smtpPassword}
          onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
          disabled={disabled || !workspaceId}
          autoComplete="new-password"
        />
        <input
          className="input"
          type="email"
          placeholder="Email remetente (From)"
          value={form.smtpFromEmail}
          onChange={(e) => setForm({ ...form, smtpFromEmail: e.target.value })}
          disabled={disabled || !workspaceId}
        />
        <input
          className="input"
          placeholder="Nome remetente"
          value={form.smtpFromName}
          onChange={(e) => setForm({ ...form, smtpFromName: e.target.value })}
          disabled={disabled || !workspaceId}
        />
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input
            type="checkbox"
            checked={form.smtpTls}
            onChange={(e) => setForm({ ...form, smtpTls: e.target.checked })}
            disabled={disabled || !workspaceId}
          />
          TLS / STARTTLS
        </label>

        <div className="md:col-span-2 flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || testing || disabled || !workspaceId}
          >
            Guardar email de faturas
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void sendTest()}
            disabled={loading || testing || disabled || !workspaceId || !smtpConfigured}
          >
            Enviar email de teste
          </button>
        </div>
      </form>
    </section>
  );
}
