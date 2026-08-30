'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VirtualizationPveGuest, VirtualizationPveGuestPingResult } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { Modal } from '@/components/modal';

interface PveGuestPingModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null | undefined;
  serverId: string;
  guest: VirtualizationPveGuest | null;
}

export function PveGuestPingModal({
  open,
  onClose,
  workspaceId,
  serverId,
  guest,
}: PveGuestPingModalProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VirtualizationPveGuestPingResult | null>(null);
  const [error, setError] = useState('');

  const runPing = useCallback(async () => {
    if (!guest || !workspaceId) return;
    if (!guest.manualIp?.trim()) {
      setError('Defina um IP manual na coluna IP antes de fazer ping.');
      setResult(null);
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    const res = await apiFetch<VirtualizationPveGuestPingResult>(
      withWorkspaceQuery(
        API_PATHS.virtualization.pveServerGuestPing(serverId, guest.type, guest.vmid),
        workspaceId
      ),
      { method: 'POST' },
      getStoredToken()
    );

    setLoading(false);
    if (res.data) {
      setResult(res.data);
    } else {
      setError(getApiErrorMessage(res) || 'Não foi possível executar o ping');
    }
  }, [guest, serverId, workspaceId]);

  useEffect(() => {
    if (open && guest) {
      void runPing();
    } else {
      setResult(null);
      setError('');
      setLoading(false);
    }
  }, [open, guest, runPing]);

  const summary =
    result && !loading
      ? result.success
        ? `Resposta de ${result.host} · ${result.packetsReceived}/${result.packetsSent} pacotes · perda ${result.packetLossPercent}%${
            result.avgMs != null ? ` · média ${result.avgMs} ms` : ''
          }`
        : `Sem resposta de ${result.host} · perda ${result.packetLossPercent}%`
      : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={guest ? `Ping · ${guest.name}` : 'Ping'}
      panelClassName="max-w-lg"
      scrollBody
      showCloseButton
      overlayClassName="z-[70]"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Fechar
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={loading || !guest?.manualIp}
            onClick={() => void runPing()}
          >
            {loading ? 'A pingar…' : 'Repetir'}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Ping executado a partir do servidor API (mesmo caminho que o SSH), usando o IP manual{' '}
        <span className="font-mono text-slate-700">{guest?.manualIp || '—'}</span>.
      </p>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-600">A enviar 4 pacotes ICMP…</p>
      ) : result ? (
        <>
          <div
            className={`mb-3 rounded-lg border p-3 text-sm ${
              result.success
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            {summary}
            {result.error ? <span className="mt-1 block text-xs opacity-90">{result.error}</span> : null}
          </div>
          <pre className="max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
            {result.output || '(sem saída)'}
          </pre>
        </>
      ) : null}
    </Modal>
  );
}
