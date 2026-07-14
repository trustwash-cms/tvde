'use client';

import { useEffect, useState } from 'react';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';

interface SmsLogRow {
  id: string;
  toPhone: string;
  bodyPreview: string;
  provider: string;
  purpose: string;
  status: string;
  externalId: string | null;
  errorMessage: string | null;
  mocked: boolean;
  createdAt: string;
  user?: { email: string } | null;
}

interface SmsHistoryResponse {
  items: SmsLogRow[];
  total: number;
  page: number;
  limit: number;
}

const PURPOSE_LABELS: Record<string, string> = {
  test: 'Teste',
  otp: '2FA OTP',
  manual: 'Manual',
};

function statusLabel(row: SmsLogRow): { text: string; className: string } {
  if (row.status === 'failed') {
    return { text: 'Erro', className: 'bg-red-100 text-red-800' };
  }
  if (row.status === 'mocked' || row.mocked) {
    return { text: 'Simulado', className: 'bg-amber-100 text-amber-900' };
  }
  return { text: 'Enviado', className: 'bg-green-100 text-green-800' };
}

interface SmsHistoryModalProps {
  open: boolean;
  onClose: () => void;
}

export function SmsHistoryModal({ open, onClose }: SmsHistoryModalProps) {
  const [logs, setLogs] = useState<SmsLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const limit = 50;

  useEffect(() => {
    if (!open) return;
    setPage(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    apiFetch<SmsHistoryResponse>(
      `${API_PATHS.platform.smsHistory}?page=${page}&limit=${limit}`,
      {},
      getStoredToken()
    ).then((res) => {
      if (res.success && res.data) {
        setLogs(res.data.items);
        setTotal(res.data.total);
      }
      setLoading(false);
    });
  }, [open, page]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <Modal open={open} onClose={onClose} title="Histórico SMS" panelClassName="max-w-5xl">
      <p className="-mt-2 mb-4 text-sm text-slate-500">
        Envios de teste, códigos 2FA e falhas registados pela plataforma.
      </p>

      <div className="max-h-[60vh] overflow-hidden rounded-xl border border-slate-200">
        {loading ? (
          <p className="px-6 py-8 text-sm text-slate-500">A carregar…</p>
        ) : logs.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-500">Ainda não há SMS registados.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="sticky top-0 border-b bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Destinatário</th>
                  <th className="px-4 py-3">Mensagem</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Origem</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => {
                  const status = statusLabel(row);
                  return (
                    <tr key={row.id} className="border-b last:border-0 align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                        {new Date(row.createdAt).toLocaleString('pt-PT')}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{row.toPhone}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="line-clamp-2 text-slate-700">{row.bodyPreview}</p>
                        {row.errorMessage && (
                          <p className="mt-1 text-xs text-red-600">{row.errorMessage}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                        >
                          {status.text}
                        </span>
                        <p className="mt-1 text-xs capitalize text-slate-400">{row.provider}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs break-all">
                        {row.externalId ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {PURPOSE_LABELS[row.purpose] ?? row.purpose}
                        {row.user?.email && (
                          <span className="mt-1 block text-slate-400">{row.user.email}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > limit && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>
            {total} registo{total === 1 ? '' : 's'} — página {page + 1} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Seguinte
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
