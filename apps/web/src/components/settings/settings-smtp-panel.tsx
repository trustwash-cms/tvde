'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Role } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { hasActiveModule, type ModuleCapabilities } from '@/lib/module-access';
import { SettingsAlerts } from '@/components/settings/settings-alerts';
import { SettingsBrandingSection } from '@/components/settings/settings-branding-section';

const DEFAULT_FROM_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'CMS';

function formatFromPreview(displayName: string, email: string) {
  const name = displayName.trim() || DEFAULT_FROM_NAME;
  const addr = email.trim() || 'email@dominio.pt';
  const safeName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${safeName}" <${addr}>`;
}

interface SmtpPublic {
  scope: 'platform' | 'tenant';
  configured: boolean;
  usingEnvFallback: boolean;
  usingPlatformFallback?: boolean;
  smtpConfig: {
    id: string;
    host: string;
    port: number;
    username: string;
    fromName: string | null;
    tls: boolean;
    isActive: boolean;
  } | null;
  emailRouting?: {
    defaultCc: string;
    defaultBcc: string;
  };
}

interface EmailTemplate {
  key: string;
  subject: string;
  htmlBody: string;
  variables: string[];
  isDefault?: boolean;
}

const TEMPLATE_LABELS: Record<string, string> = {
  invoice: 'Faturas',
  password_reset: 'Redefinir password',
  carwash_pickup: 'CarModule — levantamento',
  carwash_completion: 'CarModule — conclusão',
  stripe_payment: 'Stripe — link de pagamento',
  tenant_delete_confirmation: 'Eliminar tenant (código)',
  tenant_welcome: 'Novo tenant (credenciais)',
  user_welcome: 'Novo utilizador (credenciais)',
  two_fa_email: 'Código 2FA por email',
  payment_report: 'Pagamentos — relatório motorista',
};

const TEMPLATE_HINTS: Record<string, string> = {
  invoice: 'Emails de faturas Moloni usam agora Configurações → Moloni (marca + SMTP de facturação). Este template do sistema já não é usado nesse fluxo; mantém-se só como legado / fallback documental.',
  password_reset: 'Enviado quando o utilizador pede redefinição de password.',
  carwash_pickup: 'Email de confirmação de levantamento de veículo (CarModule).',
  carwash_completion: 'Email enviado ao cliente quando a folha de obra é concluída (CarModule).',
  stripe_payment: 'Email com botão para pagar via Stripe (links isolados ou gerados na FO).',
  tenant_delete_confirmation: 'Código enviado ao MASTER para confirmar eliminação permanente de um tenant.',
  tenant_welcome: 'Credenciais de primeiro acesso enviadas ao superadmin quando um tenant é criado ou reenviadas pelo MASTER.',
  user_welcome: 'Credenciais enviadas quando um utilizador é criado com password gerada automaticamente.',
  two_fa_email: 'Código de verificação para autenticação de dois fatores por email.',
  payment_report: 'Relatório de pagamento enviado ao motorista (receitas, despesas, resultado). Inclui secção reservada de conta corrente.',
};

const TEMPLATE_MODULE: Record<string, string | undefined> = {
  invoice: 'billing',
  carwash_completion: 'carwash',
  carwash_pickup: 'carwash',
  stripe_payment: 'stripe',
  payment_report: 'pagamentos',
};

export function SettingsSmtpPanel() {
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [capabilities, setCapabilities] = useState<ModuleCapabilities | undefined>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [smtpInfo, setSmtpInfo] = useState<SmtpPublic | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [smtpForm, setSmtpForm] = useState({
    host: '',
    port: '587',
    username: '',
    password: '',
    fromName: '',
    tls: true,
  });
  const [testEmail, setTestEmail] = useState('');
  const [routingForm, setRoutingForm] = useState({ defaultCc: '', defaultBcc: '' });
  const [templateForm, setTemplateForm] = useState({ subject: '', htmlBody: '' });
  const [activeTemplateKey, setActiveTemplateKey] = useState('password_reset');

  function loadTemplates() {
    return apiFetch<EmailTemplate[]>(API_PATHS.emailTemplates.list, {}, getStoredToken()).then((res) => {
      if (res.data) setTemplates(res.data);
    });
  }

  function load() {
    const token = getStoredToken();
    apiFetch<{ role: Role; capabilities?: ModuleCapabilities }>(API_PATHS.auth.me, {}, token).then((res) => {
      if (res.data?.role) {
        setUserRole(res.data.role);
        if (res.data.role === 'master') void loadTemplates();
      }
      if (res.data?.capabilities) setCapabilities(res.data.capabilities);
    });
    apiFetch<SmtpPublic>(API_PATHS.smtp.config, {}, token).then((res) => {
      if (res.data) {
        setSmtpInfo(res.data);
        if (res.data.smtpConfig) {
          setSmtpForm((f) => ({
            ...f,
            host: res.data!.smtpConfig!.host,
            port: String(res.data!.smtpConfig!.port),
            username: res.data!.smtpConfig!.username,
            fromName: res.data!.smtpConfig!.fromName ?? '',
            tls: res.data!.smtpConfig!.tls,
            password: '',
          }));
        }
        if (res.data.emailRouting) {
          setRoutingForm({
            defaultCc: res.data.emailRouting.defaultCc,
            defaultBcc: res.data.emailRouting.defaultBcc,
          });
        }
      } else if (res.error) setError(res.error);
    });
  }

  useEffect(() => {
    load();
  }, []);

  const visibleTemplates = useMemo(
    () =>
      templates.filter((t) => {
        const moduleKey = TEMPLATE_MODULE[t.key];
        if (!moduleKey) return true;
        return hasActiveModule(userRole ?? 'staff', capabilities, moduleKey);
      }),
    [templates, userRole, capabilities]
  );

  const showBillingTemplates = hasActiveModule(userRole ?? 'staff', capabilities, 'billing');

  useEffect(() => {
    if (visibleTemplates.length === 0) return;
    if (!visibleTemplates.some((t) => t.key === activeTemplateKey)) {
      const first = visibleTemplates[0];
      setActiveTemplateKey(first.key);
      setTemplateForm({ subject: first.subject, htmlBody: first.htmlBody });
    }
  }, [visibleTemplates, activeTemplateKey]);

  useEffect(() => {
    const current = visibleTemplates.find((t) => t.key === activeTemplateKey);
    if (current) setTemplateForm({ subject: current.subject, htmlBody: current.htmlBody });
  }, [activeTemplateKey, visibleTemplates]);

  const isMaster = userRole === 'master';
  const isPlatformScope = smtpInfo?.scope === 'platform' || isMaster;
  const scopeLabel = isPlatformScope ? 'plataforma' : 'tenant';

  const previewFromName = smtpForm.fromName.trim() || DEFAULT_FROM_NAME;
  const previewFromEmail = smtpForm.username.trim() || 'email@dominio.pt';
  const previewFromHeader = formatFromPreview(previewFromName, previewFromEmail);

  function smtpStatusLabel() {
    if (!smtpInfo) return '';
    if (smtpInfo.smtpConfig) {
      return isPlatformScope
        ? 'SMTP da plataforma activo (notificações MASTER → tenants)'
        : 'SMTP do tenant activo';
    }
    if (smtpInfo.usingPlatformFallback) return 'A usar SMTP da plataforma';
    if (smtpInfo.usingEnvFallback) return 'A usar SMTP do .env (fallback)';
    return 'SMTP não configurado';
  }

  async function saveSmtp(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const payload: Record<string, unknown> = {
      host: smtpForm.host,
      port: Number(smtpForm.port),
      username: smtpForm.username,
      tls: smtpForm.tls,
      fromName: smtpForm.fromName.trim() || null,
    };
    if (smtpForm.password) payload.password = smtpForm.password;

    const res = await apiFetch(API_PATHS.smtp.config, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Configuração SMTP guardada');
      setSmtpForm((f) => ({ ...f, password: '' }));
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function saveEmailRouting(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(API_PATHS.smtp.emailRouting, {
      method: 'PUT',
      body: JSON.stringify(routingForm),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Cópias automáticas guardadas');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function sendTest(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(API_PATHS.smtp.test, {
      method: 'POST',
      body: JSON.stringify({ to: testEmail }),
    }, getStoredToken());
    setLoading(false);
    if (res.success) setSuccess(res.message ?? 'Email de teste enviado');
    else setError(getApiErrorMessage(res));
  }

  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(API_PATHS.emailTemplates.byKey(activeTemplateKey), {
      method: 'PUT',
      body: JSON.stringify(templateForm),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Template guardado');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  const currentTemplate = visibleTemplates.find((t) => t.key === activeTemplateKey);

  return (
    <div className="space-y-6">
      <SettingsBrandingSection />

      <SettingsAlerts error={error} success={success} onDismissError={() => setError('')} onDismissSuccess={() => setSuccess('')} />

      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">SMTP</h2>
          {smtpInfo && <span className="text-xs text-slate-500">{smtpStatusLabel()}</span>}
        </div>

        <form onSubmit={saveSmtp} className="grid gap-4 md:grid-cols-2">
          <input
            className="input"
            placeholder="Host (smtp.exemplo.com)"
            value={smtpForm.host}
            onChange={(e) => setSmtpForm({ ...smtpForm, host: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder="Porta"
            type="number"
            value={smtpForm.port}
            onChange={(e) => setSmtpForm({ ...smtpForm, port: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder="Utilizador SMTP"
            value={smtpForm.username}
            onChange={(e) => setSmtpForm({ ...smtpForm, username: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder={smtpInfo?.smtpConfig ? 'Nova password (opcional)' : 'Password SMTP'}
            type="password"
            value={smtpForm.password}
            onChange={(e) => setSmtpForm({ ...smtpForm, password: e.target.value })}
            required={!smtpInfo?.smtpConfig}
          />
          <input
            className="input md:col-span-2"
            placeholder={`Nome do remetente (ex.: ARC, ${DEFAULT_FROM_NAME})`}
            value={smtpForm.fromName}
            onChange={(e) => setSmtpForm({ ...smtpForm, fromName: e.target.value })}
            maxLength={120}
          />
          <p className="text-xs text-slate-500 md:col-span-2">
            Nome visível na caixa de entrada do destinatário. Se vazio, usa «{DEFAULT_FROM_NAME}».
            Emails da loja eCommerce usam o título da loja quando definido.
          </p>

          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Pré-visualização na caixa de entrada
            </p>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">{previewFromName}</span>
                <span className="shrink-0 text-xs text-slate-400">agora</span>
              </div>
              <p className="mt-1 text-sm font-medium text-slate-800">
                Teste SMTP — {previewFromName}
              </p>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                Email de teste ({scopeLabel}) enviado com sucesso a partir do {previewFromName}.
              </p>
            </div>
            <p className="mt-2 font-mono text-[11px] text-slate-400">{previewFromHeader}</p>
          </div>

          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={smtpForm.tls}
              onChange={(e) => setSmtpForm({ ...smtpForm, tls: e.target.checked })}
            />
            Usar TLS (STARTTLS na porta 587)
          </label>
          <button type="submit" className="btn-primary md:col-span-2" disabled={loading}>
            Guardar SMTP
          </button>
        </form>

        <form onSubmit={saveEmailRouting} className="space-y-4 border-t border-slate-100 pt-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Cópias automáticas (CC / BCC)</h3>
            <p className="mt-1 text-sm text-slate-500">
              Estes endereços recebem cópia de todos os emails enviados pelo sistema neste âmbito (
              {scopeLabel}
              ): faturas, calendário, redefinição de password, etc.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-600">CC (cópia visível)</label>
              <input
                className="input"
                type="text"
                placeholder="contabilidade@empresa.com, gestor@empresa.com"
                value={routingForm.defaultCc}
                onChange={(e) => setRoutingForm({ ...routingForm, defaultCc: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">BCC (cópia oculta)</label>
              <input
                className="input"
                type="text"
                placeholder="arquivo@empresa.com"
                value={routingForm.defaultBcc}
                onChange={(e) => setRoutingForm({ ...routingForm, defaultBcc: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Separe vários emails com vírgula. Deixe em branco para não enviar cópias automáticas.
          </p>
          <button type="submit" className="btn-secondary" disabled={loading}>
            Guardar CC / BCC
          </button>
        </form>

        <form onSubmit={sendTest} className="flex flex-col gap-3 border-t border-slate-100 pt-4 md:flex-row md:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm text-slate-600">Email de teste</label>
            <input
              className="input"
              type="email"
              placeholder="teste@empresa.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-secondary" disabled={loading}>
            Enviar teste
          </button>
        </form>
      </section>

      {isMaster && (
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Templates de email ({scopeLabel})</h2>
          <p className="mt-1 text-sm text-slate-500">
            {showBillingTemplates
              ? 'Personalize os emails enviados pelo sistema, incluindo faturas. Apenas o MASTER pode editar templates.'
              : 'Personalize os emails enviados pelo sistema. Apenas o MASTER pode editar templates.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {visibleTemplates.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${
                activeTemplateKey === t.key
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
              onClick={() => setActiveTemplateKey(t.key)}
            >
              {TEMPLATE_LABELS[t.key] ?? t.key}
            </button>
          ))}
        </div>

        {currentTemplate && (
          <div className="space-y-1 text-xs text-slate-500">
            {TEMPLATE_HINTS[activeTemplateKey] && <p>{TEMPLATE_HINTS[activeTemplateKey]}</p>}
            <p>
              Variáveis: {currentTemplate.variables.map((v) => `{{${v}}}`).join(', ')}
              {currentTemplate.isDefault ? ' · a usar template por defeito' : ''}
            </p>
          </div>
        )}

        <form onSubmit={saveTemplate} className="space-y-4">
          <input
            className="input"
            placeholder="Assunto"
            value={templateForm.subject}
            onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
            required
          />
          <textarea
            className={`input font-mono text-sm ${
              activeTemplateKey === 'invoice' ? 'min-h-[420px]' : 'min-h-[220px]'
            }`}
            placeholder="HTML do template"
            value={templateForm.htmlBody}
            onChange={(e) => setTemplateForm({ ...templateForm, htmlBody: e.target.value })}
            required
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            Guardar template
          </button>
        </form>
      </section>
      )}
    </div>
  );
}
