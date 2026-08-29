'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  WEB_ROUTES,
  formatVirtualizationBytes,
  type VirtualizationPveConsoleSession,
  type VirtualizationPveGuest,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { Modal } from '@/components/modal';
import { PveConsoleModal } from './pve-console-modal';
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
  const [guests, setGuests] = useState<VirtualizationPveGuest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [consoleSession, setConsoleSession] = useState<VirtualizationPveConsoleSession | null>(null);
  const [sshGuest, setSshGuest] = useState<VirtualizationPveGuest | null>(null);

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

  const running = guests.filter((g) => isRunning(g.status)).length;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Guests · ${serverLabel}`}
        panelClassName="max-w-3xl"
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
                  <th className="pb-2 pr-3 font-medium">Node</th>
                  <th className="pb-2 pr-3 font-medium">Estado</th>
                  <th className="pb-2 pr-3 font-medium">RAM</th>
                  <th className="pb-2 font-medium">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {guests.map((guest) => {
                  const online = isRunning(guest.status);
                  const key = guestKey(guest);
                  return (
                    <tr key={key}>
                      <td className="py-2 pr-3 font-mono text-xs text-slate-700">{guest.vmid}</td>
                      <td className="py-2 pr-3 font-medium text-slate-900">{guest.name}</td>
                      <td className="py-2 pr-3 text-slate-600">
                        {guest.type === 'qemu' ? 'VM' : 'CT'}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{guest.node}</td>
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
                      <td className="py-2 pr-3 text-xs text-slate-600">
                        {guest.maxmem && guest.maxmem > 0
                          ? `${formatVirtualizationBytes(guest.mem ?? 0)} / ${formatVirtualizationBytes(guest.maxmem)}`
                          : '—'}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={!online || actionBusy === key}
                            title={
                              online
                                ? 'Abrir consola (VNC / term)'
                                : 'Máquina parada'
                            }
                            onClick={() => void openConsole(guest)}
                          >
                            Consola
                          </button>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={!online || actionBusy === key}
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
        <PveSshModal
          open={Boolean(sshGuest)}
          onClose={() => setSshGuest(null)}
          workspaceId={workspaceId}
          serverId={serverId}
          guest={sshGuest}
        />
      ) : null}
    </>
  );
}
