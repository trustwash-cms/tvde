'use client';

import type { MoloniDocumentSetHealth } from '@tvde/shared';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';

interface MoloniDocumentSetWarningProps {
  workspaceId: string | null;
  health: MoloniDocumentSetHealth | null | undefined;
  onApplied?: () => void;
  compact?: boolean;
}

export function MoloniDocumentSetWarning({
  workspaceId,
  health,
  onApplied,
  compact = false,
}: MoloniDocumentSetWarningProps) {
  if (!health || health.ok) return null;

  async function applyRecommended() {
    if (!workspaceId || health?.resolvedDocumentSetId == null) return;
    const res = await apiFetch<{ documentSetHealth: MoloniDocumentSetHealth }>(
      API_PATHS.billing.moloniApplyDocumentSet,
      {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      },
      getStoredToken()
    );
    if (res.data) onApplied?.();
  }

  const isError = health.severity === 'error';
  const boxClass = isError
    ? 'border-red-200 bg-red-50 text-red-900'
    : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${boxClass}`}>
      <p className="font-medium">
        {isError ? 'Série documental indisponível' : 'Série documental obsoleta'}
      </p>
      <p className="mt-1">{health.userMessage}</p>
      {health.technicalDetail && (
        <details className="mt-2 text-xs opacity-90">
          <summary className="cursor-pointer font-medium">Detalhe técnico</summary>
          <p className="mt-1 font-mono">{health.technicalDetail}</p>
        </details>
      )}
      {!compact && health.eligibleSets.length > 0 && (
        <p className="mt-2 text-xs">
          Séries válidas nesta empresa:{' '}
          {health.eligibleSets
            .map((set) => `${set.name} (${set.id})${set.isDefault ? ', default' : ''}`)
            .join(' · ')}
        </p>
      )}
      {health.resolvedDocumentSetId != null && health.resolvedDocumentSetId !== health.storedDocumentSetId && (
        <div className="mt-3">
          <button
            type="button"
            className={isError ? 'btn-primary' : 'btn-secondary'}
            onClick={() => void applyRecommended()}
            disabled={!workspaceId}
          >
            Usar {health.recommendedSetName ?? `série ${health.resolvedDocumentSetId}`}
          </button>
        </div>
      )}
    </div>
  );
}
