'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { VirtualizationPveConsoleSession } from '@tvde/shared';
import { Modal } from '@/components/modal';
import { buildVirtualizationWsUrl } from './pve-ws-url';

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
  addEventListener: (type: string, fn: (e: { detail?: { reason?: string; status?: string } }) => void) => void;
};

export function PveConsoleModal({ open, onClose, workspaceId, session }: PveConsoleModalProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  // Reajustar VNC/xterm quando o utilizador amplia ou a janela muda.
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
    fitRef.current = null;

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
          rfb.scaleViewport = true;
          rfb.resizeSession = true;

          const ro = new ResizeObserver(() => {
            // scaleViewport reage ao tamanho do contentor no próximo frame
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
              setStatus('Ligado — clique na consola para focar o teclado');
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
              setError(e.detail?.reason || 'Consola desligada');
              setStatus('');
            }
          });

          cleanup = () => {
            ro.disconnect();
            fitRef.current = null;
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
          theme: { background: '#0f172a', foreground: '#e2e8f0' },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host);
        fit.fit();

        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';

        const doFit = () => {
          fit.fit();
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        };
        fitRef.current = doFit;

        const ro = new ResizeObserver(() => doFit());
        ro.observe(host);

        socket.onopen = () => {
          if (!disposed) {
            setStatus('Ligado');
            doFit();
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

        cleanup = () => {
          ro.disconnect();
          fitRef.current = null;
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
        <button
          type="button"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label={expanded ? 'Reduzir consola' : 'Ampliar consola'}
          title={expanded ? 'Reduzir' : 'Ampliar'}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      }
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Clique na área escura para focar. Use o botão ampliar no canto para ecrã quase completo.
        </p>
        {status ? <p className="text-xs text-slate-600">{status}</p> : null}
      </div>
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
