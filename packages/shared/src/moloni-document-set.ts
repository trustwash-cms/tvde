export type MoloniDocumentSetHealthSeverity = 'ok' | 'warning' | 'error';

export interface MoloniDocumentSetHealth {
  ok: boolean;
  severity: MoloniDocumentSetHealthSeverity;
  storedDocumentSetId: number | null;
  resolvedDocumentSetId: number | null;
  recommendedSetName: string | null;
  eligibleSets: Array<{ id: number; name: string; isDefault: boolean }>;
  userMessage: string;
  technicalDetail: string | null;
}

const MOLONI_DETAIL_MARKER = 'Detalhe Moloni: ';

/** Separa mensagem legível do detalhe técnico Moloni (calendário / emissão). */
export function parseMoloniInvoiceErrorMessage(raw: string): {
  summary: string;
  technical: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { summary: 'Erro desconhecido na emissão.', technical: null };

  const markerIdx = trimmed.indexOf(MOLONI_DETAIL_MARKER);
  if (markerIdx >= 0) {
    return {
      summary: trimmed.slice(0, markerIdx).trim(),
      technical: trimmed.slice(markerIdx + MOLONI_DETAIL_MARKER.length).trim() || null,
    };
  }

  if (/document_set_id|document_set_wsat_id/i.test(trimmed)) {
    return {
      summary:
        'Série documental Moloni inválida ou não comunicada à AT. Actualize em Definições → Moloni e seleccione a série correcta (ex. M2026).',
      technical: trimmed,
    };
  }

  return { summary: trimmed, technical: null };
}
