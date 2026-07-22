'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PORTAL_KIND_LABELS, type PortalKind } from '@tvde/shared';
import { Modal } from '@/components/modal';
import { AntiAutofillInput, AutofillDecoys } from '@/components/anti-autofill';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

type Props = {
  open: boolean;
  portal: PortalKind | null;
  onClose: () => void;
  onSuccess: (portal: PortalKind) => void;
};

type Conn = {
  status?: string;
  activeJobStatus?: string | null;
  lastError?: string | null;
  lastJobMessage?: string | null;
  otpHint?: string | null;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAwaitingOtp(data: Conn | null | undefined): boolean {
  if (!data) return false;
  return data.status === 'awaiting_otp' || data.activeJobStatus === 'awaiting_otp';
}

/**
 * Login rápido a um portal RPA (Via Verde / MyPRIO / Uber) a partir do sync de pagamentos.
 * Se o portal já estiver à espera de OTP, abre directamente o formulário do código.
 */
export function PortalQuickLoginModal({ open, portal, onClose, onSuccess }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  const label = portal ? PORTAL_KIND_LABELS[portal] : 'Portal';

  useEffect(() => {
    if (!open || !portal) return;
    let cancelled = false;
    setUsername('');
    setPassword('');
    setOtp('');
    setBusy(false);
    setAwaitingOtp(false);
    setError('');
    setHint('');
    setChecking(true);

    void (async () => {
      const res = await apiFetch<Conn>(
        API_PATHS.portalConnections.byPortal(portal),
        {},
        getStoredToken()
      );
      if (cancelled) return;
      setChecking(false);
      if (!res.success || !res.data) return;
      if (isAwaitingOtp(res.data)) {
        setAwaitingOtp(true);
        setHint(
          res.data.otpHint ||
            (portal === 'myprio'
              ? 'Introduza o código SMS de 6 dígitos recebido no telemóvel (válido ~2 min).'
              : 'Introduza o código OTP enviado pelo portal.')
        );
      } else if (res.data.status === 'connected') {
        onSuccess(portal);
        onClose();
      }
    })();

    return () => {
      cancelled = true;
    };
    // Só reagir a abrir/portal — callbacks do pai mudam a cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, portal]);

  async function pollUntilConnectedOrOtp(token: PortalKind) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await sleep(1200);
      const res = await apiFetch<Conn>(
        API_PATHS.portalConnections.byPortal(token),
        {},
        getStoredToken()
      );
      if (!res.success || !res.data) continue;
      if (isAwaitingOtp(res.data)) {
        setAwaitingOtp(true);
        setBusy(false);
        setHint(
          res.data.otpHint ||
            (token === 'myprio'
              ? 'Introduza o código SMS de 6 dígitos recebido no telemóvel (válido ~2 min).'
              : 'Introduza o código OTP enviado pelo portal.')
        );
        return 'otp';
      }
      if (res.data.status === 'connected') {
        return 'ok';
      }
      if (res.data.status === 'error' || res.data.activeJobStatus === 'failed') {
        throw new Error(res.data.lastError || res.data.lastJobMessage || 'Login falhou');
      }
    }
    throw new Error('Timeout a autenticar no portal');
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!portal) return;
    setBusy(true);
    setError('');
    setAwaitingOtp(false);

    // Revalidar: se entretanto ficou à espera de OTP, não criar outro job
    const pre = await apiFetch<Conn>(
      API_PATHS.portalConnections.byPortal(portal),
      {},
      getStoredToken()
    );
    if (pre.success && isAwaitingOtp(pre.data)) {
      setBusy(false);
      setAwaitingOtp(true);
      setHint(
        pre.data?.otpHint ||
          'Já há um desafio OTP activo — introduza o código (não inicie outro login).'
      );
      return;
    }

    const res = await apiFetch(
      API_PATHS.portalConnections.connect(portal),
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
      getStoredToken()
    );
    if (!res.success) {
      // Job OTP já activo — mostrar formulário OTP em vez de erro seco
      if (/espera de OTP|awaiting_otp|já existe um job|em curso/i.test(res.error || '')) {
        const st = await apiFetch<Conn>(
          API_PATHS.portalConnections.byPortal(portal),
          {},
          getStoredToken()
        );
        if (st.success && isAwaitingOtp(st.data)) {
          setBusy(false);
          setAwaitingOtp(true);
          setHint(st.data?.otpHint || 'Introduza o código OTP — há um desafio activo.');
          setError('');
          return;
        }
      }
      setBusy(false);
      setError(res.error || 'Falha ao ligar');
      return;
    }
    try {
      const result = await pollUntilConnectedOrOtp(portal);
      if (result === 'ok') {
        setBusy(false);
        onSuccess(portal);
        onClose();
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Erro');
    }
  }

  async function handleOtp(e: FormEvent) {
    e.preventDefault();
    if (!portal) return;
    setBusy(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.portalConnections.otp(portal),
      { method: 'POST', body: JSON.stringify({ code: otp }) },
      getStoredToken()
    );
    if (!res.success) {
      setBusy(false);
      setError(res.error || 'OTP inválido');
      return;
    }
    try {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await sleep(1200);
        const st = await apiFetch<Conn>(
          API_PATHS.portalConnections.byPortal(portal),
          {},
          getStoredToken()
        );
        if (st.data?.status === 'connected') {
          setBusy(false);
          onSuccess(portal);
          onClose();
          return;
        }
        if (st.data?.status === 'error' || st.data?.activeJobStatus === 'failed') {
          throw new Error(st.data.lastError || st.data.lastJobMessage || 'OTP falhou');
        }
      }
      throw new Error('Timeout após OTP');
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Erro');
    }
  }

  return (
    <Modal
      open={open && Boolean(portal)}
      onClose={() => {
        if (busy || checking) return;
        onClose();
      }}
      title={awaitingOtp ? `Código SMS · ${label}` : `Login · ${label}`}
      showCloseButton={!busy && !checking}
      closeOnBackdrop={!busy && !checking}
      closeOnEscape={!busy && !checking}
      panelClassName="max-w-md"
    >
      {checking ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          A verificar estado do portal…
        </div>
      ) : awaitingOtp ? (
        <form onSubmit={(e) => void handleOtp(e)} className="relative space-y-3" autoComplete="off">
          <AutofillDecoys />
          <p className="text-sm text-slate-600">
            {hint ||
              'Introduza o código SMS recebido no telemóvel. O browser no servidor mantém-se aberto à espera deste código.'}
          </p>
          <label className="block text-sm">
            <span className="text-slate-600">Código OTP</span>
            <AntiAutofillInput
              className="input mt-1 w-full"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              inputMode="numeric"
              disabled={busy}
              autoFocus
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={(e) => void handleConnect(e)} className="relative space-y-3" autoComplete="off">
          <AutofillDecoys />
          {busy ? (
            <div className="flex items-start gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              A autenticar no portal… pode demorar cerca de 1 minuto.
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Sessão expirada ou timeout — volte a autenticar para continuar o sincronismo.
            </p>
          )}
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
              className="input mt-1 w-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={busy}
              inputMode={portal === 'myprio' ? 'numeric' : undefined}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">
              {portal === 'uber' ? 'Password (se pedida)' : 'Password'}
            </span>
            <AntiAutofillInput
              className="input mt-1 w-full"
              maskAsPassword
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={portal !== 'uber'}
              disabled={busy}
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Ligar
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
