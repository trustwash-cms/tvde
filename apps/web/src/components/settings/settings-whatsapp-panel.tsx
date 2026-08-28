'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { WhatsappProvider } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { SettingsAlerts } from '@/components/settings/settings-alerts';
import { WHATSAPP_PROVIDER_CHANGED_EVENT } from '@/components/whatsapp/whatsapp-settings-shell';
import { NoAutofillInput, NoAutofillTextarea } from '@/components/whatsapp/no-autofill-field';

interface WhatsappTemplate {
  key: string;
  body: string;
  variables: string[];
  isDefault?: boolean;
}

const WHATSAPP_TEMPLATE_LABELS: Record<string, string> = {
  otp: '2FA OTP',
  plain: 'Texto simples',
};

export function SettingsWhatsappPanel() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [whatsapp2faEnabled, setWhatsapp2faEnabled] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<{
    connected: boolean;
    state: string;
    phoneNumber?: string;
    qrAvailable: boolean;
  } | null>(null);
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsappTemplate[]>([]);
  const [activeWhatsappTemplateKey, setActiveWhatsappTemplateKey] = useState('otp');
  const [whatsappTemplateForm, setWhatsappTemplateForm] = useState({ body: '' });
  const [testWhatsappPhone, setTestWhatsappPhone] = useState('');
  const [activeProvider, setActiveProvider] = useState<WhatsappProvider>('generic');

  function loadWhatsappTemplates(token: string | null) {
    apiFetch<WhatsappTemplate[]>(API_PATHS.platform.whatsappTemplates, {}, token).then((res) => {
      if (!res.data?.length) return;
      setWhatsappTemplates(res.data);
      const current = res.data.find((t) => t.key === activeWhatsappTemplateKey) ?? res.data[0];
      if (current) {
        setActiveWhatsappTemplateKey(current.key);
        setWhatsappTemplateForm({ body: current.body });
      }
    });
  }

  function load() {
    const token = getStoredToken();
    apiFetch<{
      whatsapp2faEnabled: boolean;
      activeProvider?: WhatsappProvider;
      whatsapp: typeof whatsappStatus;
    }>(API_PATHS.platform.whatsappSettings, {}, token).then((res) => {
      if (!res.data) return;
      setWhatsapp2faEnabled(res.data.whatsapp2faEnabled);
      setWhatsappStatus(res.data.whatsapp);
      if (res.data.activeProvider) setActiveProvider(res.data.activeProvider);
    });
    loadWhatsappTemplates(token);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function onProviderChanged(event: Event) {
      const next = (event as CustomEvent<WhatsappProvider>).detail;
      if (next) setActiveProvider(next);
      load();
    }
    window.addEventListener(WHATSAPP_PROVIDER_CHANGED_EVENT, onProviderChanged);
    return () => window.removeEventListener(WHATSAPP_PROVIDER_CHANGED_EVENT, onProviderChanged);
  }, []);

  useEffect(() => {
    const current = whatsappTemplates.find((t) => t.key === activeWhatsappTemplateKey);
    if (current) setWhatsappTemplateForm({ body: current.body });
  }, [activeWhatsappTemplateKey, whatsappTemplates]);

  async function refreshWhatsappQr() {
    const token = getStoredToken();
    const res = await apiFetch<{ qr: string | null; qrDataUrl: string | null }>(
      API_PATHS.platform.whatsappQr,
      {},
      token
    );
    if (res.success && res.data?.qrDataUrl) setWhatsappQr(res.data.qrDataUrl);
    else if (res.success) setWhatsappQr(null);

    const statusRes = await apiFetch<typeof whatsappStatus>(
      API_PATHS.platform.whatsappStatus,
      {},
      token
    );
    if (statusRes.data) setWhatsappStatus(statusRes.data);
  }

  useEffect(() => {
    if (!whatsapp2faEnabled || whatsappStatus?.connected) return;
    refreshWhatsappQr();
    const id = window.setInterval(refreshWhatsappQr, 4000);
    return () => window.clearInterval(id);
  }, [whatsapp2faEnabled, whatsappStatus?.connected]);

  async function toggleWhatsapp(enabled: boolean) {
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.platform.whatsappSettings,
      { method: 'PATCH', body: JSON.stringify({ whatsapp2faEnabled: enabled }) },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setWhatsapp2faEnabled(enabled);
      setSuccess('Funcionalidade WhatsApp actualizada');
      if (enabled) setActiveProvider('generic');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function restartWhatsapp() {
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(API_PATHS.platform.whatsappRestart, { method: 'POST' }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('WhatsApp bridge reiniciado — aguarde o QR code');
      await refreshWhatsappQr();
    } else {
      const msg = getApiErrorMessage(res);
      setError(
        msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('indisponível')
          ? 'Bridge offline — verifique WHATSAPP_BRIDGE_URL e o serviço whatsapp-bridge'
          : msg
      );
    }
  }

  async function logoutWhatsapp() {
    setLoading(true);
    const res = await apiFetch(API_PATHS.platform.whatsappLogout, { method: 'POST' }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Sessão WhatsApp terminada');
      setWhatsappQr(null);
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function saveWhatsappTemplate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.platform.whatsappTemplateByKey(activeWhatsappTemplateKey),
      { method: 'PUT', body: JSON.stringify(whatsappTemplateForm) },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Template WhatsApp guardado');
      loadWhatsappTemplates(getStoredToken());
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function sendWhatsappTest(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.platform.whatsappTest,
      {
        method: 'POST',
        body: JSON.stringify({ to: testWhatsappPhone, templateKey: activeWhatsappTemplateKey }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) setSuccess('WhatsApp de teste enviado');
    else setError(getApiErrorMessage(res));
  }

  const currentWhatsappTemplate = whatsappTemplates.find((t) => t.key === activeWhatsappTemplateKey);

  const providerInactive = activeProvider !== 'generic';

  return (
    <div className="space-y-4">
      <SettingsAlerts error={error} success={success} onDismissError={() => setError('')} onDismissSuccess={() => setSuccess('')} />

      {providerInactive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          A <strong>API Oficial</strong> está activa. Active a <strong>API Genérica</strong> no selector acima
          para usar o bridge/QR desta secção.
        </div>
      )}

      <fieldset disabled={providerInactive || loading} className="disabled:opacity-60">
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">WhatsApp</h2>
          <p className="text-sm text-slate-500">
            Bridge isolado (whatsapp-bridge) para 2FA, notificações e templates por tenant.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
          <div>
            <p className="font-medium">2FA WhatsApp</p>
            <p className="text-xs text-slate-500">Emparelhamento via QR code — requer o serviço whatsapp-bridge activo.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={whatsapp2faEnabled}
              onChange={(e) => toggleWhatsapp(e.target.checked)}
              disabled={loading}
            />
            Activar
          </label>
        </div>

        {whatsapp2faEnabled && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                Estado: {whatsappStatus?.state ?? 'desconhecido'}
              </span>
              {whatsappStatus?.phoneNumber && (
                <span className="text-slate-600">Ligado: +{whatsappStatus.phoneNumber}</span>
              )}
              {whatsappStatus?.connected && <span className="text-green-700">Conectado</span>}
            </div>

            {!whatsappStatus?.connected && whatsappQr && (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-slate-600">
                  WhatsApp → Dispositivos ligados → Ligar dispositivo → escaneie:
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={whatsappQr} alt="QR WhatsApp" className="h-72 w-72 rounded border bg-white p-2" />
              </div>
            )}

            {!whatsappStatus?.connected && !whatsappQr && (
              <p className="text-sm text-amber-700">
                Bridge offline ou a inicializar. Verifique o serviço whatsapp-bridge e clique Reiniciar.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={refreshWhatsappQr} disabled={loading}>
                Actualizar QR
              </button>
              <button type="button" className="btn-secondary" onClick={restartWhatsapp} disabled={loading}>
                Reiniciar bridge
              </button>
              <button type="button" className="btn-secondary" onClick={logoutWhatsapp} disabled={loading}>
                Terminar sessão
              </button>
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-4">
              <div>
                <p className="font-medium">Templates WhatsApp</p>
                <p className="text-xs text-slate-500">
                  Usados no 2FA e envios de teste. Negrito WhatsApp: <code className="text-xs">*texto*</code>
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {whatsappTemplates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      activeWhatsappTemplateKey === t.key
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                    onClick={() => setActiveWhatsappTemplateKey(t.key)}
                  >
                    {WHATSAPP_TEMPLATE_LABELS[t.key] ?? t.key}
                  </button>
                ))}
              </div>

              {currentWhatsappTemplate && (
                <p className="text-xs text-slate-500">
                  Variáveis: {currentWhatsappTemplate.variables.map((v) => `{{${v}}}`).join(', ')}
                  {currentWhatsappTemplate.isDefault ? ' · template por defeito' : ''}
                </p>
              )}

              <form onSubmit={saveWhatsappTemplate} autoComplete="off" className="space-y-3">
                <NoAutofillTextarea
                  className="input min-h-[160px] font-mono text-sm"
                  name="wa_generic_template_body"
                  placeholder="Corpo da mensagem WhatsApp"
                  value={whatsappTemplateForm.body}
                  onChange={(e) => setWhatsappTemplateForm({ body: e.target.value })}
                  required
                />
                <button type="submit" className="btn-primary" disabled={loading}>
                  Guardar template
                </button>
              </form>

              <form onSubmit={sendWhatsappTest} autoComplete="off" className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <NoAutofillInput
                  className="input min-w-[200px] flex-1"
                  name="wa_generic_test_phone"
                  autoComplete="tel"
                  placeholder="Telefone teste (+351912345678)"
                  value={testWhatsappPhone}
                  onChange={(e) => setTestWhatsappPhone(e.target.value)}
                  required
                />
                <button type="submit" className="btn-secondary" disabled={loading}>
                  Enviar WhatsApp teste
                </button>
              </form>
            </div>
          </div>
        )}
      </section>
      </fieldset>
    </div>
  );
}
