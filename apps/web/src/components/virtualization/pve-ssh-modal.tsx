'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type {
  VirtualizationPveGuest,
  VirtualizationPveGuestNetwork,
  VirtualizationPveSshSession,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { Modal } from '@/components/modal';
import { NoAutofillSecretInput } from '@/components/whatsapp/no-autofill-field';
import { buildVirtualizationWsUrl } from './pve-ws-url';

interface PveSshModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null | undefined;
  serverId: string;
  guest: VirtualizationPveGuest | null;
}

export function PveSshModal({ open, onClose, workspaceId, serverId, guest }: PveSshModalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const [network, setNetwork] = useState<VirtualizationPveGuestNetwork | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open || !guest || !workspaceId) return;
    setError('');
    setConnected(false);
    setPassword('');
    setPrivateKey('');
    setNetwork(null);
    setHost(guest.manualIp?.trim() || '');

    void (async () => {
      const res = await apiFetch<VirtualizationPveGuestNetwork>(
        withWorkspaceQuery(
          API_PATHS.virtualization.pveServerGuestNetwork(serverId, guest.type, guest.vmid),
          workspaceId
        ),
        {},
        getStoredToken()
      );
      if (res.data) {
        setNetwork(res.data);
        if (guest.manualIp?.trim()) {
          setHost(guest.manualIp.trim());
        } else {
          const preferred =
            res.data.ips.find((ip) => ip.family === 'ipv4') ?? res.data.ips[0] ?? null;
          if (preferred) setHost(preferred.address);
        }
        if (!res.data.ips.length && !guest.manualIp && res.data.reason) {
          setError(res.data.reason);
        }
      } else if (!guest.manualIp) {
        setError(getApiErrorMessage(res) || 'Não foi possível obter IPs');
      }
    })();

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [open, guest, serverId, workspaceId]);

  const handleConnect = async (event: FormEvent) => {
    event.preventDefault();
    if (!guest || !workspaceId) return;
    setBusy(true);
    setError('');
    cleanupRef.current?.();

    try {
      const res = await apiFetch<VirtualizationPveSshSession>(
        withWorkspaceQuery(
          API_PATHS.virtualization.pveServerGuestSsh(serverId, guest.type, guest.vmid),
          workspaceId
        ),
        {
          method: 'POST',
          body: JSON.stringify({
            host: host.trim(),
            port: Number(port) || 22,
            username: username.trim(),
            password: password || undefined,
            privateKey: privateKey || undefined,
          }),
        },
        getStoredToken()
      );

      if (!res.data) {
        setError(getApiErrorMessage(res) || 'Não foi possível criar sessão SSH');
        setBusy(false);
        return;
      }

      const hostEl = termRef.current;
      if (!hostEl) {
        setError('Terminal indisponível');
        setBusy(false);
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
      term.open(hostEl);
      fit.fit();

      const wsUrl = buildVirtualizationWsUrl(res.data.websocketPath, workspaceId);
      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        setConnected(true);
        setBusy(false);
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };
      socket.onmessage = (ev) => {
        if (typeof ev.data === 'string') term.write(ev.data);
        else term.write(new Uint8Array(ev.data as ArrayBuffer));
      };
      socket.onerror = () => setError('Erro na ligação SSH');
      socket.onclose = () => {
        setConnected(false);
        setError((prev) => prev || 'SSH desligado');
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

      cleanupRef.current = () => {
        window.removeEventListener('resize', onResize);
        try {
          socket.close();
        } catch {
          // ignore
        }
        term.dispose();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha SSH');
      setBusy(false);
    }
  };

  const handleClose = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={guest ? `SSH · ${guest.name} (VMID ${guest.vmid})` : 'SSH'}
      panelClassName="max-w-4xl"
      scrollBody
      showCloseButton
      overlayClassName="z-[60]"
      footer={
        !connected ? (
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={handleClose}>
              Cancelar
            </button>
            <button
              type="submit"
              form="pve-ssh-connect-form"
              className="btn-primary"
              disabled={busy || !host.trim()}
            >
              {busy ? 'A ligar…' : 'Ligar SSH'}
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={handleClose}>
              Fechar
            </button>
          </div>
        )
      }
    >
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {!connected ? (
        <form id="pve-ssh-connect-form" onSubmit={(e) => void handleConnect(e)} className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-700">IP / host</span>
            {guest?.manualIp || (network && network.ips.length > 0) ? (
              <div className="space-y-2">
                <select
                  className="input w-full"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                >
                  {guest?.manualIp ? (
                    <option value={guest.manualIp}>{guest.manualIp} · manual</option>
                  ) : null}
                  {(network?.ips ?? []).map((ip) => (
                    <option key={`${ip.interfaceName}-${ip.address}`} value={ip.address}>
                      {ip.address}
                      {ip.interfaceName ? ` (${ip.interfaceName})` : ''} · {ip.family}
                    </option>
                  ))}
                </select>
                <input
                  className="input w-full"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="Ou escreva outro IP"
                />
              </div>
            ) : (
              <input
                className="input w-full"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="10.x.x.x"
              />
            )}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Porta</span>
            <input className="input w-full" value={port} onChange={(e) => setPort(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Utilizador</span>
            <input
              className="input w-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-700">Password</span>
            <NoAutofillSecretInput
              className="input w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block text-slate-700">Ou chave privada (PEM)</span>
            <textarea
              className="input min-h-[100px] w-full font-mono text-xs"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="text-xs text-slate-500 md:col-span-2">
            Credenciais não são guardadas. O host API precisa de rota de rede até ao IP do guest
            (ex. ZeroTier).
          </p>
        </form>
      ) : null}

      <div
        ref={termRef}
        className={`overflow-hidden rounded-lg bg-slate-900 p-2 ${connected ? 'mt-0 h-[min(65vh,520px)]' : 'mt-3 h-0'}`}
      />
    </Modal>
  );
}
