'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { DEFAULT_ADMIN_MGMT_ALERT_DAYS, WEB_ROUTES, formatWhatsappPhone, whatsappPhonesMatch } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';

const SETTINGS_TABS = [
  { id: 'seguradoras', label: 'Seguradoras' },
  { id: 'tipos', label: 'Tipos de produto' },
  { id: 'alertas', label: 'Alertas' },
  { id: 'notificacoes', label: 'Notificações' },
  { id: 'integracoes', label: 'Integrações' },
  { id: 'pin', label: 'PIN de Segurança' },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

interface NotificationStatus {
  emailConfigured: boolean;
  whatsappConnected: boolean;
  whatsappPhone: string | null;
}

function StringListEditor({
  description,
  items,
  onChange,
  placeholder,
}: {
  description?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');

  function addItem() {
    const value = draft.trim();
    if (!value || items.some((i) => i.toLowerCase() === value.toLowerCase())) return;
    onChange([...items, value]);
    setDraft('');
  }

  return (
    <div className="space-y-2">
      {description && <p className="text-sm text-slate-500">{description}</p>}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addItem();
            }
          }}
        />
        <button type="button" className="btn-secondary shrink-0" onClick={addItem}>
          Adicionar
        </button>
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-2">
        {items.length === 0 && <li className="text-xs text-slate-400">Lista vazia</li>}
        {items.map((item) => (
          <li key={item} className="flex items-center justify-between gap-2 text-sm">
            <span>{item}</span>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
              onClick={() => onChange(items.filter((i) => i !== item))}
              aria-label={`Remover ${item}`}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <p className="text-xs text-slate-400">{items.length} item{items.length === 1 ? '' : 's'}</p>
      )}
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {label}
    </span>
  );
}

export function AdminMgmtSettingsPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('seguradoras');
  const [defaultAlertDays, setDefaultAlertDays] = useState(DEFAULT_ADMIN_MGMT_ALERT_DAYS);
  const [defaultResponsavel, setDefaultResponsavel] = useState('');
  const [alertEmail, setAlertEmail] = useState('');
  const [alertPhone, setAlertPhone] = useState('');
  const [seguradoras, setSeguradoras] = useState<string[]>([]);
  const [tiposProduto, setTiposProduto] = useState<string[]>([]);
  const [syncFromMoloni, setSyncFromMoloni] = useState(false);
  const [syncMoloniMarkPaidOnReceipt, setSyncMoloniMarkPaidOnReceipt] = useState(true);
  const [securityPinConfigured, setSecurityPinConfigured] = useState(false);
  const [securityPin, setSecurityPin] = useState('');
  const [clearSecurityPin, setClearSecurityPin] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'email' | 'whatsapp' | 'both' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function loadNotificationStatus() {
    if (!workspaceId) return;
    apiFetch<NotificationStatus>(
      withWorkspaceQuery(API_PATHS.adminMgmt.notificationsStatus, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setNotificationStatus(res.data);
    });
  }

  useEffect(() => {
    if (!workspaceId) return;
    apiFetch<{
      defaultAlertDays: number;
      defaultResponsavel: string | null;
      alertEmail: string | null;
      alertPhone: string | null;
      seguradoras: string[];
      tiposProduto: string[];
      syncFromMoloni?: boolean;
      syncMoloniMarkPaidOnReceipt?: boolean;
      securityPinConfigured?: boolean;
    }>(withWorkspaceQuery(API_PATHS.adminMgmt.settings, workspaceId), {}, getStoredToken()).then((res) => {
      if (res.data) {
        setDefaultAlertDays(res.data.defaultAlertDays);
        setDefaultResponsavel(res.data.defaultResponsavel ?? '');
        setAlertEmail(res.data.alertEmail ?? '');
        setAlertPhone(res.data.alertPhone ?? '');
        setSeguradoras(res.data.seguradoras ?? []);
        setTiposProduto(res.data.tiposProduto ?? []);
        setSyncFromMoloni(res.data.syncFromMoloni === true);
        setSyncMoloniMarkPaidOnReceipt(res.data.syncMoloniMarkPaidOnReceipt !== false);
        setSecurityPinConfigured(res.data.securityPinConfigured === true);
      }
    });
    loadNotificationStatus();
  }, [workspaceId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    setMessage('');
    const body: Record<string, unknown> = {
      workspaceId,
      defaultAlertDays,
      defaultResponsavel: defaultResponsavel.trim() || null,
      alertEmail: alertEmail.trim() || null,
      alertPhone: alertPhone.trim() || null,
      seguradoras,
      tiposProduto,
      syncFromMoloni,
      syncMoloniMarkPaidOnReceipt,
    };
    if (activeTab === 'pin') {
      if (clearSecurityPin) {
        body.clearSecurityPin = true;
      } else if (securityPin.trim()) {
        body.securityPin = securityPin.trim();
      }
    }
    const res = await apiFetch(
      API_PATHS.adminMgmt.settings,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
      getStoredToken()
    );
    setSaving(false);
    if (res.success) {
      setMessage('Configurações guardadas.');
      setSecurityPin('');
      setClearSecurityPin(false);
      if (activeTab === 'pin') {
        const pinRes = await apiFetch<{ securityPinConfigured?: boolean }>(
          withWorkspaceQuery(API_PATHS.adminMgmt.settings, workspaceId),
          {},
          getStoredToken()
        );
        if (pinRes.data) setSecurityPinConfigured(pinRes.data.securityPinConfigured === true);
      }
    } else setError(getApiErrorMessage(res));
  }

  async function sendTest(channel: 'email' | 'whatsapp' | 'both') {
    if (!workspaceId) return;
    if (channel !== 'whatsapp' && !alertEmail.trim()) {
      setError('Indique o email de destino.');
      return;
    }
    if (channel !== 'email' && !alertPhone.trim()) {
      setError('Indique o telefone de destino.');
      return;
    }

    setTesting(channel);
    setError('');
    setMessage('');

    const res = await apiFetch<{
      email?: { sent: boolean; error?: string };
      whatsapp?: { sent: boolean; error?: string; warning?: string; normalizedTo?: string; selfSend?: boolean };
    }>(
      API_PATHS.adminMgmt.notificationsTest,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          ...(channel !== 'whatsapp' ? { email: alertEmail.trim() } : {}),
          ...(channel !== 'email' ? { phone: alertPhone.trim() } : {}),
        }),
      },
      getStoredToken()
    );

    setTesting(null);
    if (res.success) {
      const parts: string[] = [];
      if (res.data?.email?.sent) parts.push('email enviado');
      if (res.data?.whatsapp?.sent) {
        const target = res.data.whatsapp.normalizedTo
          ? ` para +${res.data.whatsapp.normalizedTo}`
          : '';
        parts.push(`WhatsApp enviado${target}`);
      }
      const warning = res.data?.whatsapp?.warning;
      if (warning) {
        setMessage(`${parts.join(' e ') || 'Teste concluído'}. ${warning}`);
      } else {
        setMessage(parts.length > 0 ? `Teste OK — ${parts.join(' e ')}.` : (res.message ?? 'Teste enviado.'));
      }
      loadNotificationStatus();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  const selfSendWarning =
    notificationStatus?.whatsappConnected &&
    notificationStatus.whatsappPhone &&
    alertPhone.trim() &&
    whatsappPhonesMatch(alertPhone, notificationStatus.whatsappPhone)
      ? 'Este número é o mesmo ligado ao WhatsApp do sistema. A mensagem pode aparecer em «Mensagens para si» sem notificação — para testar alertas reais, use outro telefone.'
      : null;

  if (!workspaceId) return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;

  return (
    <form onSubmit={(e) => void submit(e)} className="card max-w-lg">
      <h2 className="text-lg font-semibold text-slate-900">Configurações</h2>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-100 pb-3">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${
              activeTab === tab.id
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-[280px]">
        {activeTab === 'seguradoras' && (
          <StringListEditor
            description="Lista usada no formulário de seguros."
            items={seguradoras}
            onChange={setSeguradoras}
            placeholder="Nome da seguradora"
          />
        )}

        {activeTab === 'tipos' && (
          <StringListEditor
            description="Inclua «Automóvel» para activar o campo matrícula (XX-XX-XX)."
            items={tiposProduto}
            onChange={setTiposProduto}
            placeholder="Ex.: Automóvel"
          />
        )}

        {activeTab === 'alertas' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Dias de antecedência para gerar alertas nos vencimentos criados automaticamente.
            </p>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Dias de antecedência (alerta)</label>
              <input
                className="input"
                type="number"
                min={0}
                max={365}
                value={defaultAlertDays}
                onChange={(e) => setDefaultAlertDays(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Responsável por defeito</label>
              <input
                className="input"
                value={defaultResponsavel}
                onChange={(e) => setDefaultResponsavel(e.target.value)}
                placeholder="Nome ou email interno"
              />
            </div>
          </div>
        )}

        {activeTab === 'notificacoes' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Destinatários para alertas de vencimentos. Use os botões abaixo para testar antes de activar envios
              automáticos.
            </p>

            {notificationStatus && (
              <div className="flex flex-wrap gap-2">
                <StatusBadge
                  ok={notificationStatus.emailConfigured}
                  label={notificationStatus.emailConfigured ? 'SMTP configurado' : 'SMTP em falta'}
                />
                <StatusBadge
                  ok={notificationStatus.whatsappConnected}
                  label={
                    notificationStatus.whatsappConnected
                      ? `WhatsApp ligado${notificationStatus.whatsappPhone ? ` (${notificationStatus.whatsappPhone})` : ''}`
                      : 'WhatsApp desligado'
                  }
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm text-slate-600">Email de destino</label>
              <input
                className="input"
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                placeholder="alertas@empresa.pt"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Telefone WhatsApp</label>
              <input
                className="input"
                value={alertPhone}
                onChange={(e) => setAlertPhone(e.target.value)}
                placeholder="+351912345678"
              />
              {alertPhone.trim() && (
                <p className="mt-1 text-xs text-slate-400">
                  Será enviado para {formatWhatsappPhone(alertPhone) || alertPhone.trim()}
                </p>
              )}
              {selfSendWarning && (
                <p className="mt-2 text-xs text-amber-700">{selfSendWarning}</p>
              )}
            </div>

            <p className="text-xs text-slate-500">
              Pré-requisitos:{' '}
              <Link href={WEB_ROUTES.dashboard.settings.smtp} className="text-[var(--color-primary)] hover:underline">
                SMTP
              </Link>
              {' · '}
              <Link
                href={WEB_ROUTES.dashboard.settings.whatsapp}
                className="text-[var(--color-primary)] hover:underline"
              >
                WhatsApp
              </Link>
            </p>

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={testing !== null || !alertEmail.trim()}
                onClick={() => void sendTest('email')}
              >
                {testing === 'email' ? 'A enviar…' : 'Testar email'}
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={testing !== null || !alertPhone.trim()}
                onClick={() => void sendTest('whatsapp')}
              >
                {testing === 'whatsapp' ? 'A enviar…' : 'Testar WhatsApp'}
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={testing !== null || !alertEmail.trim() || !alertPhone.trim()}
                onClick={() => void sendTest('both')}
              >
                {testing === 'both' ? 'A enviar…' : 'Testar ambos'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'integracoes' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Quando o módulo Facturação (Moloni) estiver activo, cada documento emitido pode ser espelhado
              automaticamente nesta Gestão Administrativa.
            </p>
            <label className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={syncFromMoloni}
                onChange={(e) => setSyncFromMoloni(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">Sincronizar emissões Moloni</span>
                <span className="block text-xs text-slate-500">
                  Cria cliente e fatura em Gestão Administrativa após emitir no Moloni.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={syncMoloniMarkPaidOnReceipt}
                onChange={(e) => setSyncMoloniMarkPaidOnReceipt(e.target.checked)}
                disabled={!syncFromMoloni}
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">Marcar faturas-recibo como pagas</span>
                <span className="block text-xs text-slate-500">
                  Faturas-recibo e recibos ficam com estado «pago» na importação Moloni.
                </span>
              </span>
            </label>
          </div>
        )}

        {activeTab === 'pin' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              PIN numérico exigido para reverter faturas pagas para o estado pendente. O valor é guardado de forma
              encriptada e nunca é mostrado novamente.
            </p>
            <div className="flex items-center gap-2">
              <StatusBadge
                ok={securityPinConfigured}
                label={securityPinConfigured ? 'PIN definido' : 'PIN não definido'}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">
                {securityPinConfigured ? 'Novo PIN (deixe vazio para manter)' : 'PIN de Segurança *'}
              </label>
              <input
                className="input max-w-xs font-mono tracking-widest"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={securityPin}
                onChange={(e) => {
                  setSecurityPin(e.target.value.replace(/\D/g, '').slice(0, 12));
                  setClearSecurityPin(false);
                }}
                placeholder="4 a 12 dígitos"
              />
            </div>
            {securityPinConfigured && (
              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={clearSecurityPin}
                  onChange={(e) => {
                    setClearSecurityPin(e.target.checked);
                    if (e.target.checked) setSecurityPin('');
                  }}
                />
                <span>Remover PIN actual</span>
              </label>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 space-y-3 border-t border-slate-100 pt-4">
        {message && <p className="text-sm text-green-700">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'A guardar…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}
