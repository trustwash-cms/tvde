'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Loader2 } from 'lucide-react';
import type { PortalKind } from '@tvde/shared';
import { Modal } from '@/components/modal';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';

type LiveFrame = {
  imageBase64: string;
  mimeType: string;
  viewportWidth: number;
  viewportHeight: number;
  authChallenge: 'passkey' | 'otp' | 'bot' | 'password' | null;
  /** false = iframe detectado mas «Iniciar desafio» ainda não pintou (identidade por baixo) */
  challengeVisible?: boolean | null;
  capturedAt: string;
};

type Props = {
  open: boolean;
  portal: PortalKind;
  jobId: string | null;
  hint?: string | null;
  /** noVNC do servidor (ecrã completo :6901) */
  vncUrl?: string | null;
  /** Manter stream aberto quando o live-frame detecta OTP (Uber login completo) */
  keepOpenDuringOtp?: boolean;
  onCloseCancel: () => void;
  /** Job avançou (OTP / ligado) — fechar sem cancelar */
  onChallengeCleared: () => void;
};

const POLL_MS = 450;
const FATAL_LIVE_RE =
  /não activo|nao activo|indispon[ií]vel|terminou|expirou|inv[aá]lido|fechou|Browser vivo|Target closed|sem stream|p[aá]gina fechou|Falha a capturar/i;

/**
 * Stream JPEG do Chromium Playwright + cliques/arrasto → page.mouse.
 * Usado no desafio Arkose («Proteger a sua conta») sem VNC.
 */
export function UberBotChallengeModal({
  open,
  portal,
  jobId,
  hint,
  vncUrl,
  keepOpenDuringOtp = false,
  onCloseCancel,
  onChallengeCleared,
}: Props) {
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [challengeVisible, setChallengeVisible] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState(false);
  const [busyCancel, setBusyCancel] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const lastMoveAt = useRef(0);
  const failStreak = useRef(0);

  const displaySize = useCallback(() => {
    const el = imgRef.current;
    if (!el) return null;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w <= 0 || h <= 0) return null;
    return { displayWidth: w, displayHeight: h };
  }, []);

  const localCoords = useCallback((e: ReactPointerEvent) => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    return { x, y, displayWidth: rect.width, displayHeight: rect.height };
  }, []);

  const sendInput = useCallback(
    async (body: Record<string, unknown>) => {
      if (!jobId) return;
      await apiFetch(
        API_PATHS.portalConnections.liveInput(portal, jobId),
        { method: 'POST', body: JSON.stringify(body) },
        getStoredToken()
      );
    },
    [jobId, portal]
  );

  // Reset ao abrir / mudar job
  useEffect(() => {
    if (!open) return;
    setFrameSrc(null);
    setChallengeVisible(null);
    setError('');
    setFatal(false);
    failStreak.current = 0;
  }, [open, jobId, retryKey]);

  // Poll frames
  useEffect(() => {
    if (!open || !jobId || fatal) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await apiFetch<LiveFrame>(
          API_PATHS.portalConnections.liveFrame(portal, jobId),
          {},
          getStoredToken()
        );
        if (cancelled) return;
        if (res.success && res.data?.imageBase64) {
          failStreak.current = 0;
          setFrameSrc(`data:${res.data.mimeType || 'image/jpeg'};base64,${res.data.imageBase64}`);
          setChallengeVisible(
            typeof res.data.challengeVisible === 'boolean' ? res.data.challengeVisible : null
          );
          setError('');
          if (res.data.authChallenge === 'password') {
            onChallengeCleared();
          } else if (res.data.authChallenge === 'otp') {
            if (!keepOpenDuringOtp) onChallengeCleared();
          } else if (res.data.authChallenge == null && res.data.challengeVisible === false) {
            // Backend limpou bot (identidade / OTP) — fechar «Desafio Uber»
            onChallengeCleared();
          }
          // passkey: manter modal; o servidor tenta SMS automaticamente
        } else {
          const msg = res.error || 'Sem imagem do ecrã live';
          failStreak.current += 1;
          if (FATAL_LIVE_RE.test(msg) || failStreak.current >= 6) {
            setFatal(true);
            setError(
              FATAL_LIVE_RE.test(msg)
                ? msg
                : 'O ecrã live não responde. O browser no servidor pode ter fechado — cancele e volte a abrir o desafio.'
            );
            return;
          }
          setError(msg);
        }
      } catch {
        if (cancelled) return;
        failStreak.current += 1;
        if (failStreak.current >= 6) {
          setFatal(true);
          setError(
            'Falha a obter o ecrã live (rede ou browser fechou). Cancele e volte a abrir o desafio Uber.'
          );
          return;
        }
        setError('Falha a obter o ecrã live');
      }
      if (!cancelled && !fatal) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, jobId, portal, onChallengeCleared, fatal, retryKey, keepOpenDuringOtp]);

  async function handleCancel() {
    if (!jobId || busyCancel) return;
    setBusyCancel(true);
    try {
      await apiFetch(
        API_PATHS.portalConnections.cancelJob(portal, jobId),
        { method: 'POST', body: '{}' },
        getStoredToken()
      );
    } finally {
      setBusyCancel(false);
      onCloseCancel();
    }
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0 || fatal) return;
    const c = localCoords(e);
    if (!c) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragStart.current = { x: c.x, y: c.y };
    void sendInput({
      type: 'mousedown',
      x: c.x,
      y: c.y,
      displayWidth: c.displayWidth,
      displayHeight: c.displayHeight,
      button: 'left',
    });
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!dragStart.current || fatal) return;
    const c = localCoords(e);
    if (!c) return;
    const now = Date.now();
    if (now - lastMoveAt.current < 40) return;
    lastMoveAt.current = now;
    void sendInput({
      type: 'mousemove',
      x: c.x,
      y: c.y,
      displayWidth: c.displayWidth,
      displayHeight: c.displayHeight,
      button: 'left',
    });
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (fatal) {
      dragStart.current = null;
      return;
    }
    const c =
      localCoords(e) ??
      (() => {
        const size = displaySize();
        if (!size || !dragStart.current) return null;
        return { ...dragStart.current, ...size };
      })();
    dragStart.current = null;
    if (!c) return;

    void sendInput({
      type: 'mouseup',
      x: c.x,
      y: c.y,
      displayWidth: c.displayWidth,
      displayHeight: c.displayHeight,
      button: 'left',
    });
  }

  const loadingChallenge = challengeVisible === false;

  return (
    <Modal
      open={open}
      onClose={() => void handleCancel()}
      title="Ecrã Uber (RPA)"
      showCloseButton={!busyCancel}
      closeOnBackdrop={false}
      closeOnEscape={!busyCancel}
      panelClassName="max-w-3xl"
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {fatal
            ? 'O stream live parou. Pode tentar novamente ou cancelar e voltar a ligar a conta.'
            : loadingChallenge
              ? 'A carregar desafio… Se ainda vir o ecrã de email/telefone, aguarde — o anti-bot Uber está a montar.'
              : hint ??
                'Stream em tempo real do browser Uber no servidor. Resolva o anti-bot, veja o passkey/SMS, ou use noVNC para o ecrã completo.'}
        </p>
        {vncUrl ? (
          <p className="text-xs">
            <a
              href={vncUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-sky-700 underline-offset-2 hover:underline"
            >
              Abrir ecrã completo no servidor (noVNC)
            </a>
            <span className="text-slate-500"> — password no servidor: tvde-arkose</span>
          </p>
        ) : null}
        <div className="relative overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          {frameSrc && !fatal ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={frameSrc}
              alt="Ecrã Uber live"
              className="mx-auto max-h-[min(70vh,640px)] w-full cursor-crosshair select-none object-contain touch-none"
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm">
              {fatal ? (
                <>
                  <p className="font-medium text-amber-800">
                    {error || 'Browser no servidor indisponível'}
                  </p>
                  <p className="text-slate-500">
                    Se o desafio ainda estiver aberto no servidor, use «Tentar novamente». Caso
                    contrário cancele e clique em «Abrir desafio Uber» / Ligar conta.
                  </p>
                </>
              ) : (
                <div className="flex items-center justify-center gap-2 text-slate-500">
                  <Loader2 size={18} className="animate-spin" />A carregar ecrã live…
                </div>
              )}
            </div>
          )}
          {frameSrc && !fatal && loadingChallenge ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-slate-900/70 px-3 py-2 text-xs text-white">
              <Loader2 size={14} className="animate-spin" />
              A carregar desafio… («Iniciar desafio»)
            </div>
          ) : null}
        </div>
        {error && !fatal ? <p className="text-sm text-amber-700">{error}</p> : null}
        <p className="text-xs text-slate-500">
          Timeout ~10 min. Fechar ou cancelar encerra o browser no servidor com segurança.
        </p>
        <div className="flex justify-end gap-2">
          {fatal ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busyCancel}
              onClick={() => {
                setFatal(false);
                setError('');
                failStreak.current = 0;
                setRetryKey((k) => k + 1);
              }}
            >
              Tentar novamente
            </button>
          ) : null}
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            disabled={busyCancel}
            onClick={() => void handleCancel()}
          >
            {busyCancel ? <Loader2 size={14} className="animate-spin" /> : null}
            Cancelar desafio
          </button>
        </div>
      </div>
    </Modal>
  );
}
