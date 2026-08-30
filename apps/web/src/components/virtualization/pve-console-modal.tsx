'use client';

import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Maximize2, Minimize2 } from 'lucide-react';
import type { VirtualizationPveConsoleSession } from '@tvde/shared';
import { Modal } from '@/components/modal';
import { buildVirtualizationWsUrl } from './pve-ws-url';
import { attachXtermClipboard, pasteIntoXterm } from './xterm-clipboard';
import { attachVncClipboard, pasteIntoVnc } from './vnc-type-text';

interface PveConsoleModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null | undefined;
  session: VirtualizationPveConsoleSession | null;
}

type RfbInstance = {
  disconnect: () => void;
  scaleViewport: boolean;
  resizeSession: boolean;
  focus: () => void;
  sendCredentials: (creds: { password?: string }) => void;
  sendKey: (keysym: number, code: string, down?: boolean) => void;
  clipboardPasteFrom: (text: string) => void;
  addEventListener: (
    type: string,
    fn: (e: { detail?: { reason?: string; status?: string; text?: string } }) => void
  ) => void;
};

type TermInstance = {
  focus: () => void;
  paste: (text: string) => void;
};

export function PveConsoleModal({ open, onClose, workspaceId, session }: PveConsoleModalProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const vncConnectedRef = useRef(false);
  const termRefInstance = useRef<TermInstance | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [pasteHint, setPasteHint] = useState('');

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => fitRef.current?.(), 50);
    const onWinResize = () => fitRef.current?.();
    window.addEventListener('resize', onWinResize);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('resize', onWinResize);
    };
  }, [open, expanded]);

  useEffect(() => {
    if (!open || !session) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;
    setError('');
    setStatus('A ligar…');
    setPasteHint('');
    fitRef.current = null;
    rfbRef.current = null;
    vncConnectedRef.current = false;
    termRefInstance.current = null;

    void (async () => {
      try {
        const wsUrl = buildVirtualizationWsUrl(session.websocketPath, workspaceId);

        if (session.mode === 'vnc') {
          await new Promise((r) => requestAnimationFrame(() => r(undefined)));
          const host = screenRef.current;
          if (!host) {
            setError('Área da consola indisponível');
            return;
          }
          if (!session.ticket) {
            setError('Ticket VNC em falta — volte a abrir a consola.');
            return;
          }

          const { default: RFB } = await import('@novnc/novnc');

          const rfb = new RFB(host, wsUrl, {
            wsProtocols: ['binary'],
            credentials: { password: session.ticket },
          }) as unknown as RfbInstance;
          rfbRef.current = rfb;
          rfb.scaleViewport = true;
          rfb.resizeSession = true;

          const detachClipboard = attachVncClipboard(
            host,
            () => rfbRef.current,
            () => vncConnectedRef.current
          );

          const onClipboard = (e: { detail?: { text?: string } }) => {
            const text = e.detail?.text;
            if (!text) return;
            void navigator.clipboard.writeText(text).catch(() => {
              // ignore
            });
          };
          rfb.addEventListener('clipboard', onClipboard);

          const ro = new ResizeObserver(() => {
            requestAnimationFrame(() => {
              try {
                rfb.focus();
              } catch {
                // ignore
              }
            });
          });
          ro.observe(host);
          fitRef.current = () => {
            try {
              rfb.focus();
            } catch {
              // ignore
            }
          };

          rfb.addEventListener('connect', () => {
            if (!disposed) {
              vncConnectedRef.current = true;
              setStatus('Ligado — clique na consola e use Ctrl/Cmd+V ou o botão Colar');
              try {
                rfb.focus();
              } catch {
                // ignore
              }
            }
          });
          rfb.addEventListener('credentialsrequired', () => {
            try {
              rfb.sendCredentials({ password: session.ticket });
            } catch {
              // ignore
            }
          });
          rfb.addEventListener('securityfailure', (e) => {
            if (!disposed) {
              setError(e.detail?.reason || e.detail?.status || 'Falha de autenticação VNC');
              setStatus('');
            }
          });
          rfb.addEventListener('disconnect', (e) => {
            if (!disposed) {
              vncConnectedRef.current = false;
              setError(e.detail?.reason || 'Consola desligada');
              setStatus('');
            }
          });

          cleanup = () => {
            ro.disconnect();
            fitRef.current = null;
            rfbRef.current = null;
            vncConnectedRef.current = false;
            detachClipboard();
            try {
              rfb.disconnect();
            } catch {
              // ignore
            }
            host.replaceChildren();
          };
          return;
        }

        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        const host = termRef.current;
        if (!host) {
          setError('Área do terminal indisponível');
          return;
        }
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        await import('@xterm/xterm/css/xterm.css');

        const term = new Terminal({
          cursorBlink: true,
          fontSize: expanded ? 15 : 13,
          scrollback: 5000,
          theme: { background: '#0f172a', foreground: '#e2e8f0' },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host);
        fit.fit();
        termRefInstance.current = term;

        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';

        const doFit = () => {
          fit.fit();
          if (socket.readyState === WebSocket.OPEN && term.cols > 0 && term.rows > 0) {
            socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        };
        fitRef.current = doFit;

        const ro = new ResizeObserver(() => doFit());
        ro.observe(host);

        socket.onopen = () => {
          if (!disposed) {
            setStatus('Ligado — Ctrl/Cmd+V ou botão Colar');
            doFit();
            term.focus();
          }
        };
        socket.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            term.write(ev.data);
          } else {
            term.write(new Uint8Array(ev.data as ArrayBuffer));
          }
        };
        socket.onerror = () => {
          if (!disposed) setError('Erro na ligação à consola');
        };
        socket.onclose = () => {
          if (!disposed) setError((prev) => prev || 'Consola desligada');
        };
        term.onData((data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        });
        const detachClipboard = attachXtermClipboard(host, term);

        cleanup = () => {
          ro.disconnect();
          fitRef.current = null;
          termRefInstance.current = null;
          detachClipboard();
          try {
            socket.close();
          } catch {
            // ignore
          }
          term.dispose();
        };
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Falha ao iniciar consola');
          setStatus('');
        }
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [open, session, workspaceId]);

  const handleClose = () => {
    setExpanded(false);
    onClose();
  };

  const handlePasteClick = async () => {
    setPasteHint('');
    if (session?.mode === 'vnc') {
      const rfb = rfbRef.current;
      if (!rfb) {
        setPasteHint('Consola ainda não está pronta.');
        return;
      }
      const result = await pasteIntoVnc(rfb, () => vncConnectedRef.current);
      setPasteHint(
        result === 'ok'
          ? 'Texto enviado para a consola.'
          : result === 'not-connected'
            ? 'Aguarde a consola ligar antes de colar.'
            : result === 'denied'
              ? 'Permissão de clipboard negada pelo browser.'
              : 'Área de transferência vazia.'
      );
      return;
    }
    const term = termRefInstance.current;
    if (!term) {
      setPasteHint('Terminal ainda não está pronto.');
      return;
    }
    const ok = await pasteIntoXterm(term);
    setPasteHint(ok ? 'Texto colado no terminal.' : 'Não foi possível ler a área de transferência.');
  };

  const consoleHeight = expanded
    ? 'h-[calc(98vh-9rem)] min-h-[420px]'
    : 'h-[min(75vh,640px)]';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={
        session
          ? `Consola · ${session.name} (${session.guestType.toUpperCase()} ${session.vmid})`
          : 'Consola'
      }
      panelClassName={
        expanded
          ? '!max-h-[98vh] !max-w-[98vw] w-[98vw]'
          : 'max-w-6xl'
      }
      scrollBody
      showCloseButton
      overlayClassName="z-[60]"
      closeOnBackdrop={!expanded}
      headerActions={
        <>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Colar da área de transferência"
            title="Colar (Ctrl/Cmd+V)"
            onClick={() => void handlePasteClick()}
          >
            <ClipboardPaste size={18} />
          </button>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={expanded ? 'Reduzir consola' : 'Ampliar consola'}
            title={expanded ? 'Reduzir' : 'Ampliar'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Clique na consola para focar. Ctrl/Cmd+V ou o botão Colar enviam o texto da área de
          transferência. Em VNC, o texto é digitado directamente (ideal para comandos).
        </p>
        {status ? <p className="text-xs text-slate-600">{status}</p> : null}
      </div>
      {pasteHint ? (
        <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          {pasteHint}
        </div>
      ) : null}
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {session?.mode === 'vnc' ? (
        <div
          ref={screenRef}
          className={`${consoleHeight} overflow-hidden rounded-lg bg-slate-900`}
        />
      ) : (
        <div
          ref={termRef}
          className={`${consoleHeight} overflow-hidden rounded-lg bg-slate-900 p-2`}
        />
      )}
    </Modal>
  );
}
