'use client';

import { FormEvent, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';
import { OtpInput } from '@/components/otp-input';
import { TwoFaVerifyPanel } from '@/components/two-fa-verify-panel';
import { SettingsAlerts } from '@/components/settings/settings-alerts';

const METHOD_LABELS: Record<string, string> = {
  totp: 'App autenticadora',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

export function SettingsTwoFaPanel() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [activeTwoFaMethod, setActiveTwoFaMethod] = useState<string | null>(null);
  const [twoFaMethodOptions, setTwoFaMethodOptions] = useState<
    Array<{ method: string; available: boolean; reason?: string }>
  >([{ method: 'totp', available: true }]);
  const [selectedTwoFaMethod, setSelectedTwoFaMethod] = useState<string | null>(null);
  const [setupPhone, setSetupPhone] = useState('');
  const [setupDeliveryHint, setSetupDeliveryHint] = useState('');
  const [twoFaStep, setTwoFaStep] = useState<
    'idle' | 'choose-method' | 'setup-phone' | 'setup' | 'setup-otp' | 'backup'
  >('idle');
  const [twoFaSetup, setTwoFaSetup] = useState<{
    qrDataUrl: string;
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [twoFaVerifyCode, setTwoFaVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disableModalStep, setDisableModalStep] = useState<'password' | '2fa'>('password');
  const [disableModalError, setDisableModalError] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableDeliveryHint, setDisableDeliveryHint] = useState('');
  const [disableCodeSent, setDisableCodeSent] = useState(false);

  function load() {
    const token = getStoredToken();
    apiFetch<{ twoFaMethod?: string | null }>(API_PATHS.auth.me, {}, token).then((res) => {
      if (res.data) {
        setTwoFaEnabled(Boolean(res.data.twoFaMethod));
        setActiveTwoFaMethod(res.data.twoFaMethod ?? null);
      }
    });
    apiFetch<{
      enabled: boolean;
      method?: string | null;
      methodOptions?: Array<{ method: string; available: boolean; reason?: string }>;
    }>(API_PATHS.auth.twoFa.status, {}, token).then((res) => {
      if (res.data) {
        setTwoFaEnabled(res.data.enabled);
        setActiveTwoFaMethod(res.data.method ?? null);
        if (res.data.methodOptions?.length) setTwoFaMethodOptions(res.data.methodOptions);
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshTwoFaMethods() {
    const res = await apiFetch<{
      methodOptions?: Array<{ method: string; available: boolean; reason?: string }>;
    }>(API_PATHS.auth.twoFa.status, {}, getStoredToken());
    if (res.data?.methodOptions?.length) setTwoFaMethodOptions(res.data.methodOptions);
  }

  function openMethodChooser() {
    setError('');
    setSuccess('');
    setSelectedTwoFaMethod(null);
    setSetupPhone('');
    setSetupDeliveryHint('');
    setTwoFaSetup(null);
    setTwoFaVerifyCode('');
    setTwoFaStep('choose-method');
    void refreshTwoFaMethods();
  }

  async function startMethodSetup(method: string) {
    setError('');
    setSuccess('');
    setSelectedTwoFaMethod(method);

    if (method === 'sms' || method === 'whatsapp') {
      setTwoFaStep('setup-phone');
      return;
    }

    setLoading(true);
    const res = await apiFetch<{
      qrDataUrl?: string;
      secret?: string;
      otpauthUrl?: string;
      maskedEmail?: string;
      message?: string;
    }>(
      API_PATHS.auth.twoFa.setup,
      { method: 'POST', body: JSON.stringify({ method }) },
      getStoredToken()
    );
    setLoading(false);

    if (!res.success || !res.data) {
      setError(getApiErrorMessage(res));
      return;
    }

    if (method === 'totp' && res.data.qrDataUrl) {
      setTwoFaSetup({
        qrDataUrl: res.data.qrDataUrl,
        secret: res.data.secret ?? '',
        otpauthUrl: res.data.otpauthUrl ?? '',
      });
      setTwoFaStep('setup');
    } else if (method === 'email') {
      setSetupDeliveryHint(res.data.maskedEmail ?? res.data.message ?? 'email');
      setTwoFaStep('setup-otp');
    }
  }

  async function submitPhoneSetup(e: FormEvent) {
    e.preventDefault();
    if (!selectedTwoFaMethod) return;
    setError('');
    setSuccess('');
    setLoading(true);

    const res = await apiFetch<{ maskedPhone?: string; message?: string }>(
      API_PATHS.auth.twoFa.setup,
      {
        method: 'POST',
        body: JSON.stringify({ method: selectedTwoFaMethod, phone: setupPhone }),
      },
      getStoredToken()
    );

    setLoading(false);
    if (res.success && res.data) {
      setSetupDeliveryHint(res.data.maskedPhone ?? res.data.message ?? setupPhone);
      setTwoFaStep('setup-otp');
      setSuccess('Código enviado');
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function confirm2faSetup(e: FormEvent) {
    e.preventDefault();
    if (!selectedTwoFaMethod) return;
    setError('');
    setSuccess('');
    setLoading(true);

    const res = await apiFetch<{ backupCodes: string[] }>(
      API_PATHS.auth.twoFa.verifySetup,
      {
        method: 'POST',
        body: JSON.stringify({
          code: twoFaVerifyCode.replace(/\s/g, ''),
          method: selectedTwoFaMethod,
        }),
      },
      getStoredToken()
    );

    setLoading(false);
    if (res.success && res.data) {
      setBackupCodes(res.data.backupCodes);
      setTwoFaStep('backup');
      setTwoFaEnabled(true);
      setActiveTwoFaMethod(selectedTwoFaMethod);
      setTwoFaSetup(null);
      setSuccess('2FA activado com sucesso');
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  function openDisableModal() {
    setDisableModalOpen(true);
    setDisableModalStep('password');
    setDisableModalError('');
    setDisablePassword('');
    setDisableCode('');
    setDisableDeliveryHint('');
    setDisableCodeSent(false);
  }

  function closeDisableModal() {
    setDisableModalOpen(false);
    setDisableModalStep('password');
    setDisableModalError('');
    setDisablePassword('');
    setDisableCode('');
    setDisableDeliveryHint('');
    setDisableCodeSent(false);
  }

  function getDisable2faDescription() {
    if (activeTwoFaMethod === 'totp') {
      return 'Confirme com o código de 6 dígitos da app autenticadora.';
    }
    if (disableDeliveryHint) {
      return `Introduza o código de 6 dígitos enviado para ${disableDeliveryHint}.`;
    }
    return 'Introduza o código de verificação de 6 dígitos enviado para si.';
  }

  async function sendDisableVerificationCode(): Promise<void> {
    if (activeTwoFaMethod === 'totp' || !activeTwoFaMethod) return;

    setDisableModalError('');
    setLoading(true);
    const res = await apiFetch<{ maskedPhone?: string; maskedEmail?: string }>(
      API_PATHS.auth.twoFa.sendCodeMe,
      { method: 'POST' },
      getStoredToken()
    );
    setLoading(false);

    if (res.success) {
      const hint = res.data?.maskedPhone ?? res.data?.maskedEmail;
      if (hint) setDisableDeliveryHint(hint);
      setDisableCodeSent(true);
      return;
    }

    setDisableModalError(getApiErrorMessage(res));
  }

  async function confirmDisablePassword(e: FormEvent) {
    e.preventDefault();
    setDisableModalError('');
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.auth.verifyPassword,
      { method: 'POST', body: JSON.stringify({ password: disablePassword }) },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setDisableModalStep('2fa');
      setDisableCode('');
      if (activeTwoFaMethod && activeTwoFaMethod !== 'totp') {
        void sendDisableVerificationCode();
      }
    } else {
      setDisableModalError(getApiErrorMessage(res));
    }
  }

  async function disable2fa(code: string) {
    setDisableModalError('');
    setLoading(true);
    const res = await apiFetch(
      API_PATHS.auth.twoFa.disable,
      {
        method: 'POST',
        body: JSON.stringify({
          password: disablePassword,
          code: code.replace(/\s/g, ''),
        }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setTwoFaEnabled(false);
      setActiveTwoFaMethod(null);
      closeDisableModal();
      setSuccess('2FA desactivado');
    } else {
      setDisableModalError(getApiErrorMessage(res));
      if (!/código/i.test(res.error ?? '')) setDisableCode('');
    }
  }

  return (
    <div className="space-y-4">
      <SettingsAlerts error={error} success={success} onDismissError={() => setError('')} onDismissSuccess={() => setSuccess('')} />

      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Autenticação de dois factores</h2>
          <span className="text-xs text-slate-500">
            {twoFaEnabled
              ? `Activo (${METHOD_LABELS[activeTwoFaMethod ?? ''] ?? activeTwoFaMethod})`
              : 'Inactivo'}
          </span>
        </div>

        {twoFaStep === 'choose-method' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Escolha como deseja confirmar o login:</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {twoFaMethodOptions.map((option) => (
                <button
                  key={option.method}
                  type="button"
                  className={`rounded-lg border p-4 text-left transition ${
                    option.available
                      ? 'border-slate-200 hover:border-[var(--color-primary)] hover:bg-slate-50'
                      : 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-70'
                  }`}
                  onClick={() => option.available && startMethodSetup(option.method)}
                  disabled={loading || !option.available}
                >
                  <p className="font-medium">{METHOD_LABELS[option.method] ?? option.method}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {option.method === 'totp' && 'Google Authenticator, Authy, etc.'}
                    {option.method === 'sms' && 'Código por SMS'}
                    {option.method === 'whatsapp' && 'Código por WhatsApp'}
                    {option.method === 'email' && 'Código enviado para o seu email'}
                  </p>
                  {!option.available && option.reason && (
                    <p className="mt-2 text-xs text-amber-700">{option.reason}</p>
                  )}
                </button>
              ))}
            </div>
            <button type="button" className="btn-secondary" onClick={() => setTwoFaStep('idle')}>
              Cancelar
            </button>
          </div>
        )}

        {twoFaStep === 'setup-phone' && selectedTwoFaMethod && (
          <form onSubmit={submitPhoneSetup} className="space-y-4">
            <p className="text-sm text-slate-600">
              Introduza o número para receber códigos por {METHOD_LABELS[selectedTwoFaMethod]}.
            </p>
            <input
              className="input"
              placeholder="+351912345678"
              value={setupPhone}
              onChange={(e) => setSetupPhone(e.target.value)}
              required
            />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={loading}>
                Enviar código
              </button>
              <button type="button" className="btn-secondary" onClick={() => setTwoFaStep('choose-method')}>
                Voltar
              </button>
            </div>
          </form>
        )}

        {twoFaStep === 'setup-otp' && selectedTwoFaMethod && (
          <form onSubmit={confirm2faSetup} className="space-y-6">
            <p className="text-sm text-slate-600">
              Introduza o código de 6 dígitos enviado para{' '}
              <strong>{setupDeliveryHint || 'o destino indicado'}</strong>.
            </p>
            <OtpInput value={twoFaVerifyCode} onChange={setTwoFaVerifyCode} disabled={loading} autoFocus />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={loading || twoFaVerifyCode.length < 6}>
                Activar 2FA
              </button>
              <button type="button" className="btn-secondary" onClick={() => setTwoFaStep('choose-method')}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {twoFaStep === 'backup' && backupCodes.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="mb-2 text-sm font-medium text-amber-900">
              Guarde estes códigos de recuperação num local seguro. Só são mostrados uma vez.
            </p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm text-amber-950">
              {backupCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary mt-4"
              onClick={() => {
                setTwoFaStep('idle');
                setBackupCodes([]);
              }}
            >
              Já guardei os códigos
            </button>
          </div>
        )}

        {twoFaStep === 'setup' && twoFaSetup && selectedTwoFaMethod === 'totp' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Escaneie o QR code com Google Authenticator, Authy ou similar.
            </p>
            <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={twoFaSetup.qrDataUrl} alt="QR code 2FA" className="h-40 w-40 rounded border" />
              <div className="text-xs text-slate-500">
                <p className="mb-1 font-medium text-slate-700">Chave manual</p>
                <code className="break-all rounded bg-slate-100 px-2 py-1">{twoFaSetup.secret}</code>
              </div>
            </div>
            <form onSubmit={confirm2faSetup} className="space-y-6">
              <OtpInput value={twoFaVerifyCode} onChange={setTwoFaVerifyCode} disabled={loading} autoFocus />
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary" disabled={loading || twoFaVerifyCode.length < 6}>
                  Activar 2FA
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setTwoFaStep('idle');
                    setTwoFaSetup(null);
                    setTwoFaVerifyCode('');
                    setSelectedTwoFaMethod(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {twoFaStep === 'idle' && (
          <div className="flex flex-wrap gap-2">
            {!twoFaEnabled ? (
              <button type="button" className="btn-primary" onClick={openMethodChooser} disabled={loading}>
                Activar 2FA
              </button>
            ) : (
              <button type="button" className="btn-secondary" onClick={openDisableModal} disabled={loading}>
                Desactivar 2FA
              </button>
            )}
          </div>
        )}
      </section>

      <Modal open={disableModalOpen} onClose={closeDisableModal}>
        {disableModalStep === 'password' ? (
          <form onSubmit={confirmDisablePassword} className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Confirmar password</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm text-slate-500">
                Introduza a sua password para desactivar a autenticação de dois factores.
              </p>
            </div>
            <input
              className="input"
              type="password"
              placeholder="Password actual"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              required
              autoFocus
            />
            {disableModalError && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{disableModalError}</div>
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1" disabled={loading || !disablePassword}>
                {loading ? 'A verificar...' : 'Continuar'}
              </button>
              <button type="button" className="btn-secondary" onClick={closeDisableModal}>
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <TwoFaVerifyPanel
              title="Desactivar 2FA"
              description={getDisable2faDescription()}
              value={disableCode}
              onChange={setDisableCode}
              onSubmit={disable2fa}
              loading={loading}
              error={disableModalError}
              submitLabel="Desactivar 2FA"
              autoSubmit
              onResendCode={
                activeTwoFaMethod && activeTwoFaMethod !== 'totp' ? sendDisableVerificationCode : undefined
              }
            />
            {disableCodeSent && activeTwoFaMethod !== 'totp' && !disableModalError && (
              <p className="text-center text-sm text-emerald-700">Código enviado. Verifique o destino indicado.</p>
            )}
            <button
              type="button"
              className="w-full text-sm text-slate-500 hover:text-slate-700"
              onClick={() => {
                setDisableModalStep('password');
                setDisableCode('');
                setDisableModalError('');
                setDisableCodeSent(false);
              }}
            >
              Voltar
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
