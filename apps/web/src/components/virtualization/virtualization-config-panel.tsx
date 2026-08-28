'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  VIRTUALIZATION_DASHBOARD_REFRESH_OPTIONS,
  VIRTUALIZATION_POLL_INTERVAL_OPTIONS,
  type VirtualizationSettingsPublic,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { NoAutofillSecretInput } from '@/components/whatsapp/no-autofill-field';
import { VirtualizationZerotierPanel } from '@/components/virtualization/virtualization-zerotier-panel';

export function VirtualizationConfigPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [settings, setSettings] = useState<VirtualizationSettingsPublic | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sshSecrets, setSshSecrets] = useState({
    password: '',
    privateKey: '',
    passphrase: '',
  });

  const loadSettings = useCallback(async () => {
    if (!workspaceId) return;
    const settingsRes = await apiFetch<VirtualizationSettingsPublic>(
      withWorkspaceQuery(API_PATHS.virtualization.settings, workspaceId),
      {},
      getStoredToken()
    );

    if (settingsRes.data) {
      setSettings(settingsRes.data);
      setError('');
    } else {
      setError(getApiErrorMessage(settingsRes));
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSettingsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !settings) return;

    setBusy(true);
    setError('');
    setMessage('');

    const res = await apiFetch<VirtualizationSettingsPublic>(
      withWorkspaceQuery(API_PATHS.virtualization.settings, workspaceId),
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...settings,
          ...(sshSecrets.password.trim() ? { sshPassword: sshSecrets.password } : {}),
          ...(sshSecrets.privateKey.trim() ? { sshPrivateKey: sshSecrets.privateKey } : {}),
          ...(sshSecrets.passphrase.trim() ? { sshPassphrase: sshSecrets.passphrase } : {}),
        }),
      },
      getStoredToken()
    );

    if (res.data) {
      setSettings(res.data);
      setSshSecrets({ password: '', privateKey: '', passphrase: '' });
      setMessage('Definições guardadas.');
    } else {
      setError(getApiErrorMessage(res));
    }
    setBusy(false);
  };

  if (!workspaceId) {
    return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;
  }

  return (
    <div className="space-y-8">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      {settings ? (
        <section className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">Definições do workspace</h2>
          <p className="mt-1 text-sm text-slate-500">
            Acesso SSH partilhado, notificações e intervalos de actualização. Servidores PBS e PVE
            gerem-se nos respectivos separadores.
          </p>

          <form id="virtualization-settings-form" onSubmit={handleSettingsSubmit} className="mt-5 space-y-8">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">Acesso SSH</h3>
              <p className="text-sm text-slate-500">
                Usado para instalar ZeroTier nos servidores. Os alvos podem herdar estas credenciais.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">Utilizador predefinido</span>
                  <input
                    className="input w-full"
                    value={settings.sshDefaultUsername}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, sshDefaultUsername: e.target.value } : prev
                      )
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">Porta predefinida</span>
                  <input
                    className="input w-full"
                    type="number"
                    min={1}
                    max={65535}
                    value={settings.sshDefaultPort}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, sshDefaultPort: Number(e.target.value) || 22 } : prev
                      )
                    }
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Autenticação SSH</span>
                <select
                  className="input w-full max-w-xs"
                  value={settings.sshAuthMode}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            sshAuthMode: e.target.value as VirtualizationSettingsPublic['sshAuthMode'],
                          }
                        : prev
                    )
                  }
                >
                  <option value="password">Password</option>
                  <option value="private_key">Chave privada</option>
                </select>
              </label>

              {settings.sshAuthMode === 'password' ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">
                    Password SSH {settings.hasSshPassword ? '(deixe vazio para manter)' : ''}
                  </span>
                  <NoAutofillSecretInput
                    className="input w-full max-w-md"
                    value={sshSecrets.password}
                    onChange={(e) =>
                      setSshSecrets((prev) => ({ ...prev, password: e.target.value }))
                    }
                    required={!settings.hasSshPassword}
                  />
                </label>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-700">
                      Chave privada SSH {settings.hasSshPrivateKey ? '(deixe vazio para manter)' : ''}
                    </span>
                    <textarea
                      className="input min-h-[120px] w-full font-mono text-xs"
                      value={sshSecrets.privateKey}
                      onChange={(e) =>
                        setSshSecrets((prev) => ({ ...prev, privateKey: e.target.value }))
                      }
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      required={!settings.hasSshPrivateKey}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-700">Passphrase da chave (opcional)</span>
                    <NoAutofillSecretInput
                      className="input w-full max-w-md"
                      value={sshSecrets.passphrase}
                      onChange={(e) =>
                        setSshSecrets((prev) => ({ ...prev, passphrase: e.target.value }))
                      }
                    />
                  </label>
                </>
              )}
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-6">
              <h3 className="text-sm font-semibold text-slate-900">Notificações e intervalos</h3>
              <p className="text-sm text-slate-500">
                Alertas automáticos quando um backup falhar (worker em fase posterior).
              </p>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.notifyOnBackupFailure}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, notifyOnBackupFailure: e.target.checked } : prev
                    )
                  }
                />
                Notificar falhas de backup
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.notifyWhatsappEnabled}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, notifyWhatsappEnabled: e.target.checked } : prev
                    )
                  }
                />
                Enviar WhatsApp
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Telefones WhatsApp (um por linha)</span>
                <textarea
                  className="input min-h-24 w-full"
                  value={settings.notifyWhatsappPhones.join('\n')}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifyWhatsappPhones: e.target.value
                              .split('\n')
                              .map((line) => line.trim())
                              .filter(Boolean),
                          }
                        : prev
                    )
                  }
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.notifyEmailEnabled}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, notifyEmailEnabled: e.target.checked } : prev
                    )
                  }
                />
                Enviar email
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Emails (um por linha)</span>
                <textarea
                  className="input min-h-24 w-full"
                  value={settings.notifyEmailAddresses.join('\n')}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev
                        ? {
                            ...prev,
                            notifyEmailAddresses: e.target.value
                              .split('\n')
                              .map((line) => line.trim())
                              .filter(Boolean),
                          }
                        : prev
                    )
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Actualização do dashboard (segundos)</span>
                <select
                  className="input w-full max-w-xs"
                  value={settings.dashboardRefreshSeconds}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, dashboardRefreshSeconds: Number(e.target.value) } : prev
                    )
                  }
                >
                  {VIRTUALIZATION_DASHBOARD_REFRESH_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} s
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Refresh visual com cache no servidor. Pausa quando o separador está em background.
                </p>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Alertas de backup (minutos)</span>
                <select
                  className="input w-full max-w-xs"
                  value={settings.pollIntervalMinutes}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, pollIntervalMinutes: Number(e.target.value) } : prev
                    )
                  }
                >
                  {VIRTUALIZATION_POLL_INTERVAL_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} min
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button type="submit" className="btn-primary" disabled={busy}>
              Guardar definições
            </button>
          </form>
        </section>
      ) : null}

      <VirtualizationZerotierPanel />
    </div>
  );
}
