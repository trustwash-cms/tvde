'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PORTAL_KIND_LABELS, type PortalKind } from '@tvde/shared';
import { Modal } from '@/components/modal';
import { AntiAutofillInput, AutofillDecoys } from '@/components/anti-autofill';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
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
  hasPassword?: boolean;
  passwordNeedsResave?: boolean;
  usernameMasked?: string | null;
};

function humanizeQuickPortalError(raw: string | null | undefined): string {
  if (!raw) return '';
  if (
    /unsupported state or unable to authenticate data|unable to authenticate data|Password guardada ilegível|chave de encriptação/i.test(
      raw
    )
  ) {
    return (
      'Password guardada ilegível (chave de encriptação mudou). ' +
      'Clique em «Esquecer password» e volte a Ligar conta com a password correcta.'
    );
  }
  return raw;
}

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
 * Se há password guardada, oferece reutilização sem voltar a digitar.
 */
export function PortalQuickLoginModal({ open, portal, onClose, onSuccess }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [useStored, setUseStored] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [passwordNeedsResave, setPasswordNeedsResave] = useState(false);
  const [usernameMasked, setUsernameMasked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const { confirm, confirmDialog } = useConfirmDialog();

  const label = portal ? PORTAL_KIND_LABELS[portal] : 'Portal';

  useEffect(() => {
    if (!open || !portal) return;
    let cancelled = false;
    setUsername('');
    setPassword('');
    setOtp('');
    setBusy(false);
    setAwaitingOtp(false);
    setUseStored(false);
    setHasPassword(false);
    setPasswordNeedsResave(false);
    setUsernameMasked(null);
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
      setHasPassword(Boolean(res.data.hasPassword));
      setPasswordNeedsResave(Boolean(res.data.passwordNeedsResave));
      setUsernameMasked(res.data.usernameMasked ?? null);
      if (isAwaitingOtp(res.data)) {
        setAwaitingOtp(true);
        setHint(
          res.data.otpHint ||
            (portal === 'myprio'
              ? 'Introduza o código SMS de 6 dígitos recebido no telemóvel (válido ~2 min).'
              : 'Introduza o código OTP enviado pelo portal.')
        );
      } else if (res.data.status === 'connected' && !res.data.passwordNeedsResave) {
        onSuccess(portal);
        onClose();
      } else if (res.data.hasPassword && !res.data.passwordNeedsResave) {
        setUseStored(true);
      } else if (res.data.passwordNeedsResave || res.data.lastError) {
        setError(humanizeQuickPortalError(res.data.lastError) || '');
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
      // Não falhar por status «expired» — é o estado inicial ao reabrir sessão após sync.
      // Só falhar quando o job de login actual falhou.
      if (
        res.data.activeJobStatus === 'failed' ||
        (res.data.status === 'error' &&
          res.data.activeJobStatus !== 'running' &&
          res.data.activeJobStatus !== 'pending' &&
          res.data.activeJobStatus !== 'awaiting_otp')
      ) {
        throw new Error(
          humanizeQuickPortalError(res.data.lastError || res.data.lastJobMessage) || 'Login falhou'
        );
      }
    }
    throw new Error('Timeout a autenticar no portal');
  }

  async function startConnect(body: {
    username?: string;
    password?: string;
    useStoredCredentials?: boolean;
  }) {
    if (!portal) return;
    setBusy(true);
    setError('');
    setAwaitingOtp(false);

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
        body: JSON.stringify(body),
      },
      getStoredToken()
    );
    if (!res.success) {
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
      setError(humanizeQuickPortalError(res.error) || 'Falha ao ligar');
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

  async function handleConnectStored(e: FormEvent) {
    e.preventDefault();
    await startConnect({ useStoredCredentials: true });
  }

  async function handleConnectManual(e: FormEvent) {
    e.preventDefault();
    await startConnect({ username, password });
  }

  async function handleForgetPassword() {
    if (!portal) return;
    const ok = await confirm({
      title: 'Esquecer password',
      message:
        'Remover a password guardada deste portal? O utilizador e a sessão (se existir) mantêm-se. No próximo login terá de introduzir a password.',
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
      setError(res.error || 'Não foi possível esquecer a password');
      return;
    }
    setHasPassword(false);
    setUseStored(false);
    setPassword('');
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
      {confirmDialog}
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
      ) : useStored && hasPassword && !passwordNeedsResave ? (
        <form onSubmit={(e) => void handleConnectStored(e)} className="relative space-y-3" autoComplete="off">
          {busy ? (
            <div className="flex items-start gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              A autenticar no portal… pode demorar cerca de 1 minuto.
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Credenciais guardadas (encriptadas) para{' '}
              <span className="font-medium text-slate-800">{usernameMasked || label}</span>.
              Continuar sem voltar a digitar a password
              {portal === 'myprio' || portal === 'uber' ? ' — o portal pode pedir OTP SMS a seguir' : ''}.
            </p>
          )}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap gap-3 text-xs">
              <button
                type="button"
                className="text-slate-600 underline-offset-2 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  setUseStored(false);
                  setError('');
                }}
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
              <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continuar
              </button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={(e) => void handleConnectManual(e)} className="relative space-y-3" autoComplete="off">
          <AutofillDecoys />
          {busy ? (
            <div className="flex items-start gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              A autenticar no portal… pode demorar cerca de 1 minuto.
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Sessão expirada ou timeout — volte a autenticar para continuar o sincronismo.
              A password fica guardada encriptada neste tenant.
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
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {hasPassword ? (
              <button
                type="button"
                className="text-xs text-slate-600 underline-offset-2 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  setUseStored(true);
                  setError('');
                }}
              >
                Usar password guardada
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Ligar
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
