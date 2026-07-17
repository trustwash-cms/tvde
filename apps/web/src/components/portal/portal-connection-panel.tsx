'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  MYPRIO_SYNC_SCOPE_LABELS,
  PORTAL_CONNECTION_STATUS_LABELS,
  PORTAL_KIND_LABELS,
  type MyPrioSyncScope,
  type PortalConnectionPublic,
  type PortalKind,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';
import { AntiAutofillInput, AutofillDecoys } from '@/components/anti-autofill';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

type PanelPhase = 'idle' | 'connecting' | 'awaiting_otp' | 'submitting_otp' | 'syncing';

function humanizePortalError(raw: string | null | undefined): string {
  if (!raw) return '';
  if (/Executable doesn't exist|playwright install|chromium_headless_shell/i.test(raw)) {
    return 'Browser Playwright em falta no servidor. No projecto, execute: npm run playwright:install — depois reinicie a API.';
  }
  if (/PORTAL_RPA_ENABLED/i.test(raw)) {
    return 'Portal RPA desactivado (PORTAL_RPA_ENABLED=false).';
  }
  if (/Timeout .* exceeded|waiting for locator|Call log:/i.test(raw)) {
    return 'Timeout no login do portal (campo do formulário não visível a tempo). Tente Ligar conta outra vez; se falhar, use o import manual.';
  }
  // Remover sequências ANSI / call logs longos
  const cleaned = raw
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 320 ? `${cleaned.slice(0, 317)}…` : cleaned;
}

function phaseMessage(phase: PanelPhase, portalLabel: string, syncLabel?: string): string | null {
  switch (phase) {
    case 'connecting':
      return `A ligar ${portalLabel}… pode demorar até 30s (browser no servidor).`;
    case 'awaiting_otp':
      return 'À espera do código OTP (SMS/email no telemóvel da conta).';
    case 'submitting_otp':
      return 'A validar o código OTP…';
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const { confirm, confirmDialog } = useConfirmDialog();

  const portalLabel = PORTAL_KIND_LABELS[portal];
  const syncLabel = syncScope ? MYPRIO_SYNC_SCOPE_LABELS[syncScope] : portalLabel;
  const syncButtonLabel = syncScope ? `Sincronizar ${syncLabel}` : 'Sincronizar';
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const load = useCallback(async (opts?: { preserveSubmittingOtp?: boolean }) => {
    const res = await apiFetch<PortalConnectionPublic>(
      API_PATHS.portalConnections.byPortal(portal),
      {},
      getStoredToken()
    );
    if (res.success && res.data) {
      setConnection(res.data);
      if (res.data.status === 'awaiting_otp') {
        setOtpOpen(true);
        setConnectOpen(false);
        // Não sobrescrever submitting_otp — senão o loader do modal desaparece
        if (!opts?.preserveSubmittingOtp && phaseRef.current !== 'submitting_otp') {
          setPhase('awaiting_otp');
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
      if (phase === 'connecting' || phase === 'awaiting_otp' || phase === 'submitting_otp' || otpOpen) {
        clearBusyUi();
      }
      return;
    }
    if (
      (connection.status === 'error' || connection.activeJobStatus === 'failed') &&
      (phase === 'connecting' || phase === 'submitting_otp')
    ) {
      const msg = humanizePortalError(connection.lastError || connection.lastJobMessage) || 'Operação falhou';
      setError(msg);
      setPhase('idle');
      setBusy(false);
      setConnectOpen(false);
      setOtpOpen(false);
      setOtp('');
    }
  }, [connection, otpOpen, phase]);

  useEffect(() => {
    const shouldPoll =
      busy ||
      phase === 'connecting' ||
      phase === 'awaiting_otp' ||
      phase === 'submitting_otp' ||
      phase === 'syncing' ||
      syncInFlightRef.current ||
      jobInFlight;
    if (!shouldPoll) return;

    const timer = setInterval(() => {
      void (async () => {
        const next = await load({ preserveSubmittingOtp: phaseRef.current === 'submitting_otp' });
        if (!next) return;
        const currentPhase = phaseRef.current;

        if (next.status === 'awaiting_otp' && currentPhase !== 'submitting_otp') {
          setPhase('awaiting_otp');
          setBusy(false);
          setConnectOpen(false);
          setOtpOpen(true);
          return;
        }

        // Enquanto validamos OTP, manter modal + loader
        if (currentPhase === 'submitting_otp') {
          if (next.status === 'connected' || next.activeJobStatus === 'completed') {
            clearBusyUi();
            return;
          }
          if (next.activeJobStatus === 'failed' || next.status === 'error') {
            setError(
              humanizePortalError(next.lastError || next.lastJobMessage) || 'OTP inválido'
            );
            setPhase('idle');
            setBusy(false);
            setOtpOpen(false);
            setOtp('');
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
          (currentPhase === 'connecting' || currentPhase === 'awaiting_otp')
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
    const res = await apiFetch(
      API_PATHS.portalConnections.connect(portal),
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
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

  async function handleSync() {
    setBusy(true);
    setPhase('syncing');
    syncInFlightRef.current = true;
    setError('');
    const res = await apiFetch(
      API_PATHS.portalConnections.sync(portal),
      {
        method: 'POST',
        body: JSON.stringify(syncScope ? { syncScope } : {}),
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

  async function handleDisconnect() {
    const ok = await confirm({
      title: `Desligar ${portalLabel}`,
      message: `Desligar a conta ${portalLabel}? Password e sessão do browser são removidas — o próximo Ligar pede login completo (com SMS se o portal exigir).`,
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

  const status = connection?.status ?? 'disconnected';
  const statusLabel = PORTAL_CONNECTION_STATUS_LABELS[status];
  const rpaOff = connection && !connection.rpaEnabled;
  const loadingMsg = phaseMessage(phase, portalLabel, syncLabel);
  const showPanelLoader = busy || jobInFlight || phase === 'awaiting_otp';

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
            </span>
          </p>
          {connection?.lastSyncAt ? (
            <p className="mt-0.5 text-xs text-slate-400">
              Último sync: {new Date(connection.lastSyncAt).toLocaleString('pt-PT')}
            </p>
          ) : null}
          {connection?.lastError && connection.status !== 'connected' && !error ? (
            <p className="mt-1 text-xs text-red-600">{humanizePortalError(connection.lastError)}</p>
          ) : null}
          {connection?.browserReady === false && !connection.mockMode ? (
            <p className="mt-1 text-xs text-amber-700">
              Chromium não detectado na API. Execute <code className="rounded bg-amber-100 px-1">npm run playwright:install</code> e reinicie a API.
            </p>
          ) : null}
          {connection?.status === 'connected' && connection.activeJobStatus === 'completed' && connection.lastJobMessage ? (
            <p className="mt-1 text-xs text-emerald-700">{connection.lastJobMessage}</p>
          ) : null}
          {connection?.status === 'connected' &&
          (connection.activeJobStatus === 'failed'
            ? connection.lastJobMessage
            : !connection.lastJobMessage && connection.lastError) ? (
            <p className="mt-1 text-xs text-amber-700">
              {humanizePortalError(
                connection.activeJobStatus === 'failed'
                  ? connection.lastJobMessage
                  : connection.lastError
              )}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === 'connected' || status === 'error' || status === 'expired' ? (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2 text-sm"
              disabled={busy || !!rpaOff || jobInFlight}
              onClick={() => void handleSync()}
            >
              {phase === 'syncing' ? <Loader2 size={14} className="animate-spin" /> : null}
              {syncButtonLabel}
            </button>
          ) : null}
          {status === 'awaiting_otp' ? (
            <button type="button" className="btn-primary text-sm" onClick={() => setOtpOpen(true)}>
              Introduzir OTP
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
                setConnectOpen(true);
              }}
            >
              Ligar conta
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
        <form onSubmit={handleConnect} className="relative space-y-3" autoComplete="off">
          <AutofillDecoys />
          {phase === 'connecting' ? (
            <div className="flex items-start gap-3 rounded-md border border-sky-100 bg-sky-50 px-3 py-3 text-sm text-sky-900">
              <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-sky-600" />
              <div>
                <p className="font-medium">A autenticar no portal…</p>
                <p className="mt-1 text-xs text-sky-800/80">
                  O servidor abre um browser em background (pode demorar 15–40s). Este popup fecha sozinho
                  quando a conta ficar Ligada ou se houver erro — não precisa de fazer refresh.
                </p>
              </div>
            </div>
          ) : null}
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
          <div className="flex justify-end gap-2 pt-2">
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
        </form>
      </Modal>

      <Modal
        open={otpOpen}
        onClose={() => {
          if (busy || phase === 'submitting_otp') return;
          setOtpOpen(false);
        }}
        title={portal === 'myprio' ? 'Código SMS MyPRIO' : 'Código OTP'}
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
                <p className="font-medium">A validar o código SMS no MyPRIO…</p>
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
                : 'Introduza o código recebido por SMS ou email.')}
          </p>
          {portal === 'myprio' && phase !== 'submitting_otp' ? (
            <p className="text-xs text-amber-700">
              O browser no servidor mantém-se aberto à espera deste código. Se expirar, Desligar → Ligar conta
              outra vez para receber SMS novo.
            </p>
          ) : null}
          {error && otpOpen ? <p className="text-sm text-red-600">{error}</p> : null}
          <AntiAutofillInput
            id={`portal-${portal}-otp`}
            name={`portal-${portal}-otp`}
            className="input w-full tracking-widest"
            value={otp}
            onChange={(e) =>
              setOtp(portal === 'myprio' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)
            }
            placeholder={portal === 'myprio' ? '------' : '123456'}
            inputMode={portal === 'myprio' ? 'numeric' : undefined}
            maxLength={portal === 'myprio' ? 6 : undefined}
            pattern={portal === 'myprio' ? '[0-9]{6}' : undefined}
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
    </div>
  );
}
