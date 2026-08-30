'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  MYPRIO_SYNC_SCOPE_LABELS,
  PORTAL_CONNECTION_STATUS_LABELS,
  PORTAL_KIND_LABELS,
  type MyPrioSyncScope,
  type PortalConnectionPublic,
  type PortalKind,
  type UberSyncOptions,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';
import { AntiAutofillInput, AutofillDecoys } from '@/components/anti-autofill';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { UberSyncModal } from '@/components/uber/uber-sync-modal';
import { UberBotChallengeModal } from '@/components/portal/uber-bot-challenge-modal';

type PanelPhase =
  | 'idle'
  | 'connecting'
  | 'awaiting_otp'
  | 'submitting_otp'
  | 'awaiting_password'
  | 'submitting_password'
  | 'syncing';

function isPasswordChallenge(c: PortalConnectionPublic | null | undefined): boolean {
  if (!c) return false;
  if (c.authChallenge === 'password') return true;
  return /OTP OK|password|palavra-?passe/i.test(c.otpHint ?? '');
}

function humanizePortalError(raw: string | null | undefined): string {
  if (!raw) return '';
  if (
    /unsupported state or unable to authenticate data|unable to authenticate data/i.test(raw) ||
    /Password guardada ilegível|Sessão guardada ilegível|Utilizador guardado ilegível|chave de encriptação mudou/i.test(
      raw
    )
  ) {
    if (/Sessão guardada ilegível/i.test(raw)) {
      return 'Sessão guardada ilegível (chave de encriptação mudou). Volte a Ligar conta.';
    }
    if (/Utilizador guardado ilegível/i.test(raw)) {
      return (
        'Utilizador guardado ilegível (chave de encriptação mudou). ' +
        'Introduza o utilizador de novo e volte a Ligar conta.'
      );
    }
    return (
      'Password guardada ilegível (chave de encriptação mudou). ' +
      'Clique em «Esquecer password» e volte a Ligar conta com a password correcta.'
    );
  }
  if (/Executable doesn't exist|playwright install|chromium_headless_shell|Browser Playwright em falta/i.test(raw)) {
    return (
      'Browser Playwright em falta no servidor (a API tenta reinstalar no arranque). ' +
      'Se persistir: npm run playwright:install + reiniciar a API, depois «Ligar conta».'
    );
  }
  if (/Dependências do Chromium|shared libraries|libatk|libgbm|playwright:libs/i.test(raw)) {
    return (
      'Dependências do Chromium em falta. No servidor: npm run playwright:libs e reinicie a API.'
    );
  }
  if (/Fontes do sistema em falta|Fontconfig|Could not find any font/i.test(raw)) {
    return 'Fontes em falta para o Chromium. No servidor: npm run playwright:libs e reinicie a API.';
  }
  if (/Display gráfico em falta|Missing X server/i.test(raw)) {
    return 'Display gráfico em falta (Arkose headed). Confirme DISPLAY/XAUTHORITY e reinicie a API.';
  }
  if (/PORTAL_RPA_ENABLED/i.test(raw)) {
    return 'Portal RPA desactivado (PORTAL_RPA_ENABLED=false).';
  }
  // Mensagens nossas Sync Uber — mostrar limpas (não genericizar)
  if (/^Sync Uber:/i.test(raw.trim()) || /Sync Uber:/i.test(raw)) {
    const cleaned = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
    return cleaned.length > 360 ? `${cleaned.slice(0, 357)}…` : cleaned;
  }
  if (/Timeout .* exceeded|waiting for locator|Call log:/i.test(raw)) {
    if (/botão «Gerar»|Gerar» não apareceu|continua desactivado/i.test(raw)) {
      return raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
    }
    if (/passkey-login-btn|chave de acesso|continuar com uma chave|intercepts pointer/i.test(raw)) {
      return 'Login Uber ficou no ecrã de chave de acesso (passkey). Precisa Ligar conta outra vez e usar «Enviar código por SMS» + password — não a chave de acesso.';
    }
    if (/atividade do motorista/i.test(raw)) {
      return 'Sync Uber: não abri o dropdown «Tipo de relatório» (Atividade do motorista). Tente Gerar outra vez.';
    }
    if (/name:\s*\/\^gerar\$|getByRole\('button',\s*\{\s*name:\s*\/\^gerar/i.test(raw)) {
      return 'Sync Uber: o botão «Gerar» do modal não apareceu (tipo/intervalo/organização). Tente Gerar outra vez.';
    }
    if (/transação de pagamentos|tipo de relatório|report type|option|organiz/i.test(raw)) {
      return 'Sync Uber falhou no modal Relatórios (tipo/organização). Tente Sincronizar outra vez.';
    }
    if (/not enabled|element is not enabled/i.test(raw)) {
      return 'O campo Uber ficou desactivado (WebAuthn/passkey). Tente Ligar conta outra vez.';
    }
    if (/Login Uber|Login Via|MyPRIO|formulário/i.test(raw)) {
      const cleaned = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
      return cleaned.length > 360 ? `${cleaned.slice(0, 357)}…` : cleaned;
    }
    return 'Timeout no portal (elemento não visível a tempo). Se a conta está Ligada, tente Sincronizar; senão Ligar conta outra vez.';
  }
  // Remover sequências ANSI / call logs longos
  const cleaned = raw
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 320 ? `${cleaned.slice(0, 317)}…` : cleaned;
}

function isInfraPortalError(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /Browser Playwright em falta|Executable doesn't exist|playwright install|chromium_headless_shell|Dependências do Chromium|shared libraries|libatk|libgbm|playwright:libs|Fontes do sistema|Fontconfig|Display gráfico em falta|Missing X server/i.test(
    raw
  );
}

function phaseMessage(phase: PanelPhase, portalLabel: string, syncLabel?: string): string | null {
  switch (phase) {
    case 'connecting':
      return `A ligar ${portalLabel}… pode demorar até 30–60s (browser no servidor).`;
    case 'awaiting_otp':
      return 'À espera do código OTP (SMS/email no telemóvel da conta).';
    case 'submitting_otp':
      return 'A validar o código OTP…';
    case 'awaiting_password':
      return 'OTP OK — introduza a password Uber.';
    case 'submitting_password':
      return 'A confirmar a password na Uber…';
    case 'syncing':
      return `A sincronizar ${syncLabel || portalLabel}… a descarregar dados do portal.`;
    default:
      return null;
  }
}

function statusDotClass(status: string): string {
  if (status === 'connected') return 'bg-emerald-500';
  if (status === 'error' || status === 'expired' || status === 'awaiting_otp') return 'bg-amber-500';
  return 'bg-red-500';
}

export function PortalConnectionPanel({
  portal,
  syncScope,
  onStatusChange,
}: {
  portal: PortalKind;
  /** MyPRIO: sync só Electric ou só Frota (páginas Eletricidade / Combustível). */
  syncScope?: MyPrioSyncScope;
  onStatusChange?: (status: PortalConnectionPublic) => void;
}) {
  const [connection, setConnection] = useState<PortalConnectionPublic | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<PanelPhase>('idle');
  const [connectOpen, setConnectOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passkeyOpen, setPasskeyOpen] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const [uberSyncOpen, setUberSyncOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  /** Quando true e hasPassword: Ligar sem pedir password */
  const [useStoredCredentials, setUseStoredCredentials] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const portalLabel = PORTAL_KIND_LABELS[portal];
  const syncLabel = syncScope ? MYPRIO_SYNC_SCOPE_LABELS[syncScope] : portalLabel;
  const syncButtonLabel = syncScope ? `Sincronizar ${syncLabel}` : 'Sincronizar';
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** Evita sair do spinner «A ligar…» com lastError/lastJobMessage de uma falha anterior. */
  const sawJobThisConnectRef = useRef(false);

  const load = useCallback(async (opts?: { preserveSubmittingOtp?: boolean }) => {
    const res = await apiFetch<PortalConnectionPublic>(
      API_PATHS.portalConnections.byPortal(portal),
      {},
      getStoredToken()
    );
    if (res.success && res.data) {
      setConnection(res.data);
      if (res.data.status === 'connected') {
        setError('');
      }
      if (res.data.status === 'awaiting_otp') {
        setConnectOpen(false);
        // Não sobrescrever submitting_otp — senão o loader do modal desaparece
        if (
          !opts?.preserveSubmittingOtp &&
          phaseRef.current !== 'submitting_otp' &&
          phaseRef.current !== 'submitting_password'
        ) {
          if (isPasswordChallenge(res.data)) {
            setPhase('awaiting_password');
          } else {
            setPhase('awaiting_otp');
          }
        }
        if (res.data.authChallenge === 'bot') {
          setBotOpen(true);
          setPasskeyOpen(false);
          setOtpOpen(false);
          setPasswordOpen(false);
        } else if (res.data.authChallenge === 'passkey' && res.data.challengeImageBase64) {
          setPasskeyOpen(true);
          setBotOpen(false);
          setOtpOpen(false);
          setPasswordOpen(false);
        } else if (isPasswordChallenge(res.data)) {
          setPasskeyOpen(false);
          setBotOpen(false);
          setOtpOpen(false);
          setPasswordOpen(true);
        } else {
          setPasskeyOpen(false);
          setBotOpen(false);
          setPasswordOpen(false);
          setOtpOpen(true);
        }
      }
      return res.data;
    }
    return null;
  }, [portal]);

  // onStatusChange só em eventos relevantes (não a cada poll)
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const lastNotifiedSyncAt = useRef<string | null>(null);
  /** Sobrevive a clearBusyUi prematuro — garante refresh da lista no fim do sync. */
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    void load();
  }, [load]);

  const jobInFlight = useMemo(() => {
    const s = connection?.activeJobStatus;
    return Boolean(s && s !== 'completed' && s !== 'failed');
  }, [connection?.activeJobStatus]);

  function clearBusyUi(options?: { keepError?: boolean }) {
    setPhase('idle');
    setBusy(false);
    setConnectOpen(false);
    setOtpOpen(false);
    setPasswordOpen(false);
    setPasskeyOpen(false);
    setBotOpen(false);
    setPassword('');
    setOtp('');
    if (!options?.keepError) setError('');
  }

  function notifyListRefresh(next: PortalConnectionPublic) {
    if (next.lastSyncAt) lastNotifiedSyncAt.current = next.lastSyncAt;
    onStatusChangeRef.current?.(next);
  }

  // Sucesso: fechar modais. Erro no OTP: fechar modal só depois do loader, manter erro no painel.
  useEffect(() => {
    if (!connection) return;
    if (connection.status === 'connected') {
      if (
        phase === 'connecting' ||
        phase === 'awaiting_otp' ||
        phase === 'submitting_otp' ||
        phase === 'awaiting_password' ||
        phase === 'submitting_password' ||
        otpOpen ||
        passwordOpen ||
        passkeyOpen ||
        botOpen
      ) {
        clearBusyUi();
      }
      return;
    }
    if (
      (connection.status === 'error' ||
        connection.activeJobStatus === 'failed' ||
        (phase === 'connecting' &&
          sawJobThisConnectRef.current &&
          !connection.activeJobId &&
          connection.status === 'disconnected' &&
          Boolean(connection.lastError || connection.lastJobMessage))) &&
      (phase === 'connecting' ||
        phase === 'submitting_otp' ||
        phase === 'awaiting_otp' ||
        phase === 'submitting_password' ||
        phase === 'awaiting_password')
    ) {
      const msg = humanizePortalError(connection.lastError || connection.lastJobMessage) || 'Operação falhou';
      setError(msg);
      setPhase('idle');
      setBusy(false);
      setConnectOpen(false);
      setOtpOpen(false);
      setPasswordOpen(false);
      setPasskeyOpen(false);
      setBotOpen(false);
      setOtp('');
      sawJobThisConnectRef.current = false;
    }
  }, [connection, otpOpen, passwordOpen, passkeyOpen, botOpen, phase]);

  useEffect(() => {
    if (phase === 'connecting' && connection?.activeJobId) {
      sawJobThisConnectRef.current = true;
    }
  }, [phase, connection?.activeJobId]);

  useEffect(() => {
    const shouldPoll =
      busy ||
      phase === 'connecting' ||
      phase === 'awaiting_otp' ||
      phase === 'submitting_otp' ||
      phase === 'awaiting_password' ||
      phase === 'submitting_password' ||
      phase === 'syncing' ||
      syncInFlightRef.current ||
      jobInFlight;
    if (!shouldPoll) return;

    const timer = setInterval(() => {
      void (async () => {
        const next = await load({
          preserveSubmittingOtp:
            phaseRef.current === 'submitting_otp' || phaseRef.current === 'submitting_password',
        });
        if (!next) return;
        const currentPhase = phaseRef.current;

        // OTP validado → password: sair do spinner OTP e abrir modal password
        if (
          currentPhase === 'submitting_otp' &&
          next.status === 'awaiting_otp' &&
          isPasswordChallenge(next)
        ) {
          setPhase('awaiting_password');
          setBusy(false);
          setOtpOpen(false);
          setOtp('');
          setPasswordOpen(true);
          setPasskeyOpen(false);
          setBotOpen(false);
          return;
        }

        if (
          next.status === 'awaiting_otp' &&
          currentPhase !== 'submitting_otp' &&
          currentPhase !== 'submitting_password'
        ) {
          if (isPasswordChallenge(next)) {
            setPhase('awaiting_password');
            setBusy(false);
            setConnectOpen(false);
            setOtpOpen(false);
            setPasswordOpen(true);
            setPasskeyOpen(false);
            setBotOpen(false);
            return;
          }
          setPhase('awaiting_otp');
          setBusy(false);
          setConnectOpen(false);
          if (next.authChallenge === 'bot') {
            setBotOpen(true);
            setPasskeyOpen(false);
            setOtpOpen(false);
            setPasswordOpen(false);
          } else if (next.authChallenge === 'passkey' && next.challengeImageBase64) {
            setPasskeyOpen(true);
            setBotOpen(false);
            setOtpOpen(false);
            setPasswordOpen(false);
          } else {
            setPasskeyOpen(false);
            setBotOpen(false);
            setPasswordOpen(false);
            setOtpOpen(true);
          }
          return;
        }

        // Enquanto validamos OTP ou password, manter modal + loader
        if (currentPhase === 'submitting_otp' || currentPhase === 'submitting_password') {
          if (next.status === 'connected' || next.activeJobStatus === 'completed') {
            clearBusyUi();
            return;
          }
          if (next.activeJobStatus === 'failed' || next.status === 'error') {
            setError(
              humanizePortalError(next.lastError || next.lastJobMessage) ||
                (currentPhase === 'submitting_password' ? 'Password inválida' : 'OTP inválido')
            );
            setPhase(currentPhase === 'submitting_password' ? 'awaiting_password' : 'idle');
            setBusy(false);
            if (currentPhase === 'submitting_password') {
              setPasswordOpen(true);
            } else {
              setOtpOpen(false);
              setOtp('');
            }
          }
          return;
        }

        // Sync: só terminar quando o job acabou (não quando status=connected a meio)
        if (currentPhase === 'syncing' || syncInFlightRef.current) {
          if (next.activeJobStatus === 'running' || next.activeJobStatus === 'pending') {
            return;
          }

          if (next.activeJobStatus === 'failed' || next.status === 'error') {
            syncInFlightRef.current = false;
            setPhase('idle');
            setBusy(false);
            setError(
              humanizePortalError(next.lastError || next.lastJobMessage) || 'Sincronização falhou'
            );
            // Mesmo em falha parcial, refrescar lista (pode ter inserido algo)
            notifyListRefresh(next);
            return;
          }

          const syncFinished =
            next.activeJobStatus === 'completed' ||
            (Boolean(next.lastSyncAt) &&
              next.lastSyncAt !== lastNotifiedSyncAt.current &&
              !next.activeJobId);

          if (syncFinished) {
            syncInFlightRef.current = false;
            clearBusyUi();
            notifyListRefresh(next);
            return;
          }

          return;
        }

        if (
          next.status === 'connected' &&
          (currentPhase === 'connecting' ||
            currentPhase === 'awaiting_otp' ||
            currentPhase === 'awaiting_password')
        ) {
          clearBusyUi();
          return;
        }
      })();
    }, 1000);
    return () => clearInterval(timer);
  }, [busy, phase, jobInFlight, load]);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setPhase('connecting');
    setError('');
    sawJobThisConnectRef.current = false;
    const body = useStoredCredentials
      ? { useStoredCredentials: true as const }
      : { username, password };
    const res = await apiFetch(
      API_PATHS.portalConnections.connect(portal),
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      getStoredToken()
    );
    if (!res.success) {
      setBusy(false);
      setPhase('idle');
      setError(humanizePortalError(res.error) || 'Falha ao ligar');
      return;
    }
    // Mantém modal aberto com loader até o job terminar / pedir OTP
    await load();
  }

  async function handleForgetPassword() {
    const ok = await confirm({
      title: 'Esquecer password',
      message: `Remover a password guardada de ${portalLabel}? O utilizador e a sessão (se existir) mantêm-se. No próximo login terá de introduzir a password.`,
      confirmLabel: 'Esquecer',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.portalConnections.forgetPassword(portal),
      { method: 'POST', body: JSON.stringify({}) },
      getStoredToken()
    );
    setBusy(false);
    if (!res.success) {
      setError(humanizePortalError(res.error) || 'Não foi possível esquecer a password');
      return;
    }
    setUseStoredCredentials(false);
    setPassword('');
    await load();
  }

  async function handleOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setPhase('submitting_otp');
    setError('');
    const res = await apiFetch(
      API_PATHS.portalConnections.otp(portal),
      { method: 'POST', body: JSON.stringify({ code: otp }) },
      getStoredToken()
    );
    if (!res.success) {
      setBusy(false);
      setPhase('awaiting_otp');
      setError(humanizePortalError(res.error) || 'OTP inválido');
      return;
    }
    // Manter modal + loader; o poll fecha quando o job terminar
    await load({ preserveSubmittingOtp: true });
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setPhase('submitting_password');
    setError('');
    const res = await apiFetch(
      API_PATHS.portalConnections.password(portal),
      { method: 'POST', body: JSON.stringify({ password }) },
      getStoredToken()
    );
    if (!res.success) {
      setBusy(false);
      setPhase('awaiting_password');
      setError(humanizePortalError(res.error) || 'Password inválida');
      return;
    }
    await load({ preserveSubmittingOtp: true });
  }

  async function handleSync(uberSync?: UberSyncOptions) {
    setBusy(true);
    setPhase('syncing');
    syncInFlightRef.current = true;
    setError('');
    setUberSyncOpen(false);
    const body: { syncScope?: MyPrioSyncScope; uberSync?: UberSyncOptions } = {};
    if (syncScope) body.syncScope = syncScope;
    if (uberSync) body.uberSync = uberSync;
    const res = await apiFetch(
      API_PATHS.portalConnections.sync(portal),
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      getStoredToken()
    );
    if (!res.success) {
      syncInFlightRef.current = false;
      setBusy(false);
      setPhase('idle');
      setError(humanizePortalError(res.error) || 'Falha na sincronização');
      return;
    }
    await load();
  }

  function onSyncClick() {
    if (portal === 'uber') {
      setError('');
      setUberSyncOpen(true);
      return;
    }
    void handleSync();
  }

  async function handleDisconnect() {
    const ok = await confirm({
      title: `Desligar ${portalLabel}`,
      message: `Desligar a conta ${portalLabel}? Password e sessão do browser são removidas — o próximo Ligar pede login completo (com SMS se o portal exigir). Para remover só a password e manter a sessão, use «Esquecer password».`,
      confirmLabel: 'Desligar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.portalConnections.disconnect(portal),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy(false);
    setPhase('idle');
    if (!res.success) {
      setError(humanizePortalError(res.error) || 'Falha ao desligar');
      return;
    }
    setConnectOpen(false);
    setOtpOpen(false);
    await load();
  }

  async function handleClearMessages() {
    setBusy(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.portalConnections.clearMessages(portal),
      { method: 'POST', body: JSON.stringify({}) },
      getStoredToken()
    );
    setBusy(false);
    if (!res.success) {
      setError(humanizePortalError(res.error) || 'Não foi possível limpar a mensagem');
      return;
    }
    await load();
  }

  async function handleAutoSync(nextEnabled: boolean) {
    if (!connection) return;
    setError('');
    const previous = connection.autoSyncEnabled;
    setConnection({ ...connection, autoSyncEnabled: nextEnabled });
    const res = await apiFetch<PortalConnectionPublic>(
      API_PATHS.portalConnections.autoSync(portal),
      {
        method: 'PATCH',
        body: JSON.stringify({ autoSyncEnabled: nextEnabled }),
      },
      getStoredToken()
    );
    if (!res.success) {
      setConnection({ ...connection, autoSyncEnabled: previous });
      setError(humanizePortalError(res.error) || 'Não foi possível actualizar a sincronização automática');
      return;
    }
    if (res.data) {
      setConnection(res.data);
      onStatusChange?.(res.data);
    }
  }

  const status = connection?.status ?? 'disconnected';
  const statusLabel = PORTAL_CONNECTION_STATUS_LABELS[status];
  const rpaOff = connection && !connection.rpaEnabled;
  const loadingMsg = phaseMessage(phase, portalLabel, syncLabel);
  const showPanelLoader =
    busy ||
    jobInFlight ||
    phase === 'awaiting_otp' ||
    phase === 'awaiting_password';
  const persistentError =
    connection?.lastError ||
    (connection?.activeJobStatus === 'failed' ? connection.lastJobMessage : null) ||
    null;
  // Erros de infra ficam no banner browserReady — não misturar com estado da conta
  const showPersistentError =
    Boolean(persistentError) &&
    !error &&
    !showPanelLoader &&
    !isInfraPortalError(persistentError);

  return (
    <div className="card space-y-3">
      {confirmDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Conta {portalLabel}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDotClass(status)}`}
              aria-hidden
            />
            <span>
              Estado: <span className="font-medium text-slate-700">{statusLabel}</span>
              {connection?.usernameMasked ? ` · ${connection.usernameMasked}` : null}
              {connection?.hasPassword
                ? connection.passwordNeedsResave
                  ? ' · password ilegível'
                  : ' · password guardada'
                : null}
            </span>
          </p>
          {connection?.lastSyncAt ? (
            <p className="mt-0.5 text-xs text-slate-400">
              Último sync: {new Date(connection.lastSyncAt).toLocaleString('pt-PT')}
            </p>
          ) : null}
          {connection?.usernameMasked ||
            connection?.hasPassword ||
            connection?.hasSession ||
            status !== 'disconnected') ? (
            <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(connection?.autoSyncEnabled)}
                disabled={busy || !!rpaOff}
                onChange={(e) => void handleAutoSync(e.target.checked)}
              />
              <span>
                <span className="font-medium">Sincronização automática diária</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {portal === 'myprio'
                    ? 'Corre 1× por dia (~06:00 Lisboa) com a conta ligada. O sync manual mantém-se. Se a sessão expirar, o MyPRIO pede OTP — volte a Ligar conta.'
                    : portal === 'uber'
                      ? 'Corre 1× por dia (~06:00 Lisboa) com a conta ligada. O sync manual mantém-se. Se a sessão expirar, tenta re-login automático; se a Uber pedir SMS OTP, volte a Ligar conta.'
                      : 'Corre 1× por dia (~06:00 Lisboa) com a conta ligada. O sync manual mantém-se. Se a sessão expirar, tenta religar com as credenciais guardadas.'}
                </span>
              </span>
            </label>
          ) : null}
          {connection?.browserReady === false && !connection.mockMode ? (
            <p className="mt-1 text-xs text-amber-700">
              Browser indisponível no servidor
              {connection.browserDetail
                ? ` — ${humanizePortalError(connection.browserDetail)}`
                : '. A API tenta reparar no arranque; se persistir: npm run playwright:install / playwright:libs e reinicie a API.'}
            </p>
          ) : null}
          {connection?.status === 'connected' && connection.activeJobStatus === 'completed' && connection.lastJobMessage ? (
            <p className="mt-1 text-xs text-emerald-700">{connection.lastJobMessage}</p>
          ) : null}
          {showPersistentError ? (
            <div className="mt-1 flex items-start gap-2">
              <p className="flex-1 text-xs text-amber-700">
                {connection?.activeJobStatus === 'failed' && connection.lastJobMessage
                  ? `Último sync: ${humanizePortalError(connection.lastJobMessage)}`
                  : humanizePortalError(persistentError)}
              </p>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {connection?.passwordNeedsResave ||
                /Password guardada ilegível|chave de encriptação/i.test(persistentError ?? '') ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                    title="Remover password ilegível e voltar a ligar"
                    disabled={busy}
                    onClick={() => void handleForgetPassword()}
                  >
                    Esquecer password
                  </button>
                ) : null}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-50"
                  title="Limpar mensagem de erro"
                  disabled={busy}
                  onClick={() => void handleClearMessages()}
                >
                  <X size={12} />
                  Limpar
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === 'connected' || status === 'error' || status === 'expired' ? (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2 text-sm"
              disabled={busy || !!rpaOff || jobInFlight}
              onClick={() => onSyncClick()}
            >
              {phase === 'syncing' ? <Loader2 size={14} className="animate-spin" /> : null}
              {syncButtonLabel}
            </button>
          ) : null}
          {status === 'awaiting_otp' ? (
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => {
                if (connection?.authChallenge === 'bot') {
                  setBotOpen(true);
                } else if (connection?.authChallenge === 'passkey' && connection.challengeImageBase64) {
                  setPasskeyOpen(true);
                } else if (isPasswordChallenge(connection)) {
                  setPasswordOpen(true);
                  setPhase('awaiting_password');
                } else {
                  setOtpOpen(true);
                }
              }}
            >
              {connection?.authChallenge === 'bot'
                ? 'Abrir desafio Uber'
                : connection?.authChallenge === 'passkey'
                  ? 'Abrir passkey'
                  : isPasswordChallenge(connection)
                    ? 'Introduzir password'
                    : 'Introduzir OTP'}
            </button>
          ) : null}
          {status === 'disconnected' || status === 'expired' || status === 'error' ? (
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={!!rpaOff || busy}
              onClick={() => {
                setError('');
                setUsername('');
                setPassword('');
                setUseStoredCredentials(
                  Boolean(connection?.hasPassword) && !connection?.passwordNeedsResave
                );
                setConnectOpen(true);
              }}
            >
              Ligar conta
            </button>
          ) : null}
          {connection?.hasPassword ? (
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={busy}
              onClick={() => void handleForgetPassword()}
            >
              Esquecer password
            </button>
          ) : null}
          {status !== 'disconnected' ? (
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={busy}
              onClick={() => void handleDisconnect()}
            >
              Desligar
            </button>
          ) : null}
        </div>
      </div>

      {showPanelLoader && loadingMsg ? (
        <div className="flex items-start gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-sky-600" />
          <div>
            <p className="font-medium">{loadingMsg}</p>
            {connection?.activeJobStatus ? (
              <p className="mt-0.5 text-xs text-sky-700/80">
                Job: {connection.activeJobStatus}
                {connection.otpHint ? ` · ${connection.otpHint}` : ''}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {rpaOff ? (
        <p className="text-xs text-amber-700">Portal RPA desactivado no servidor (PORTAL_RPA_ENABLED).</p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Modal
        open={connectOpen}
        onClose={() => {
          if (busy || phase === 'connecting') return;
          setConnectOpen(false);
        }}
        title={`Ligar ${portalLabel}`}
        showCloseButton={!busy && phase !== 'connecting'}
        closeOnBackdrop={!busy && phase !== 'connecting'}
        closeOnEscape={!busy && phase !== 'connecting'}
      >
        <form onSubmit={(e) => void handleConnect(e)} className="relative space-y-3" autoComplete="off">
          <AutofillDecoys />
          {phase === 'connecting' ? (
            <div className="flex items-start gap-3 rounded-md border border-sky-100 bg-sky-50 px-3 py-3 text-sm text-sky-900">
              <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-sky-600" />
              <div>
                <p className="font-medium">A autenticar no portal…</p>
                <p className="mt-1 text-xs text-sky-800/80">
                  {portal === 'uber' ? (
                    <>
                      O servidor autentica no browser em background. Se a Uber pedir SMS, aparece o modal OTP
                      (4 dígitos); a seguir usa a palavra-passe guardada. Pode demorar 30–60s.
                    </>
                  ) : (
                    <>
                      O servidor abre um browser em background (pode demorar 15–40s). Este popup fecha sozinho
                      quando a conta ficar Ligada ou se houver erro — não precisa de fazer refresh.
                    </>
                  )}
                </p>
              </div>
            </div>
          ) : null}
          {useStoredCredentials && connection?.hasPassword && !connection.passwordNeedsResave ? (
            <>
              <p className="text-sm text-slate-600">
                Credenciais guardadas (AES-256-GCM) para{' '}
                <span className="font-medium text-slate-800">
                  {connection.usernameMasked || portalLabel}
                </span>
                . Continuar sem voltar a digitar a password
                {portal === 'myprio' || portal === 'uber' ? ' — o portal pode pedir OTP SMS a seguir' : ''}.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <div className="flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    className="text-slate-600 underline-offset-2 hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => setUseStoredCredentials(false)}
                  >
                    Introduzir outra password
                  </button>
                  <button
                    type="button"
                    className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void handleForgetPassword()}
                  >
                    Esquecer password
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => setConnectOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                    {busy ? 'A ligar…' : 'Continuar'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {connection?.passwordNeedsResave ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Password guardada ilegível (chave de encriptação mudou). Use «Esquecer password» se
                  ainda constar, e volte a Ligar conta com a password correcta.
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                A password fica guardada encriptada neste tenant. Pode esquecê-la a qualquer momento.
              </p>
              <label className="block text-sm">
                <span className="text-slate-600">
                  {portal === 'via_verde'
                    ? 'Email'
                    : portal === 'uber'
                      ? 'Telefone ou email'
                      : portal === 'myprio'
                        ? 'Nº utilizador MyPRIO'
                        : 'Utilizador'}
                </span>
                <AntiAutofillInput
                  id={`portal-${portal}-username`}
                  name={`portal-${portal}-username`}
                  className="input mt-1 w-full"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  inputMode={portal === 'myprio' ? 'numeric' : undefined}
                  placeholder={portal === 'myprio' ? 'ex. 610871' : undefined}
                  disabled={busy}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">
                  {portal === 'uber' ? 'Password (se pedida)' : 'Password'}
                </span>
                <AntiAutofillInput
                  id={`portal-${portal}-secret`}
                  name={`portal-${portal}-secret`}
                  className="input mt-1 w-full"
                  maskAsPassword
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={portal !== 'uber'}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                {connection?.hasPassword ? (
                  <button
                    type="button"
                    className="text-xs text-slate-600 underline-offset-2 hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => setUseStoredCredentials(true)}
                  >
                    Usar password guardada
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => setConnectOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                    {busy ? 'A ligar…' : 'Ligar'}
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      </Modal>

      <UberBotChallengeModal
        open={botOpen}
        portal={portal}
        jobId={connection?.activeJobId ?? null}
        hint={connection?.otpHint}
        onCloseCancel={() => {
          setBotOpen(false);
          setPhase('idle');
          setBusy(false);
          void load();
        }}
        onChallengeCleared={() => {
          setBotOpen(false);
          void load();
        }}
      />

      <Modal
        open={passkeyOpen}
        onClose={() => setPasskeyOpen(false)}
        title="Passkey Uber"
        showCloseButton
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {connection?.otpHint ??
              'Digitalize o QR com o telemóvel (câmara ou gestor de passwords). O browser no servidor fica à espera.'}
          </p>
          {connection?.challengeImageBase64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/png;base64,${connection.challengeImageBase64}`}
              alt="QR passkey Uber"
              className="mx-auto max-h-[420px] w-auto rounded-md border border-slate-200 bg-white p-2"
            />
          ) : (
            <p className="text-sm text-amber-700">A capturar o ecrã passkey… atualize em instantes.</p>
          )}
          <p className="text-xs text-slate-500">
            Depois do passkey, a Uber pode pedir SMS (4 dígitos) — o modal OTP abre automaticamente. Timeout ~5
            min.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPasskeyOpen(false)}>
              Minimizar
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={otpOpen}
        onClose={() => {
          if (busy || phase === 'submitting_otp') return;
          setOtpOpen(false);
        }}
        title={
          portal === 'myprio' ? 'Código SMS MyPRIO' : portal === 'uber' ? 'Código SMS Uber' : 'Código OTP'
        }
        showCloseButton={!busy && phase !== 'submitting_otp'}
        closeOnBackdrop={!busy && phase !== 'submitting_otp'}
        closeOnEscape={!busy && phase !== 'submitting_otp'}
      >
        <form onSubmit={handleOtp} className="relative space-y-3" autoComplete="off">
          <AutofillDecoys />
          {phase === 'submitting_otp' ? (
            <div className="flex items-start gap-3 rounded-md border border-sky-100 bg-sky-50 px-3 py-3 text-sm text-sky-900">
              <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-sky-600" />
              <div>
                <p className="font-medium">
                  {portal === 'uber'
                    ? 'A validar o código SMS na Uber…'
                    : 'A validar o código SMS no MyPRIO…'}
                </p>
                <p className="mt-1 text-xs text-sky-800/80">
                  Este popup mantém-se aberto com o loader até o servidor responder (pode demorar 10–30s). Não
                  feche nem faça refresh.
                </p>
              </div>
            </div>
          ) : null}
          <p className="text-sm text-slate-600">
            {connection?.otpHint ??
              (portal === 'myprio'
                ? 'Introduza o código SMS de 6 dígitos (o portal MyPRIO expira em ~2 minutos).'
                : portal === 'uber'
                  ? 'Introduza o código SMS de 4 dígitos da Uber.'
                  : 'Introduza o código recebido por SMS ou email.')}
          </p>
          {(portal === 'myprio' || portal === 'uber') && phase !== 'submitting_otp' ? (
            <p className="text-xs text-amber-700">
              O browser no servidor mantém-se aberto à espera deste código. Se o SMS não chegar, Desligar → Ligar
              conta outra vez.
            </p>
          ) : null}
          {error && otpOpen ? <p className="text-sm text-red-600">{error}</p> : null}
          <AntiAutofillInput
            id={`portal-${portal}-otp`}
            name={`portal-${portal}-otp`}
            className="input w-full tracking-widest"
            value={otp}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '');
              if (portal === 'myprio') setOtp(digits.slice(0, 6));
              else if (portal === 'uber') setOtp(digits.slice(0, 4));
              else setOtp(e.target.value);
            }}
            placeholder={portal === 'myprio' ? '------' : portal === 'uber' ? '----' : undefined}
            inputMode={portal === 'myprio' || portal === 'uber' ? 'numeric' : undefined}
            maxLength={portal === 'myprio' ? 6 : portal === 'uber' ? 4 : undefined}
            pattern={portal === 'myprio' ? '[0-9]{6}' : portal === 'uber' ? '[0-9]{4}' : undefined}
            required
            autoComplete="one-time-code"
            disabled={busy}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setOtpOpen(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {busy ? 'A confirmar…' : 'Confirmar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={passwordOpen}
        onClose={() => {
          if (busy || phase === 'submitting_password') return;
          setPasswordOpen(false);
        }}
        title="Password Uber"
        showCloseButton={!busy && phase !== 'submitting_password'}
        closeOnBackdrop={!busy && phase !== 'submitting_password'}
        closeOnEscape={!busy && phase !== 'submitting_password'}
      >
        <form onSubmit={handlePassword} className="relative space-y-3" autoComplete="off">
          <AutofillDecoys />
          {phase === 'submitting_password' ? (
            <div className="flex items-start gap-3 rounded-md border border-sky-100 bg-sky-50 px-3 py-3 text-sm text-sky-900">
              <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-sky-600" />
              <div>
                <p className="font-medium">A confirmar a password na Uber…</p>
                <p className="mt-1 text-xs text-sky-800/80">
                  O browser no servidor preenche «Introduza a sua palavra-passe» e clica Seguinte.
                </p>
              </div>
            </div>
          ) : null}
          <p className="text-sm text-slate-600">
            {connection?.otpHint ??
              'OTP aceite. Introduza a password da conta Uber Supplier para concluir a ligação.'}
          </p>
          {error && passwordOpen ? <p className="text-sm text-red-600">{error}</p> : null}
          <AntiAutofillInput
            id={`portal-${portal}-post-otp-password`}
            name={`portal-${portal}-post-otp-password`}
            className="input w-full"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            disabled={busy}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setPasswordOpen(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {busy ? 'A confirmar…' : 'Confirmar'}
            </button>
          </div>
        </form>
      </Modal>

      {portal === 'uber' ? (
        <UberSyncModal
          open={uberSyncOpen}
          onClose={() => {
            if (busy) return;
            setUberSyncOpen(false);
          }}
          busy={busy && phase === 'syncing'}
          onSync={(uberSync) => handleSync(uberSync)}
        />
      ) : null}
    </div>
  );
}
