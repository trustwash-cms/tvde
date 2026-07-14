'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface Fail2banEntry {
  ip: string;
  attempts: number;
  blocked: boolean;
  ttlSeconds: number;
}

interface Fail2banData {
  entries: Fail2banEntry[];
  maxAttempts: number;
  blockTtlSeconds: number;
}

function formatTtl(seconds: number): string {
  if (seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes === 0) return `${secs}s`;
  return `${minutes}m ${secs}s`;
}

export function SettingsFail2banPanel() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [data, setData] = useState<Fail2banData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyIp, setBusyIp] = useState<string | null>(null);
  const [manualIp, setManualIp] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiFetch<Fail2banData>(API_PATHS.platform.fail2ban.list, {}, getStoredToken());
    if (res.success && res.data) {
      setData(res.data);
    } else {
      setError(getApiErrorMessage(res));
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function unblockIp(ip: string) {
    const ok = await confirm({
      title: 'Desbloquear IP',
      message: `Remover o bloqueio fail2ban para ${ip}? O endereço poderá voltar a tentar login de imediato.`,
      confirmLabel: 'Desbloquear',
    });
    if (!ok) return;

    setBusyIp(ip);
    setError('');
    setSuccess('');

    const res = await apiFetch<{ ip: string }>(
      API_PATHS.platform.fail2ban.unblock,
      { method: 'POST', body: JSON.stringify({ ip }) },
      getStoredToken()
    );

    if (res.success) {
      setSuccess(`IP ${ip} desbloqueado.`);
      await load();
    } else {
      setError(getApiErrorMessage(res));
    }

    setBusyIp(null);
  }

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    const ip = manualIp.trim();
    if (!ip) return;
    await unblockIp(ip);
    setManualIp('');
  }

  const blocked = data?.entries.filter((entry) => entry.blocked) ?? [];

  return (
    <div className="space-y-6">
      {confirmDialog}

      <div>
        <h2 className="text-lg font-semibold text-slate-900">IPs bloqueados (fail2ban)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Após {data?.maxAttempts ?? 5} tentativas de login falhadas, o IP fica bloqueado durante{' '}
          {Math.round((data?.blockTtlSeconds ?? 900) / 60)} minutos. Apenas MASTER pode desbloquear.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      )}

      <form onSubmit={handleManualSubmit} className="card flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700">Desbloquear IP manualmente</label>
          <input
            type="text"
            className="input w-full font-mono text-sm"
            placeholder="Ex.: 203.0.113.42"
            value={manualIp}
            onChange={(e) => setManualIp(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary shrink-0" disabled={!manualIp.trim() || busyIp !== null}>
          Desbloquear
        </button>
      </form>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          {loading
            ? 'A carregar…'
            : blocked.length === 0
              ? 'Nenhum IP bloqueado de momento.'
              : `${blocked.length} IP(s) bloqueado(s)`}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={() => load()} disabled={loading}>
          Actualizar
        </button>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-6 py-3">IP</th>
              <th className="px-6 py-3">Tentativas</th>
              <th className="px-6 py-3">Estado</th>
              <th className="px-6 py-3">Expira em</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.entries ?? []).map((entry) => (
              <tr key={entry.ip} className="border-b last:border-0">
                <td className="px-6 py-4 font-mono text-xs">{entry.ip}</td>
                <td className="px-6 py-4">
                  {entry.attempts}/{data?.maxAttempts ?? 5}
                </td>
                <td className="px-6 py-4">
                  {entry.blocked ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                      Bloqueado
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      A monitorizar
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-slate-500">{formatTtl(entry.ttlSeconds)}</td>
                <td className="px-6 py-4 text-right">
                  <button
                    type="button"
                    className="text-sm font-medium text-[var(--color-primary)] hover:underline disabled:opacity-50"
                    disabled={busyIp === entry.ip}
                    onClick={() => unblockIp(entry.ip)}
                  >
                    {busyIp === entry.ip ? 'A desbloquear…' : 'Desbloquear'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && (data?.entries.length ?? 0) === 0 && (
          <div className="py-10 text-center text-slate-400">Sem entradas activas no Redis</div>
        )}
      </div>
    </div>
  );
}
