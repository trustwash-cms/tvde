'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open || !session) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;
    setError('');
    setStatus('A ligar…');

    void (async () => {
      try {
        const wsUrl = buildVirtualizationWsUrl(session.websocketPath, workspaceId);

        if (session.mode === 'vnc') {
          // Esperar o contentor existir no DOM (modal portal).
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

          // No Proxmox, o ticket do vncproxy é a password RFB.
          const rfb = new RFB(host, wsUrl, {
            wsProtocols: ['binary'],
            credentials: { password: session.ticket },
          }) as unknown as RfbInstance;
          rfb.scaleViewport = true;
          rfb.resizeSession = true;

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
          fontSize: 13,
          theme: { background: '#0f172a', foreground: '#e2e8f0' },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host);
        fit.fit();

        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
          if (!disposed) setStatus('Ligado');
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

        const onResize = () => {
          fit.fit();
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
          }
        };
        window.addEventListener('resize', onResize);

        cleanup = () => {
          window.removeEventListener('resize', onResize);
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        session
          ? `Consola · ${session.name} (${session.guestType.toUpperCase()} ${session.vmid})`
          : 'Consola'
      }
      panelClassName="max-w-5xl"
      scrollBody
      showCloseButton
      overlayClassName="z-[60]"
    >
      <p className="mb-3 text-xs text-slate-500">
        Consola via proxy da API (como no browser do PVE). Clique na área escura para focar o
        teclado/rato.
      </p>
      {status ? <p className="mb-2 text-xs text-slate-600">{status}</p> : null}
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {session?.mode === 'vnc' ? (
        <div
          ref={screenRef}
          className="h-[min(70vh,560px)] overflow-hidden rounded-lg bg-slate-900"
        />
      ) : (
        <div ref={termRef} className="h-[min(70vh,560px)] overflow-hidden rounded-lg bg-slate-900 p-2" />
      )}
    </Modal>
  );
}
