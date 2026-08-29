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

export function PveConsoleModal({ open, onClose, workspaceId, session }: PveConsoleModalProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !session) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;
    setError('');

    void (async () => {
      try {
        const wsUrl = buildVirtualizationWsUrl(session.websocketPath, workspaceId);

        if (session.mode === 'vnc') {
          const host = screenRef.current;
          if (!host) return;
          const RFB = (await import('@novnc/novnc')).default as new (
            target: HTMLElement,
            url: string,
            options?: { wsProtocols?: string[]; credentials?: { password?: string } }
          ) => {
            disconnect: () => void;
            scaleViewport: boolean;
            resizeSession: boolean;
            addEventListener: (type: string, fn: (e: { detail?: { reason?: string } }) => void) => void;
          };

          const rfb = new RFB(host, wsUrl);
          rfb.scaleViewport = true;
          rfb.resizeSession = true;
          rfb.addEventListener('disconnect', (e) => {
            if (!disposed) {
              setError(e.detail?.reason || 'Consola desligada');
            }
          });
          cleanup = () => {
            try {
              rfb.disconnect();
            } catch {
              // ignore
            }
          };
          return;
        }

        const host = termRef.current;
        if (!host) return;
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
        Requer permissão de consola no token PVE (ex. VM.Console). A sessão passa pelo proxy da API.
      </p>
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
