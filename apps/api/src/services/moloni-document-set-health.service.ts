import { prisma } from '@tvde/database';
import { assessMoloniDocumentSet } from '@tvde/billing';
import type { MoloniDocumentSetRow } from '@tvde/billing';
import type { MoloniDocumentSetHealth } from '@tvde/shared';
import { ensureMoloniAccessToken } from './moloni-connection.service';

export async function getMoloniDocumentSetHealth(workspaceId: string): Promise<MoloniDocumentSetHealth> {
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);

  if (!row.companyId) {
    return {
      ok: false,
      severity: 'error',
      storedDocumentSetId: row.documentSetId,
      resolvedDocumentSetId: null,
      recommendedSetName: null,
      eligibleSets: [],
      userMessage: 'Empresa Moloni não seleccionada — escolha a empresa em Definições → Moloni.',
      technicalDetail: null,
    };
  }

  const sets = await moloniClient.getDocumentSets(row.companyId);
  return assessMoloniDocumentSet(sets as MoloniDocumentSetRow[], 'invoice', row.documentSetId);
}

export async function applyRecommendedMoloniDocumentSet(
  workspaceId: string
): Promise<MoloniDocumentSetHealth> {
  const health = await getMoloniDocumentSetHealth(workspaceId);

  if (
    health.resolvedDocumentSetId != null &&
    health.resolvedDocumentSetId !== health.storedDocumentSetId
  ) {
    await prisma.billingConnection.update({
      where: { workspaceId },
      data: { documentSetId: health.resolvedDocumentSetId },
    });
  }

  return getMoloniDocumentSetHealth(workspaceId);
}
