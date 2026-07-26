import type { MoloniDocumentTypeId } from '../../types';
import type { MoloniDocumentSetRow } from './client';

/** IDs Moloni (document_type_id) por tipo CMS — ver documentTypes na API Moloni. */
export const MOLONI_DOCUMENT_TYPE_NUMERIC_ID: Record<MoloniDocumentTypeId, number> = {
  invoice: 1,
  simplified_invoice: 20,
  invoice_receipt: 27,
  debit_note: 4,
};

type DocumentSetAtCode = {
  document_type_id?: number;
  document_set_wsat_id?: number;
};

type DocumentSetTypeNumber = {
  document_type_id?: number;
};

export type MoloniDocumentSetWithTypes = MoloniDocumentSetRow & {
  document_types_numbers?: DocumentSetTypeNumber[];
  document_set_at_codes?: DocumentSetAtCode[];
};

function supportsDocumentType(set: MoloniDocumentSetWithTypes, typeId: number): boolean {
  return set.document_types_numbers?.some((row) => row.document_type_id === typeId) ?? false;
}

function hasAtRegistration(set: MoloniDocumentSetWithTypes, typeId: number): boolean {
  return set.document_set_at_codes?.some((row) => row.document_type_id === typeId) ?? false;
}

/**
 * Escolhe a série documental Moloni válida para um tipo de documento.
 * Preferência: ID guardado (se válido) → série default → única elegível.
 */
export function resolveMoloniDocumentSetId(
  sets: MoloniDocumentSetWithTypes[],
  documentType: MoloniDocumentTypeId,
  preferredSetId?: number | null
): number {
  const typeId = MOLONI_DOCUMENT_TYPE_NUMERIC_ID[documentType];

  const eligible = sets.filter(
    (set) => supportsDocumentType(set, typeId) && hasAtRegistration(set, typeId)
  );

  if (preferredSetId && eligible.some((set) => set.document_set_id === preferredSetId)) {
    return preferredSetId;
  }

  const defaultEligible = eligible.find((set) => set.active_by_default === 1);
  if (defaultEligible) return defaultEligible.document_set_id;

  if (eligible.length >= 1) return eligible[0]!.document_set_id;

  const partial = sets.filter((set) => supportsDocumentType(set, typeId));
  if (preferredSetId && partial.some((set) => set.document_set_id === preferredSetId)) {
    return preferredSetId;
  }

  const partialDefault = partial.find((set) => set.active_by_default === 1) ?? partial[0];
  if (partialDefault) return partialDefault.document_set_id;

  const validIds = partial.map((set) => set.document_set_id);
  throw new Error(
    validIds.length
      ? `Série documental inválida para ${documentType}. Opções Moloni: ${validIds.join(', ')}. Comunique a série à AT no Moloni.`
      : `Nenhuma série Moloni configurada para ${documentType}`
  );
}

export type MoloniDocumentSetHealthSeverity = 'ok' | 'warning' | 'error';

export type MoloniDocumentSetHealth = {
  ok: boolean;
  severity: MoloniDocumentSetHealthSeverity;
  storedDocumentSetId: number | null;
  resolvedDocumentSetId: number | null;
  recommendedSetName: string | null;
  eligibleSets: Array<{ id: number; name: string; isDefault: boolean }>;
  userMessage: string;
  technicalDetail: string | null;
};

function mapEligibleSets(sets: MoloniDocumentSetWithTypes[], typeId: number) {
  return sets
    .filter((set) => supportsDocumentType(set, typeId) && hasAtRegistration(set, typeId))
    .map((set) => ({
      id: set.document_set_id,
      name: set.name?.trim() || `Série ${set.document_set_id}`,
      isDefault: set.active_by_default === 1,
    }));
}

/** Diagnóstico proactivo da série documental (sem emitir documento). */
export function assessMoloniDocumentSet(
  sets: MoloniDocumentSetWithTypes[],
  documentType: MoloniDocumentTypeId,
  storedDocumentSetId?: number | null
): MoloniDocumentSetHealth {
  const typeId = MOLONI_DOCUMENT_TYPE_NUMERIC_ID[documentType];
  const eligibleSets = mapEligibleSets(sets, typeId);

  if (eligibleSets.length === 0) {
    const partial = sets.filter((set) => supportsDocumentType(set, typeId));
    const partialIds = partial.map((set) => set.document_set_id);
    return {
      ok: false,
      severity: 'error',
      storedDocumentSetId: storedDocumentSetId ?? null,
      resolvedDocumentSetId: null,
      recommendedSetName: null,
      eligibleSets: [],
      userMessage:
        'Nenhuma série Moloni comunicada à AT para faturas. Comunique a série no painel Moloni antes de emitir.',
      technicalDetail: partialIds.length
        ? `Séries encontradas sem registo AT para faturas: ${partialIds.join(', ')}`
        : 'Nenhuma série Moloni configurada para faturas nesta empresa.',
    };
  }

  const storedValid = eligibleSets.some((set) => set.id === storedDocumentSetId);
  const defaultEligible = eligibleSets.find((set) => set.isDefault) ?? eligibleSets[0]!;
  const resolvedDocumentSetId =
    storedValid && storedDocumentSetId != null ? storedDocumentSetId : defaultEligible.id;
  const resolvedSet = eligibleSets.find((set) => set.id === resolvedDocumentSetId);
  const recommendedSetName = resolvedSet?.name ?? `ID ${resolvedDocumentSetId}`;

  if (storedDocumentSetId == null) {
    return {
      ok: true,
      severity: 'warning',
      storedDocumentSetId: null,
      resolvedDocumentSetId,
      recommendedSetName,
      eligibleSets,
      userMessage: `Nenhuma série seleccionada no CMS. Recomendado: ${recommendedSetName} (${resolvedDocumentSetId}).`,
      technicalDetail: null,
    };
  }

  if (storedValid) {
    const storedSet = eligibleSets.find((set) => set.id === storedDocumentSetId);
    return {
      ok: true,
      severity: 'ok',
      storedDocumentSetId,
      resolvedDocumentSetId: storedDocumentSetId,
      recommendedSetName: storedSet?.name ?? null,
      eligibleSets,
      userMessage: `Série activa: ${storedSet?.name ?? storedDocumentSetId}.`,
      technicalDetail: null,
    };
  }

  const storedExists = sets.some((set) => set.document_set_id === storedDocumentSetId);
  const technicalDetail = storedExists
    ? `A série ${storedDocumentSetId} existe no Moloni mas não está comunicada à AT para faturas.`
    : `A série ${storedDocumentSetId} já não existe na empresa Moloni actual (ligação ou empresa pode ter mudado).`;

  return {
    ok: false,
    severity: 'warning',
    storedDocumentSetId,
    resolvedDocumentSetId,
    recommendedSetName,
    eligibleSets,
    userMessage: `Série documental obsoleta (${storedDocumentSetId}). Seleccione ${recommendedSetName} (${resolvedDocumentSetId}) — válida para emissão de faturas.`,
    technicalDetail,
  };
}

/** Mensagem legível para erros Moloni de série documental / AT / categoria / produto. */
export function formatMoloniDocumentSetError(message: string): string {
  if (/document_set_id|document_set_wsat_id/i.test(message)) {
    return (
      'Série documental Moloni inválida ou não comunicada à AT. ' +
      'Em Definições → Moloni, seleccione a série correcta (ex. M2026) e confirme a comunicação à Autoridade Tributária. ' +
      `Detalhe Moloni: ${message}`
    );
  }
  if (/categor|category_id/i.test(message) && !/categoria por defeito/i.test(message)) {
    return (
      'Categoria Moloni em falta ou inválida na linha do documento. ' +
      'Seleccione uma categoria por defeito em Configurações → Moloni (necessária para linhas manuais). ' +
      `Detalhe: ${message}`
    );
  }
  if (/product_id/i.test(message) && !/sem product_id/i.test(message)) {
    return (
      'Artigo Moloni em falta na linha — para linhas manuais configure a categoria por defeito em Configurações → Moloni. ' +
      `Detalhe: ${message}`
    );
  }
  return message;
}
