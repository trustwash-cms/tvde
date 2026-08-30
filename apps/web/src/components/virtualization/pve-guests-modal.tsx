'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Pencil, Play, Radio, Square } from 'lucide-react';
import {
  WEB_ROUTES,
  formatVirtualizationBytes,
  type VirtualizationPveConsoleSession,
  type VirtualizationPveGuest,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { Modal } from '@/components/modal';
import { usePromptDialog } from '@/hooks/use-prompt-dialog';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { PveConsoleModal } from './pve-console-modal';
import { PveGuestPingModal } from './pve-guest-ping-modal';
import { PveSshModal } from './pve-ssh-modal';

interface PveGuestsModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null | undefined;
  serverId: string | null;
  serverLabel: string;
}

function isRunning(status: string): boolean {
  return status.toLowerCase() === 'running';
}

export function PveGuestsModal({
  open,
  onClose,
  workspaceId,
  serverId,
  serverLabel,
}: PveGuestsModalProps) {
  const { prompt, promptDialog } = usePromptDialog();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [guests, setGuests] = useState<VirtualizationPveGuest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [consoleSession, setConsoleSession] = useState<VirtualizationPveConsoleSession | null>(null);
  const [sshGuest, setSshGuest] = useState<VirtualizationPveGuest | null>(null);
  const [pingGuest, setPingGuest] = useState<VirtualizationPveGuest | null>(null);

  const loadGuests = useCallback(async () => {
    if (!workspaceId || !serverId) return;
    setLoading(true);
    setError('');
    const res = await apiFetch<VirtualizationPveGuest[]>(
      withWorkspaceQuery(API_PATHS.virtualization.pveServerGuests(serverId), workspaceId),
      {},
      getStoredToken()
    );
    if (res.data) {
      setGuests(res.data);
    } else {
      setError(getApiErrorMessage(res) || 'Não foi possível listar guests');
      setGuests([]);
    }
    setLoading(false);
  }, [workspaceId, serverId]);

  useEffect(() => {
    if (open && serverId) {
      void loadGuests();
      setConsoleSession(null);
      setSshGuest(null);
      setPingGuest(null);
      setMessage('');
      setError('');
    }
  }, [open, serverId, loadGuests]);

  const guestKey = (guest: VirtualizationPveGuest) => `${guest.type}-${guest.vmid}`;

  const openConsole = async (guest: VirtualizationPveGuest) => {
    if (!workspaceId || !serverId) return;
    setActionBusy(guestKey(guest));
    setError('');
    const res = await apiFetch<VirtualizationPveConsoleSession>(
      withWorkspaceQuery(
        API_PATHS.virtualization.pveServerGuestConsole(serverId, guest.type, guest.vmid),
        workspaceId
      ),
      { method: 'POST' },
      getStoredToken()
    );
    setActionBusy(null);
    if (res.data) {
      setConsoleSession(res.data);
    } else {
      setError(getApiErrorMessage(res) || 'Não foi possível abrir a consola');
    }
  };

  const openSsh = (guest: VirtualizationPveGuest) => {
    setSshGuest(guest);
  };

  const powerGuest = async (guest: VirtualizationPveGuest, action: 'start' | 'stop') => {
    if (!workspaceId || !serverId) return;
    if (action === 'stop') {
      const ok = await confirm({
        title: `Parar ${guest.name}?`,
        message: `Vai enviar stop ao ${guest.type === 'qemu' ? 'VM' : 'CT'} ${guest.vmid}.`,
        variant: 'danger',
        confirmLabel: 'Parar',
      });
      if (!ok) return;
    }

    setActionBusy(guestKey(guest));
    setError('');
    setMessage('');
    const path =
      action === 'start'
        ? API_PATHS.virtualization.pveServerGuestStart(serverId, guest.type, guest.vmid)
        : API_PATHS.virtualization.pveServerGuestStop(serverId, guest.type, guest.vmid);
    const res = await apiFetch<{ ok: true }>(
      withWorkspaceQuery(path, workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setActionBusy(null);
    if (!res.success && !res.data) {
      setError(getApiErrorMessage(res) || `Falha ao ${action === 'start' ? 'iniciar' : 'parar'}`);
      return;
    }
    setMessage(
      action === 'start'
        ? `${guest.name}: pedido de start enviado.`
        : `${guest.name}: pedido de stop enviado.`
    );
    window.setTimeout(() => void loadGuests(), 1500);
  };

  const editIp = async (guest: VirtualizationPveGuest) => {
    if (!workspaceId || !serverId) return;
    const value = await prompt({
      title: `IP · ${guest.name}`,
      message: 'IP manual (usado no SSH). Deixe vazio para limpar.',
      defaultValue: guest.manualIp ?? '',
      confirmLabel: 'Guardar',
      placeholder: '10.x.x.x',
    });
    if (value === null) return;

    setActionBusy(guestKey(guest));
    setError('');
    const res = await apiFetch<VirtualizationPveGuest>(
      withWorkspaceQuery(
        API_PATHS.virtualization.pveServerGuestIp(serverId, guest.type, guest.vmid),
        workspaceId
      ),
      {
        method: 'PUT',
        body: JSON.stringify({ ip: value.trim() ? value.trim() : null }),
      },
      getStoredToken()
    );
    setActionBusy(null);
    if (!res.data) {
      setError(getApiErrorMessage(res) || 'Não foi possível guardar o IP');
      return;
    }
    setGuests((prev) =>
      prev.map((item) =>
        item.type === guest.type && item.vmid === guest.vmid ? { ...item, ...res.data } : item
      )
    );
    setMessage(`IP de ${guest.name} actualizado.`);
  };

  const copyIp = async (ip: string) => {
    try {
      await navigator.clipboard.writeText(ip);
      setMessage(`IP copiado: ${ip}`);
    } catch {
      setError('Não foi possível copiar o IP');
    }
  };

  const running = guests.filter((g) => isRunning(g.status)).length;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Guests · ${serverLabel}`}
        panelClassName="max-w-5xl"
        scrollBody
        showCloseButton
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {loading
              ? 'A carregar…'
              : `${guests.length} guests · ${running} online · ${guests.length - running} offline`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => void loadGuests()} disabled={loading}>
              Actualizar
            </button>
            {serverId ? (
              <Link
                href={`${WEB_ROUTES.dashboard.virtualization.pve}?server=${serverId}`}
                className="btn-secondary text-xs"
                onClick={onClose}
              >
                Ver storages / detalhe
              </Link>
            ) : null}
          </div>
        </div>

        {message ? (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {loading && guests.length === 0 ? (
          <p className="text-sm text-slate-500">A carregar VMs e CTs…</p>
        ) : guests.length === 0 ? (
          <p className="text-sm text-slate-500">Sem VMs/CTs neste servidor.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-3 font-medium">ID</th>
                  <th className="pb-2 pr-3 font-medium">Nome</th>
                  <th className="pb-2 pr-3 font-medium">Tipo</th>
                  <th className="pb-2 pr-3 font-medium">Estado</th>
                  <th className="pb-2 pr-3 font-medium">IP</th>
                  <th className="pb-2 pr-3 font-medium">RAM</th>
                  <th className="pb-2 font-medium">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {guests.map((guest) => {
                  const online = isRunning(guest.status);
                  const key = guestKey(guest);
                  const busy = actionBusy === key;
                  return (
                    <tr key={key}>
                      <td className="py-2 pr-3 font-mono text-xs text-slate-700">{guest.vmid}</td>
                      <td className="py-2 pr-3 font-medium text-slate-900">
                        <span className="block truncate" title={guest.name}>
                          {guest.name}
                        </span>
                        <span className="text-[10px] text-slate-400">{guest.node}</span>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {guest.type === 'qemu' ? 'VM' : 'CT'}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            online
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {online ? 'online' : guest.status || 'offline'}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex min-w-[8rem] items-center gap-1">
                          <span className="font-mono text-xs text-slate-700">
                            {guest.manualIp || '—'}
                          </span>
                          <button
                            type="button"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            title="Editar IP"
                            disabled={busy}
                            onClick={() => void editIp(guest)}
                          >
                            <Pencil size={12} />
                          </button>
                          {guest.manualIp ? (
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              title="Copiar IP"
                              onClick={() => void copyIp(guest.manualIp!)}
                            >
                              <Copy size={12} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                            title={
                              guest.manualIp
                                ? 'Ping ao IP manual (servidor API)'
                                : 'Defina um IP manual para ping'
                            }
                            disabled={!guest.manualIp || busy}
                            onClick={() => setPingGuest(guest)}
                          >
                            <Radio size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-600">
                        {guest.maxmem && guest.maxmem > 0
                          ? `${formatVirtualizationBytes(guest.mem ?? 0)} / ${formatVirtualizationBytes(guest.maxmem)}`
                          : '—'}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {online ? (
                            <button
                              type="button"
                              className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                              disabled={busy}
                              title="Parar"
                              onClick={() => void powerGuest(guest, 'stop')}
                            >
                              <Square size={11} />
                              Stop
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                              disabled={busy}
                              title="Iniciar"
                              onClick={() => void powerGuest(guest, 'start')}
                            >
                              <Play size={11} />
                              Start
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={!online || busy}
                            title={online ? 'Abrir consola' : 'Máquina parada'}
                            onClick={() => void openConsole(guest)}
                          >
                            Consola
                          </button>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={!online || busy}
                            title={online ? 'SSH ao guest' : 'Máquina parada'}
                            onClick={() => openSsh(guest)}
                          >
                            SSH
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <PveConsoleModal
        open={Boolean(consoleSession)}
        onClose={() => setConsoleSession(null)}
        workspaceId={workspaceId}
        session={consoleSession}
      />

      {serverId ? (
        <PveGuestPingModal
          open={Boolean(pingGuest)}
          onClose={() => setPingGuest(null)}
          workspaceId={workspaceId}
          serverId={serverId}
          guest={pingGuest}
        />
      ) : null}

      {serverId ? (
        <PveSshModal
          open={Boolean(sshGuest)}
          onClose={() => setSshGuest(null)}
          workspaceId={workspaceId}
          serverId={serverId}
          guest={sshGuest}
        />
      ) : null}
      {promptDialog}
      {confirmDialog}
    </>
  );
}
