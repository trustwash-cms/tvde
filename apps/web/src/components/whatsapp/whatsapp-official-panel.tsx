'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  WHATSAPP_BUSINESS_API_VERSIONS,
  WHATSAPP_BUSINESS_EVENT_META,
  WHATSAPP_BUSINESS_LANGUAGE_OPTIONS,
  WHATSAPP_TEMPLATE_CATEGORIES,
  WHATSAPP_TEMPLATE_CATEGORY_LABELS,
  extractWhatsappBodyVariableIndexes,
  parseWhatsappTemplateParameters,
  renderWhatsappTemplatePreview,
  type WhatsappBusinessConfigPublic,
  type WhatsappBusinessCreateTemplateResult,
  type WhatsappBusinessNotificationEventConfig,
  type WhatsappBusinessStatusResponse,
  type WhatsappBusinessTemplateSummary,
  type WhatsappProvider,
  type WhatsappTemplateCategory,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { SettingsAlerts } from '@/components/settings/settings-alerts';
import { RefreshCw, Send, CheckCircle2, Bell, MessageSquare, FileText, ChevronDown, Plus, Trash2 } from 'lucide-react';
import {
  AutofillTrap,
  NoAutofillInput,
  NoAutofillSecretInput,
  NoAutofillTextarea,
} from '@/components/whatsapp/no-autofill-field';
import { WHATSAPP_PROVIDER_CHANGED_EVENT } from '@/components/whatsapp/whatsapp-settings-shell';

type ResultEntry = {
  id: string;
  tone: 'ok' | 'error';
  message: string;
  at: string;
};

function SectionCard({
  title,
  icon,
  children,
  tone = 'default',
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'green' | 'blue';
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headerClass =
    tone === 'green'
      ? 'bg-emerald-700 text-white'
      : tone === 'blue'
        ? 'bg-sky-600 text-white'
        : 'bg-slate-800 text-white';

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold ${headerClass}`}
      >
        {icon}
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? <div className="space-y-4 p-4">{children}</div> : null}
    </section>
  );
}

export function WhatsappOfficialPanel() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<WhatsappBusinessConfigPublic | null>(null);
  const [status, setStatus] = useState<WhatsappBusinessStatusResponse | null>(null);
  const [templates, setTemplates] = useState<WhatsappBusinessTemplateSummary[]>([]);
  const [managedTemplates, setManagedTemplates] = useState<WhatsappBusinessTemplateSummary[]>([]);
  const [events, setEvents] = useState<WhatsappBusinessNotificationEventConfig[]>([]);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [activeProvider, setActiveProvider] = useState<WhatsappProvider>('generic');

  const [configForm, setConfigForm] = useState({
    accessToken: '',
    phoneNumberId: '',
    businessAccountId: '',
    apiVersion: 'v18.0',
    portalPublicUrl: '',
    enabled: true,
    testMode: false,
  });

  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('');

  const [templatePhone, setTemplatePhone] = useState('');
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
  const [templateParams, setTemplateParams] = useState('');
  const [templateLanguage, setTemplateLanguage] = useState('pt_PT');
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');

  const [createForm, setCreateForm] = useState({
    name: '',
    language: 'pt_PT',
    category: 'UTILITY' as WhatsappTemplateCategory,
    bodyText: '',
    bodyExamples: '',
    headerText: '',
    footerText: '',
    buttonText: 'Minha Conta',
    buttonUrl: 'https://fleet.tvde.one/login',
  });

  const createVariableIndexes = useMemo(
    () => extractWhatsappBodyVariableIndexes(createForm.bodyText),
    [createForm.bodyText]
  );

  const pushResult = useCallback((tone: 'ok' | 'error', message: string) => {
    setResults((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        tone,
        message,
        at: new Date().toLocaleString('pt-PT'),
      },
      ...prev.slice(0, 19),
    ]);
  }, []);

  const loadConfig = useCallback(() => {
    apiFetch<WhatsappBusinessConfigPublic>(API_PATHS.whatsappBusiness.config, {}, getStoredToken()).then(
      (res) => {
        if (!res.data) return;
        setConfig(res.data);
        setConfigForm({
          accessToken: '',
          phoneNumberId: res.data.phoneNumberId ?? '',
          businessAccountId: res.data.businessAccountId ?? '',
          apiVersion: res.data.apiVersion || 'v18.0',
          portalPublicUrl:
            res.data.portalPublicUrl ?? res.data.defaultPortalPublicUrl ?? 'https://fleet.tvde.one',
          enabled: res.data.enabled,
          testMode: res.data.testMode,
        });
        const portal =
          res.data.portalPublicUrl ?? res.data.defaultPortalPublicUrl ?? 'https://fleet.tvde.one';
        setCreateForm((prev) => ({
          ...prev,
          buttonUrl: prev.buttonUrl || `${portal.replace(/\/$/, '')}/login`,
        }));
      }
    );
  }, []);

  const loadProvider = useCallback(() => {
    apiFetch<{ provider: WhatsappProvider }>(API_PATHS.whatsappBusiness.provider, {}, getStoredToken()).then(
      (res) => {
        if (res.data?.provider) setActiveProvider(res.data.provider);
      }
    );
  }, []);

  const loadEvents = useCallback(() => {
    apiFetch<WhatsappBusinessNotificationEventConfig[]>(
      API_PATHS.whatsappBusiness.notificationEvents,
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setEvents(res.data);
    });
  }, []);

  useEffect(() => {
    loadConfig();
    loadEvents();
    loadProvider();
    void loadTemplates();
  }, [loadConfig, loadEvents, loadProvider]);

  useEffect(() => {
    function onProviderChanged(event: Event) {
      const next = (event as CustomEvent<WhatsappProvider>).detail;
      if (next) setActiveProvider(next);
      else loadProvider();
      loadConfig();
    }
    window.addEventListener(WHATSAPP_PROVIDER_CHANGED_EVENT, onProviderChanged);
    return () => window.removeEventListener(WHATSAPP_PROVIDER_CHANGED_EVENT, onProviderChanged);
  }, [loadConfig, loadProvider]);

  const providerInactive = activeProvider !== 'official';

  const selectedTemplate = useMemo(
    () => templates.find((t) => `${t.name}:${t.language}` === selectedTemplateKey) ?? null,
    [templates, selectedTemplateKey]
  );

  useEffect(() => {
    if (!selectedTemplate) return;
    setTemplateLanguage(selectedTemplate.language);
    apiFetch<{ url: string | null }>(
      `${API_PATHS.whatsappBusiness.templateHeaderUrl}?templateName=${encodeURIComponent(selectedTemplate.name)}&languageCode=${encodeURIComponent(selectedTemplate.language)}`,
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data?.url) setHeaderMediaUrl(res.data.url);
      else setHeaderMediaUrl('');
    });
  }, [selectedTemplate]);

  const preview = useMemo(() => {
    if (!selectedTemplate) return null;
    return renderWhatsappTemplatePreview(
      selectedTemplate,
      parseWhatsappTemplateParameters(templateParams)
    );
  }, [selectedTemplate, templateParams]);

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(API_PATHS.whatsappBusiness.config, {
      method: 'PUT',
      body: JSON.stringify({
        ...configForm,
        businessAccountId: configForm.businessAccountId || null,
        accessToken: configForm.accessToken.trim() || undefined,
        portalPublicUrl: configForm.portalPublicUrl.trim() || null,
      }),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Configurações guardadas');
      pushResult('ok', 'Configurações da API Oficial guardadas');
      loadConfig();
      loadProvider();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function refreshStatus() {
    setLoading(true);
    const res = await apiFetch<WhatsappBusinessStatusResponse>(
      API_PATHS.whatsappBusiness.status,
      {},
      getStoredToken()
    );
    setLoading(false);
    if (res.data) {
      setStatus(res.data);
      pushResult('ok', 'Status da API actualizado');
    } else {
      pushResult('error', getApiErrorMessage(res));
    }
  }

  async function loadTemplates() {
    setLoading(true);
    const res = await apiFetch<WhatsappBusinessTemplateSummary[]>(
      API_PATHS.whatsappBusiness.templates,
      {},
      getStoredToken()
    );
    setLoading(false);
    if (res.data) {
      setTemplates(res.data);
      if (res.data[0]) setSelectedTemplateKey(`${res.data[0].name}:${res.data[0].language}`);
      pushResult('ok', `Carregados ${res.data.length} template(s) aprovado(s)`);
    } else {
      pushResult('error', getApiErrorMessage(res));
    }
  }

  async function loadManagedTemplates() {
    setLoading(true);
    const res = await apiFetch<WhatsappBusinessTemplateSummary[]>(
      API_PATHS.whatsappBusiness.templatesManage,
      {},
      getStoredToken()
    );
    setLoading(false);
    if (res.data) {
      setManagedTemplates(res.data);
      pushResult('ok', `Carregados ${res.data.length} template(s) (todos os estados)`);
    } else {
      pushResult('error', getApiErrorMessage(res));
    }
  }

  async function createTemplate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const examples = parseWhatsappTemplateParameters(createForm.bodyExamples);
    const res = await apiFetch<WhatsappBusinessCreateTemplateResult>(
      API_PATHS.whatsappBusiness.templates,
      {
        method: 'POST',
        body: JSON.stringify({
          name: createForm.name.trim().toLowerCase(),
          language: createForm.language,
          category: createForm.category,
          bodyText: createForm.bodyText.trim(),
          bodyExamples: examples,
          headerText: createForm.headerText.trim() || null,
          footerText: createForm.footerText.trim() || null,
          buttonText: createForm.buttonText.trim() || null,
          buttonUrl: createForm.buttonUrl.trim() || null,
          allowCategoryChange: true,
        }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess(res.message ?? 'Template enviado para revisão');
      pushResult('ok', res.message ?? `Template criado (${res.data?.status ?? 'PENDING'})`);
      void loadManagedTemplates();
      void loadTemplates();
    } else {
      setError(getApiErrorMessage(res));
      pushResult('error', getApiErrorMessage(res));
    }
  }

  async function deleteTemplate(template: WhatsappBusinessTemplateSummary) {
    if (!window.confirm(`Apagar o template «${template.name}» (${template.language}) na Meta?`)) {
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ name: template.name });
    if (template.id) params.set('hsmId', template.id);
    const res = await apiFetch(
      `${API_PATHS.whatsappBusiness.templates}?${params.toString()}`,
      { method: 'DELETE' },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess(res.message ?? 'Template apagado');
      pushResult('ok', res.message ?? `Template «${template.name}» apagado`);
      void loadManagedTemplates();
      void loadTemplates();
    } else {
      setError(getApiErrorMessage(res));
      pushResult('error', getApiErrorMessage(res));
    }
  }

  async function sendTestMessage(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await apiFetch(API_PATHS.whatsappBusiness.sendMessage, {
      method: 'POST',
      body: JSON.stringify({ phone: testPhone, message: testMessage }),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess(res.message ?? 'Mensagem enviada');
      pushResult('ok', res.message ?? 'Mensagem de teste enviada');
    } else {
      setError(getApiErrorMessage(res));
      pushResult('error', getApiErrorMessage(res));
    }
  }

  async function sendTemplate(e: FormEvent) {
    e.preventDefault();
    if (!selectedTemplate) return;
    setLoading(true);
    const parameters = parseWhatsappTemplateParameters(templateParams);
    const res = await apiFetch(API_PATHS.whatsappBusiness.sendTemplate, {
      method: 'POST',
      body: JSON.stringify({
        phone: templatePhone,
        templateName: selectedTemplate.name,
        languageCode: templateLanguage,
        parameters,
        parameterNames:
          selectedTemplate.parameterType === 'named'
            ? selectedTemplate.parameters.filter((p): p is string => typeof p === 'string')
            : undefined,
        headerMediaUrl: headerMediaUrl.trim() || null,
      }),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess(res.message ?? 'Template enviado');
      pushResult('ok', res.message ?? `Template ${selectedTemplate.name} enviado`);
    } else {
      setError(getApiErrorMessage(res));
      pushResult('error', getApiErrorMessage(res));
    }
  }

  async function saveEvent(event: WhatsappBusinessNotificationEventConfig) {
    if (event.whatsappEnabled && !event.whatsappTemplate?.trim()) {
      setError('Seleccione um template WhatsApp aprovado antes de guardar.');
      return;
    }
    const selected = templates.find(
      (t) => t.name === event.whatsappTemplate && t.language === event.whatsappLanguage
    );
    const needsHeader =
      event.whatsappEnabled &&
      ['IMAGE', 'VIDEO', 'DOCUMENT'].includes((selected?.headerFormat ?? '').toUpperCase());
    if (needsHeader && !event.headerMediaUrl?.trim()) {
      setError(
        `O template «${event.whatsappTemplate}» tem cabeçalho ${selected?.headerFormat} — indique a URL da imagem.`
      );
      return;
    }
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.whatsappBusiness.notificationEventByKey(event.eventKey),
      {
        method: 'PUT',
        body: JSON.stringify({
          emailEnabled: event.emailEnabled,
          whatsappEnabled: event.whatsappEnabled,
          whatsappTemplate: event.whatsappTemplate,
          whatsappLanguage: event.whatsappLanguage,
          headerMediaUrl: event.headerMediaUrl?.trim() || null,
        }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Configuração de evento guardada');
      pushResult('ok', `Evento ${WHATSAPP_BUSINESS_EVENT_META[event.eventKey].title} guardado`);
      loadEvents();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  return (
    <div className="space-y-4">
      <SettingsAlerts
        error={error}
        success={success}
        onDismissError={() => setError('')}
        onDismissSuccess={() => setSuccess('')}
      />

      {providerInactive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          A <strong>API Genérica</strong> está activa. Active a <strong>API Oficial</strong> no selector
          acima para configurar ou enviar mensagens por esta via.
        </div>
      )}

      <fieldset disabled={providerInactive || loading} className="space-y-4 disabled:opacity-60">

      <div>
        <h2 className="text-lg font-semibold">WhatsApp Business API</h2>
        <p className="text-sm text-slate-500">
          Integração com a API oficial Meta (Cloud API) — templates aprovados, testes e eventos de
          notificação.
        </p>
      </div>

      <SectionCard title="Configurações da API" icon={<CheckCircle2 className="h-4 w-4" />}>
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            config?.configured
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <p className="font-medium">
            {config?.configured ? 'Credenciais configuradas' : 'Credenciais em falta'}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            <li>Access Token: {config?.accessTokenConfigured ? 'Configurado' : 'Em falta'}</li>
            <li>
              Phone Number ID: {config?.phoneNumberId ? `${config.phoneNumberId.slice(0, 10)}…` : 'Em falta'}
            </li>
            <li>Módulo: {config?.enabled ? 'Activo' : 'Inactivo'}</li>
          </ul>
        </div>

        <form onSubmit={saveConfig} autoComplete="off" className="relative grid gap-4 md:grid-cols-2">
          <AutofillTrap />
          <label className="md:col-span-2 flex flex-col gap-1 text-sm">
            <span className="font-medium">Access Token *</span>
            <NoAutofillSecretInput
              className="input"
              name="wa_meta_access_token"
              placeholder={
                config?.accessTokenConfigured
                  ? `Actual: ${config.accessTokenPreview} (deixe vazio para manter)`
                  : 'Token da API Meta'
              }
              value={configForm.accessToken}
              onChange={(e) => setConfigForm({ ...configForm, accessToken: e.target.value })}
            />
            <span className="text-xs text-slate-500">Token de acesso da API do WhatsApp Business</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Phone Number ID *</span>
            <NoAutofillInput
              className="input"
              name="wa_meta_phone_number_id"
              inputMode="numeric"
              pattern="\d*"
              value={configForm.phoneNumberId}
              onChange={(e) => setConfigForm({ ...configForm, phoneNumberId: e.target.value })}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Business Account ID</span>
            <NoAutofillInput
              className="input"
              name="wa_meta_business_account_id"
              inputMode="numeric"
              pattern="\d*"
              value={configForm.businessAccountId}
              onChange={(e) => setConfigForm({ ...configForm, businessAccountId: e.target.value })}
            />
            <span className="text-xs text-slate-500">Necessário para listar templates aprovados</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">API Version</span>
            <select
              className="input"
              name="wa_meta_api_version"
              autoComplete="off"
              value={configForm.apiVersion}
              onChange={(e) => setConfigForm({ ...configForm, apiVersion: e.target.value })}
            >
              {WHATSAPP_BUSINESS_API_VERSIONS.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
          </label>
          <label className="md:col-span-2 flex flex-col gap-1 text-sm">
            <span className="font-medium">URL do portal (botões «Minha Conta»)</span>
            <NoAutofillInput
              className="input"
              name="wa_meta_portal_public_url"
              placeholder="https://fleet.tvde.one"
              value={configForm.portalPublicUrl}
              onChange={(e) => setConfigForm({ ...configForm, portalPublicUrl: e.target.value })}
            />
            
          </label>
          <div className="flex flex-wrap items-center gap-6 md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={configForm.enabled}
                onChange={(e) => setConfigForm({ ...configForm, enabled: e.target.checked })}
              />
              Módulo activo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={configForm.testMode}
                onChange={(e) => setConfigForm({ ...configForm, testMode: e.target.checked })}
              />
              Modo de teste (não envia mensagens reais)
            </label>
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button type="submit" className="btn-primary" disabled={loading}>
              Guardar configurações
            </button>
            <button type="button" className="btn-secondary" disabled={loading} onClick={loadConfig}>
              Carregar configurações
            </button>
          </div>
        </form>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Enviar Mensagem de Teste" icon={<Send className="h-4 w-4" />} tone="green">
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-950">
            <p className="font-medium">Importante sobre entrega de mensagens:</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Mensagens de texto livre só dentro da janela de 24 horas.</li>
              <li>Em modo desenvolvimento, o destino deve estar na lista de teste do Meta.</li>
              <li>A API pode responder sucesso mesmo sem entrega imediata.</li>
            </ul>
          </div>
          <form onSubmit={sendTestMessage} autoComplete="off" className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Número de telefone *</span>
              <NoAutofillInput
                className="input"
                name="wa_test_phone"
                autoComplete="tel"
                placeholder="+351912345678"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Mensagem *</span>
              <NoAutofillTextarea
                className="input min-h-[120px]"
                name="wa_test_message"
                placeholder="Digite a mensagem de teste…"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                required
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary bg-emerald-700 hover:bg-emerald-800" disabled={loading}>
                Enviar mensagem
              </button>
              <button type="button" className="btn-secondary" disabled={loading} onClick={refreshStatus}>
                Verificar status da API
              </button>
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Informações" icon={<MessageSquare className="h-4 w-4" />} tone="blue">
          {!status ? (
            <p className="text-sm text-slate-500">
              Clique em &quot;Verificar status da API&quot; para ver as informações de configuração.
            </p>
          ) : status.accountStatus ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-medium text-emerald-800">
                API conectada
              </div>
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-slate-500">Nome verificado</dt>
                  <dd>{status.accountStatus.verifiedName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Número</dt>
                  <dd>{status.accountStatus.displayPhoneNumber ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Estado de verificação</dt>
                  <dd>{status.accountStatus.verificationStatus ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Qualidade</dt>
                  <dd>{status.accountStatus.qualityRating ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Plataforma</dt>
                  <dd>{status.accountStatus.platformType ?? '—'}</dd>
                </div>
              </dl>
              {status.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800">
                  {status.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <ul className="list-disc space-y-1 pl-4 text-sm text-amber-800">
              {status.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Criar / Gerir Templates" icon={<Plus className="h-4 w-4" />} tone="blue">
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-950">
          Cria templates simples na Meta (corpo, cabeçalho, rodapé e botão URL). Após criar, o estado
          fica <strong>PENDING</strong> até a Meta aprovar. Só templates <strong>APPROVED</strong> podem
          ser enviados.
        </div>

        <form onSubmit={createTemplate} autoComplete="off" className="grid gap-4 md:grid-cols-2">
          <AutofillTrap />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nome do template *</span>
            <NoAutofillInput
              className="input"
              name="wa_create_template_name"
              placeholder="pagamento_semana"
              value={createForm.name}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                })
              }
              required
            />
            <span className="text-xs text-slate-500">Apenas a-z, 0-9 e underscore</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Idioma *</span>
            <select
              className="input"
              value={createForm.language}
              onChange={(e) => setCreateForm({ ...createForm, language: e.target.value })}
            >
              {WHATSAPP_BUSINESS_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="font-medium">Categoria *</span>
            <select
              className="input"
              value={createForm.category}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  category: e.target.value as WhatsappTemplateCategory,
                })
              }
            >
              {WHATSAPP_TEMPLATE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {WHATSAPP_TEMPLATE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="font-medium">Cabeçalho (opcional)</span>
            <NoAutofillInput
              className="input"
              name="wa_create_header"
              maxLength={60}
              value={createForm.headerText}
              onChange={(e) => setCreateForm({ ...createForm, headerText: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="font-medium">Corpo *</span>
            <NoAutofillTextarea
              className="input min-h-[120px]"
              name="wa_create_body"
              placeholder="Olá {{1}}, o seu pagamento da semana {{2}} está disponível."
              value={createForm.bodyText}
              onChange={(e) => setCreateForm({ ...createForm, bodyText: e.target.value })}
              required
            />
            <span className="text-xs text-slate-500">
              Variáveis numéricas: {'{{1}}'}, {'{{2}}'}, … — máximo 1024 caracteres
            </span>
          </label>
          {createVariableIndexes.length > 0 && (
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="font-medium">
                Exemplos das variáveis ({createVariableIndexes.map((i) => `{{${i}}}`).join(', ')}) *
              </span>
              <NoAutofillInput
                className="input"
                name="wa_create_examples"
                placeholder="João, 12–18 Ago"
                value={createForm.bodyExamples}
                onChange={(e) => setCreateForm({ ...createForm, bodyExamples: e.target.value })}
                required
              />
              <span className="text-xs text-slate-500">
                Separados por vírgula, na mesma ordem das variáveis (obrigatório para a Meta)
              </span>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="font-medium">Rodapé (opcional)</span>
            <NoAutofillInput
              className="input"
              name="wa_create_footer"
              maxLength={60}
              value={createForm.footerText}
              onChange={(e) => setCreateForm({ ...createForm, footerText: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Texto do botão URL</span>
            <NoAutofillInput
              className="input"
              name="wa_create_button_text"
              maxLength={25}
              placeholder="Minha Conta"
              value={createForm.buttonText}
              onChange={(e) => setCreateForm({ ...createForm, buttonText: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">URL do botão</span>
            <NoAutofillInput
              className="input"
              name="wa_create_button_url"
              placeholder="https://fleet.tvde.one/login"
              value={createForm.buttonUrl}
              onChange={(e) => setCreateForm({ ...createForm, buttonUrl: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button type="submit" className="btn-primary" disabled={loading}>
              Enviar para revisão na Meta
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              onClick={() => void loadManagedTemplates()}
            >
              <RefreshCw className="mr-1 inline h-4 w-4" />
              Actualizar lista
            </button>
          </div>
        </form>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">Templates na conta Meta</p>
          {managedTemplates.length === 0 ? (
            <p className="text-sm text-slate-500">
              Ainda sem lista carregada. Clique em «Actualizar lista».
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nome</th>
                    <th className="px-3 py-2">Idioma</th>
                    <th className="px-3 py-2">Categoria</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {managedTemplates.map((template) => (
                    <tr
                      key={`${template.id ?? template.name}:${template.language}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2 font-medium">{template.name}</td>
                      <td className="px-3 py-2">{template.language}</td>
                      <td className="px-3 py-2">{template.category}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            template.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : template.status === 'PENDING'
                                ? 'bg-amber-100 text-amber-800'
                                : template.status === 'REJECTED'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {template.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                          disabled={loading}
                          onClick={() => void deleteTemplate(template)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Apagar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Enviar Template Aprovado" icon={<FileText className="h-4 w-4" />} tone="blue">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          <p className="font-medium">Sobre templates:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Permitem contactar números fora da janela de 24 horas.</li>
            <li>Devem estar aprovados no Meta Business Manager.</li>
            <li>Parâmetros separados por vírgula (ex: valor1, valor2).</li>
          </ul>
        </div>

        <form onSubmit={sendTemplate} autoComplete="off" className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Número de telefone *</span>
            <NoAutofillInput
              className="input"
              name="wa_template_phone"
              autoComplete="tel"
              value={templatePhone}
              onChange={(e) => setTemplatePhone(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Template *</span>
            <div className="flex gap-2">
              <select
                className="input flex-1"
                value={selectedTemplateKey}
                onChange={(e) => setSelectedTemplateKey(e.target.value)}
                required
              >
                <option value="">— Seleccionar template —</option>
                {templates.map((template) => (
                  <option key={`${template.name}:${template.language}`} value={`${template.name}:${template.language}`}>
                    {template.name} ({template.language})
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary px-3" disabled={loading} onClick={loadTemplates}>
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </label>

          {selectedTemplate && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 lg:col-span-2">
              <p className="font-medium">{selectedTemplate.name}</p>
              <p className="mt-1 whitespace-pre-wrap">{selectedTemplate.bodyText.slice(0, 180)}…</p>
              <p className="mt-2 text-amber-800">
                Parâmetros necessários: {selectedTemplate.parametersCount}
              </p>
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Parâmetros (separados por vírgula)</span>
            <NoAutofillInput
              className="input"
              name="wa_template_params"
              placeholder="valor1, valor2"
              value={templateParams}
              onChange={(e) => setTemplateParams(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Código do idioma</span>
            <select
              className="input"
              value={templateLanguage}
              onChange={(e) => setTemplateLanguage(e.target.value)}
            >
              {WHATSAPP_BUSINESS_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {selectedTemplate?.headerFormat &&
            ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(selectedTemplate.headerFormat) && (
              <label className="flex flex-col gap-1 text-sm lg:col-span-2">
                <span className="font-medium">URL da imagem do cabeçalho</span>
                <NoAutofillInput
                  className="input"
                  name="wa_template_header_url"
                  placeholder="https://…"
                  value={headerMediaUrl}
                  onChange={(e) => setHeaderMediaUrl(e.target.value)}
                />
                <span className="text-xs text-slate-500">
                  Apenas se o template tiver header {selectedTemplate.headerFormat} dinâmico. A URL é
                  guardada automaticamente.
                </span>
              </label>
            )}

          {preview && (
            <div className="lg:col-span-2">
              <div className="overflow-hidden rounded-xl border border-sky-200">
                <div className="bg-sky-600 px-4 py-2 text-sm font-medium text-white">Preview da mensagem</div>
                <div className="space-y-3 bg-slate-100 p-4">
                  {preview.header && (
                    <p className="text-sm font-semibold text-slate-900">{preview.header}</p>
                  )}
                  <div className="max-w-md rounded-2xl bg-white p-4 text-sm text-slate-800 shadow-sm">
                    <p className="whitespace-pre-wrap">{preview.body}</p>
                    {preview.buttons.map((button) => (
                      <div
                        key={button.text}
                        className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white"
                      >
                        {button.text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="lg:col-span-2">
            <button type="submit" className="btn-primary" disabled={loading || !selectedTemplate}>
              Enviar template
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Configuração de Eventos de Notificação" icon={<Bell className="h-4 w-4" />} tone="green">
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-950">
          Quando um evento ocorre (criar conta, calcular pagamento), o sistema envia email e/ou
          WhatsApp conforme estas opções. Só templates <strong>APPROVED</strong> aparecem na lista.
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            className="btn-secondary px-3 text-xs"
            disabled={loading}
            onClick={() => void loadTemplates()}
          >
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
            Actualizar templates
          </button>
        </div>

        <div className="space-y-4">
          {events.map((event) => {
            const meta = WHATSAPP_BUSINESS_EVENT_META[event.eventKey];
            const approvedTemplates = templates.filter(
              (t) => !t.status || t.status.toUpperCase() === 'APPROVED'
            );
            const selectedEventTemplate = approvedTemplates.find(
              (t) =>
                t.name === event.whatsappTemplate && t.language === event.whatsappLanguage
            );
            const needsHeaderMedia = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(
              (selectedEventTemplate?.headerFormat ?? '').toUpperCase()
            );
            const templateValue = event.whatsappTemplate
              ? `${event.whatsappTemplate}::${event.whatsappLanguage}`
              : '';
            return (
              <div key={event.eventKey} className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3">
                  <p className="font-medium text-slate-900">{meta.title}</p>
                  <p className="text-xs text-slate-500">{meta.description}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={event.emailEnabled}
                      onChange={(e) =>
                        setEvents((prev) =>
                          prev.map((item) =>
                            item.eventKey === event.eventKey
                              ? { ...item, emailEnabled: e.target.checked }
                              : item
                          )
                        )
                      }
                    />
                    Enviar email
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={event.whatsappEnabled}
                      onChange={(e) =>
                        setEvents((prev) =>
                          prev.map((item) =>
                            item.eventKey === event.eventKey
                              ? { ...item, whatsappEnabled: e.target.checked }
                              : item
                          )
                        )
                      }
                    />
                    Enviar WhatsApp
                  </label>
                </div>
                {event.whatsappEnabled && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm md:col-span-2">
                      <span className="font-medium">Template WhatsApp *</span>
                      <select
                        className="input"
                        value={
                          approvedTemplates.some(
                            (t) =>
                              t.name === event.whatsappTemplate &&
                              t.language === event.whatsappLanguage
                          )
                            ? templateValue
                            : event.whatsappTemplate
                              ? `${event.whatsappTemplate}::`
                              : ''
                        }
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!raw) {
                            setEvents((prev) =>
                              prev.map((item) =>
                                item.eventKey === event.eventKey
                                  ? { ...item, whatsappTemplate: null }
                                  : item
                              )
                            );
                            return;
                          }
                          const [name, language] = raw.split('::');
                          setEvents((prev) =>
                            prev.map((item) =>
                              item.eventKey === event.eventKey
                                ? {
                                    ...item,
                                    whatsappTemplate: name || null,
                                    whatsappLanguage: language || item.whatsappLanguage,
                                    headerMediaUrl: null,
                                  }
                                : item
                            )
                          );
                          if (name && language) {
                            void apiFetch<{ url: string | null }>(
                              `${API_PATHS.whatsappBusiness.templateHeaderUrl}?templateName=${encodeURIComponent(name)}&languageCode=${encodeURIComponent(language)}`,
                              {},
                              getStoredToken()
                            ).then((res) => {
                              if (res.data?.url == null) return;
                              setEvents((prev) =>
                                prev.map((item) =>
                                  item.eventKey === event.eventKey
                                    ? { ...item, headerMediaUrl: res.data?.url ?? null }
                                    : item
                                )
                              );
                            });
                          }
                        }}
                      >
                        <option value="">— Seleccionar template aprovado —</option>
                        {approvedTemplates.map((template) => (
                          <option
                            key={`${event.eventKey}-${template.name}-${template.language}`}
                            value={`${template.name}::${template.language}`}
                          >
                            {template.name} ({template.language})
                          </option>
                        ))}
                      </select>
                      {approvedTemplates.length === 0 && (
                        <span className="text-xs text-amber-700">
                          Sem templates aprovados carregados. Clique em «Actualizar templates» ou
                          aprove templates na Meta.
                        </span>
                      )}
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Idioma</span>
                      <select
                        className="input"
                        value={event.whatsappLanguage}
                        onChange={(e) =>
                          setEvents((prev) =>
                            prev.map((item) =>
                              item.eventKey === event.eventKey
                                ? { ...item, whatsappLanguage: e.target.value }
                                : item
                            )
                          )
                        }
                      >
                        {WHATSAPP_BUSINESS_LANGUAGE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {needsHeaderMedia && (
                      <label className="flex flex-col gap-1 text-sm md:col-span-2">
                        <span className="font-medium">
                          URL da imagem do cabeçalho ({selectedEventTemplate?.headerFormat}) *
                        </span>
                        <input
                          className="input"
                          type="url"
                          placeholder="https://…"
                          value={event.headerMediaUrl ?? ''}
                          onChange={(e) =>
                            setEvents((prev) =>
                              prev.map((item) =>
                                item.eventKey === event.eventKey
                                  ? { ...item, headerMediaUrl: e.target.value }
                                  : item
                              )
                            )
                          }
                        />
                        <span className="text-xs text-slate-500">
                          A Meta exige um link público da imagem para enviar este template.
                        </span>
                      </label>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="btn-primary mt-4 bg-emerald-700 hover:bg-emerald-800"
                  disabled={loading}
                  onClick={() => void saveEvent(event)}
                >
                  Guardar configuração
                </button>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Resultados" icon={<FileText className="h-4 w-4" />}>
        {results.length === 0 ? (
          <p className="text-sm text-slate-500">Sem resultados ainda.</p>
        ) : (
          <div className="space-y-2">
            {results.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  entry.tone === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-red-200 bg-red-50 text-red-900'
                }`}
              >
                <p>{entry.message}</p>
                <p className="mt-1 text-xs opacity-70">{entry.at}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      </fieldset>
    </div>
  );
}
