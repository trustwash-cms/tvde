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

/**
 * Login rápido a um portal RPA (Via Verde / MyPRIO / Uber) a partir do sync de pagamentos.
 */
export function PortalQuickLoginModal({ open, portal, onClose, onSuccess }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  const label = portal ? PORTAL_KIND_LABELS[portal] : 'Portal';

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setPassword('');
    setOtp('');
    setBusy(false);
    setAwaitingOtp(false);
    setError('');
    setHint('');
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
      const s = res.data.status;
      if (s === 'awaiting_otp') {
        setAwaitingOtp(true);
        setBusy(false);
        setHint(res.data.otpHint || 'Introduza o código OTP enviado pelo portal.');
        return 'otp';
      }
      if (s === 'connected') {
        return 'ok';
      }
      if (s === 'error' || res.data.activeJobStatus === 'failed') {
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
        if (busy) return;
        onClose();
      }}
      title={`Login · ${label}`}
      showCloseButton={!busy}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      panelClassName="max-w-md"
    >
      {awaitingOtp ? (
        <form onSubmit={(e) => void handleOtp(e)} className="relative space-y-3" autoComplete="off">
          <AutofillDecoys />
          <p className="text-sm text-slate-600">{hint || 'Introduza o OTP.'}</p>
          <label className="block text-sm">
            <span className="text-slate-600">Código OTP</span>
            <AntiAutofillInput
              className="input mt-1 w-full"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              inputMode="numeric"
              disabled={busy}
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Validar OTP
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
