'use client';

import { FormEvent, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { SmsHistoryModal } from '@/components/sms-history-modal';
import { SettingsAlerts } from '@/components/settings/settings-alerts';

export function SettingsSmsPanel() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [sms2faEnabled, setSms2faEnabled] = useState(false);
  const [smsInfo, setSmsInfo] = useState<{
    configured: boolean;
    usingEnvFallback: boolean;
    devMockActive?: boolean;
    smsConfig: {
      provider: string;
      accountSid: string | null;
      servicePlanId: string | null;
      apiBaseUrl: string | null;
      fromNumber: string;
    } | null;
  } | null>(null);
  const [smsForm, setSmsForm] = useState({
    provider: 'twilio' as 'twilio' | 'sinch',
    accountSid: '',
    servicePlanId: '',
    apiBaseUrl: 'https://eu.sms.api.sinch.com/xms/v1',
    authToken: '',
    fromNumber: '',
  });
  const [testSmsPhone, setTestSmsPhone] = useState('');
  const [smsHistoryOpen, setSmsHistoryOpen] = useState(false);

  function load() {
    const token = getStoredToken();
    apiFetch<{
      sms2faEnabled: boolean;
      configured: boolean;
      usingEnvFallback: boolean;
      devMockActive?: boolean;
      smsConfig: {
        provider: string;
        accountSid: string | null;
        servicePlanId: string | null;
        apiBaseUrl: string | null;
        fromNumber: string;
      } | null;
    }>(API_PATHS.platform.smsConfig, {}, token).then((res) => {
      if (!res.data) return;
      setSms2faEnabled(res.data.sms2faEnabled);
      setSmsInfo({
        configured: res.data.configured,
        usingEnvFallback: res.data.usingEnvFallback,
        devMockActive: res.data.devMockActive,
        smsConfig: res.data.smsConfig,
      });
      if (res.data.smsConfig) {
        const c = res.data.smsConfig;
        setSmsForm((f) => ({
          ...f,
          provider: c.provider === 'sinch' ? 'sinch' : 'twilio',
          accountSid: c.accountSid ?? '',
          servicePlanId: c.servicePlanId ?? '',
          apiBaseUrl: c.apiBaseUrl ?? 'https://eu.sms.api.sinch.com/xms/v1',
          fromNumber: c.fromNumber,
          authToken: '',
        }));
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleSms(enabled: boolean) {
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.platform.smsFeatures,
      { method: 'PATCH', body: JSON.stringify({ sms2faEnabled: enabled }) },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSms2faEnabled(enabled);
      setSuccess('Funcionalidade SMS actualizada');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function saveSmsConfig(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const payload: Record<string, string> = {
      provider: smsForm.provider,
      fromNumber: smsForm.fromNumber,
    };
    if (smsForm.provider === 'twilio') {
      payload.accountSid = smsForm.accountSid;
    } else {
      payload.servicePlanId = smsForm.servicePlanId;
      payload.apiBaseUrl = smsForm.apiBaseUrl;
    }
    if (smsForm.authToken) payload.authToken = smsForm.authToken;

    const res = await apiFetch(API_PATHS.platform.smsConfig, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Configuração SMS guardada');
      setSmsForm((f) => ({ ...f, authToken: '' }));
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function sendSmsTest(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    const res = await apiFetch(API_PATHS.platform.smsTest, {
      method: 'POST',
      body: JSON.stringify({ to: testSmsPhone }),
    }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess(res.message ?? 'SMS enviado');
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  return (
    <div className="space-y-4">
      <SettingsAlerts error={error} success={success} onDismissError={() => setError('')} onDismissSuccess={() => setSuccess('')} />

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">SMS</h2>
          <p className="text-sm text-slate-500">
            Provider REST (Twilio / Sinch) para 2FA e notificações. Só MASTER pode configurar.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-4">
          <div>
            <p className="font-medium">2FA SMS</p>
            <p className="text-xs text-slate-500">Activar envio de códigos por SMS na plataforma.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sms2faEnabled}
              onChange={(e) => toggleSms(e.target.checked)}
              disabled={loading}
            />
            Activar
          </label>
        </div>

        {sms2faEnabled && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            {smsInfo?.devMockActive && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Modo <strong>dev mock</strong> activo — SMS não sai para a Sinch/Twilio.
                Para envio real, defina <code className="text-xs">SMS_DEV_MOCK=false</code> no{' '}
                <code className="text-xs">.env</code> e reinicie a API.
              </div>
            )}
            {smsInfo && (
              <p className="text-xs text-slate-500">
                {smsInfo.smsConfig
                  ? `${smsInfo.smsConfig.provider === 'sinch' ? 'Sinch' : 'Twilio'} activo — ${smsInfo.smsConfig.fromNumber}`
                  : smsInfo.usingEnvFallback
                    ? 'A usar credenciais SMS do .env (fallback)'
                    : 'SMS não configurado'}
              </p>
            )}
            <form onSubmit={saveSmsConfig} className="grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2 flex flex-col gap-1 text-sm">
                <span className="font-medium">Provider</span>
                <select
                  className="input"
                  value={smsForm.provider}
                  onChange={(e) =>
                    setSmsForm({ ...smsForm, provider: e.target.value as 'twilio' | 'sinch' })
                  }
                >
                  <option value="twilio">Twilio</option>
                  <option value="sinch">Sinch REST SMS</option>
                </select>
              </label>
              {smsForm.provider === 'twilio' ? (
                <input
                  className="input md:col-span-2"
                  placeholder="Account SID (Twilio)"
                  value={smsForm.accountSid}
                  onChange={(e) => setSmsForm({ ...smsForm, accountSid: e.target.value })}
                  required
                />
              ) : (
                <>
                  <input
                    className="input md:col-span-2"
                    placeholder="Service Plan ID (Sinch)"
                    value={smsForm.servicePlanId}
                    onChange={(e) => setSmsForm({ ...smsForm, servicePlanId: e.target.value })}
                    required
                  />
                  <input
                    className="input md:col-span-2"
                    placeholder="API Base URL"
                    value={smsForm.apiBaseUrl}
                    onChange={(e) => setSmsForm({ ...smsForm, apiBaseUrl: e.target.value })}
                  />
                </>
              )}
              <input
                className="input md:col-span-2"
                placeholder="API Token / Auth Token (deixe vazio para manter)"
                type="password"
                value={smsForm.authToken}
                onChange={(e) => setSmsForm({ ...smsForm, authToken: e.target.value })}
              />
              <input
                className="input md:col-span-2"
                placeholder="Remetente: +351912345678 ou Sender ID (ex: TVDE)"
                value={smsForm.fromNumber}
                onChange={(e) => setSmsForm({ ...smsForm, fromNumber: e.target.value })}
                required
              />
              <button type="submit" className="btn-primary md:col-span-2" disabled={loading}>
                Guardar SMS
              </button>
            </form>
            <form onSubmit={sendSmsTest} className="flex flex-wrap gap-2">
              <input
                className="input min-w-[200px] flex-1"
                placeholder="Telefone teste (+351912345678)"
                value={testSmsPhone}
                onChange={(e) => setTestSmsPhone(e.target.value)}
                required
              />
              <button type="submit" className="btn-secondary" disabled={loading}>
                Enviar SMS teste
              </button>
              <button type="button" className="btn-secondary" onClick={() => setSmsHistoryOpen(true)}>
                Histórico
              </button>
            </form>
          </div>
        )}
      </section>

      <SmsHistoryModal open={smsHistoryOpen} onClose={() => setSmsHistoryOpen(false)} />
    </div>
  );
}
