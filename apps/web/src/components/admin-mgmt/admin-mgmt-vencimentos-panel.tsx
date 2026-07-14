'use client';

import { useEffect, useState } from 'react';
import {
  getAdminMgmtVencimentoOrigemLabel,
  getAdminMgmtVencimentoStatusLabel,
  vencimentoUrgencyClass,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';

interface VencimentoRow {
  id: string;
  origemTipo: string;
  descricao: string;
  dataVencimento: string;
  valorAssociado: string | null;
  status: string;
  responsavel: string | null;
}

export function AdminMgmtVencimentosPanel() {
  const { workspaceId } = useWorkspaceContext();
  const [rows, setRows] = useState<VencimentoRow[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    if (!workspaceId) return;
    apiFetch<VencimentoRow[]>(
      withWorkspaceQuery(API_PATHS.adminMgmt.vencimentos, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setRows(res.data);
      else setError(getApiErrorMessage(res));
    });
  }

  useEffect(load, [workspaceId]);

  async function resolveItem(id: string) {
    if (!workspaceId) return;
    setBusyId(id);
    const res = await apiFetch(
      API_PATHS.adminMgmt.vencimentoResolve(id),
      { method: 'POST', body: JSON.stringify({ workspaceId }) },
      getStoredToken()
    );
    setBusyId(null);
    if (res.success) load();
    else setError(getApiErrorMessage(res));
  }

  if (!workspaceId) return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Vencimentos e alertas</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Sem vencimentos registados.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`card flex flex-wrap items-center justify-between gap-3 border ${vencimentoUrgencyClass(row.dataVencimento, row.status)}`}
            >
              <div>
                <p className="font-medium">{row.descricao}</p>
                <p className="text-xs opacity-80">
                  {getAdminMgmtVencimentoOrigemLabel(row.origemTipo)} ·{' '}
                  {new Date(row.dataVencimento).toLocaleDateString('pt-PT')} ·{' '}
                  {getAdminMgmtVencimentoStatusLabel(row.status)}
                  {row.responsavel ? ` · ${row.responsavel}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {row.valorAssociado && (
                  <span className="font-mono text-sm">{Number(row.valorAssociado).toFixed(2)} €</span>
                )}
                {row.status !== 'resolvido' && (
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={busyId === row.id}
                    onClick={() => void resolveItem(row.id)}
                  >
                    Marcar resolvido
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
