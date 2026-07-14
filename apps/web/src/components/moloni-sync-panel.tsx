'use client';

import { useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface MoloniSyncPanelProps {
  workspaceId: string | null;
  healthy: boolean;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

function formatSyncSuccess(data: unknown): string {
  const d = data as {
    entities?: {
      customers?: number;
      suppliers?: number;
      staleUnlinked?: number;
      duplicatesMerged?: number;
    };
    documents?: { imported?: number; updated?: number; moloniInvoiceCount?: number | null };
  };
  const apiNote =
    d.documents?.moloniInvoiceCount != null
      ? ` (API: ${d.documents.moloniInvoiceCount} faturas)`
      : '';
  const staleNote =
    d.entities?.staleUnlinked != null && d.entities.staleUnlinked > 0
      ? ` · ${d.entities.staleUnlinked} ligações antigas removidas`
      : '';
  const dedupeNote =
    d.entities?.duplicatesMerged != null && d.entities.duplicatesMerged > 0
      ? ` · ${d.entities.duplicatesMerged} duplicados fundidos`
      : '';
  return (
    `Sincronização concluída: ${d.entities?.customers ?? 0} clientes, ${d.entities?.suppliers ?? 0} fornecedores · ` +
    `${d.documents?.imported ?? 0} docs novos, ${d.documents?.updated ?? 0} actualizados${apiNote}${staleNote}${dedupeNote}`
  );
}

export function MoloniSyncPanel({
  workspaceId,
  healthy,
  onSuccess,
  onError,
}: MoloniSyncPanelProps) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function syncNow() {
    if (!workspaceId) return;
    setLoading(true);
    onError?.('');
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.syncAll, workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      onSuccess?.(formatSyncSuccess(res.data));
    } else {
      onError?.(getApiErrorMessage(res));
    }
  }

  async function resetLinks() {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Repor ligações Moloni',
      message:
        'Remove todos os IDs Moloni locais (clientes, catálogo) e prepara nova importação da conta actual. ' +
        'Os registos CMS mantêm-se; faturas antigas permanecem no histórico local. Continuar?',
      confirmLabel: 'Repor ligações',
      variant: 'danger',
    });
    if (!ok) return;

    setResetting(true);
    onError?.('');
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.moloniResetLinks, workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setResetting(false);
    if (res.success) {
      const d = res.data as { entitiesUnlinked?: number; catalogCleared?: number };
      onSuccess?.(
        `Ligações removidas (${d.entitiesUnlinked ?? 0} entidades, ${d.catalogCleared ?? 0} itens de catálogo). ` +
          'Clique em «Sincronizar agora» para importar da conta Moloni actual.'
      );
    } else {
      onError?.(getApiErrorMessage(res));
    }
  }

  if (!workspaceId || !healthy) return null;

  return (
    <>
      {confirmDialog}
    <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Sincronização Moloni</h3>
        <p className="mt-1 text-xs text-slate-500">
          Importa clientes, fornecedores, impostos/séries e documentos da conta Moloni seleccionada.
          Se mudou de conta (ex. Projstox → demo), use primeiro «Limpar ligações antigas» e depois
          sincronize — caso contrário ficam IDs da conta anterior.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={loading || resetting}
          onClick={() => void syncNow()}
        >
          {loading ? 'A sincronizar…' : 'Sincronizar agora'}
        </button>
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={loading || resetting}
          onClick={() => void resetLinks()}
        >
          {resetting ? 'A limpar…' : 'Limpar ligações antigas'}
        </button>
      </div>
    </section>
    </>
  );
}
