import type { RecibosVerdesCatalogItem, RecibosVerdesDraft } from '@tvde/shared';

const CATALOG_PREFIX = 'tvde.rv.catalog.';
const TRANSMITENTE_PREFIX = 'tvde.rv.transmitente.';
const LOCAL_DOCS_PREFIX = 'tvde.rv.local-docs.';

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadRecibosVerdesCatalog(workspaceId: string): RecibosVerdesCatalogItem[] {
  return readJson(`${CATALOG_PREFIX}${workspaceId}`, []);
}

export function saveRecibosVerdesCatalog(
  workspaceId: string,
  items: RecibosVerdesCatalogItem[]
) {
  writeJson(`${CATALOG_PREFIX}${workspaceId}`, items);
}

export function upsertRecibosVerdesCatalogItem(
  workspaceId: string,
  item: RecibosVerdesCatalogItem
): RecibosVerdesCatalogItem[] {
  const list = loadRecibosVerdesCatalog(workspaceId);
  const idx = list.findIndex(
    (x) =>
      x.id === item.id ||
      (x.referencia && item.referencia && x.referencia === item.referencia && x.tipo === item.tipo)
  );
  const next = [...list];
  if (idx >= 0) next[idx] = item;
  else next.unshift(item);
  saveRecibosVerdesCatalog(workspaceId, next);
  return next;
}

export type TransmitenteLocal = {
  nome: string;
  nif: string;
  morada: string;
  atividade: string;
};

export function loadTransmitenteLocal(workspaceId: string): TransmitenteLocal | null {
  return readJson<TransmitenteLocal | null>(`${TRANSMITENTE_PREFIX}${workspaceId}`, null);
}

export function saveTransmitenteLocal(workspaceId: string, data: TransmitenteLocal) {
  writeJson(`${TRANSMITENTE_PREFIX}${workspaceId}`, data);
}

export type RecibosVerdesLocalDoc = {
  id: string;
  createdAt: string;
  situacao: 'rascunho' | 'emitido' | 'pago';
  referencia: string;
  tipoDocumento: string;
  clienteNome: string;
  clienteNif: string;
  dataPrestacao: string;
  total: number;
  draft: RecibosVerdesDraft;
};

export function loadRecibosVerdesLocalDocs(workspaceId: string): RecibosVerdesLocalDoc[] {
  return readJson(`${LOCAL_DOCS_PREFIX}${workspaceId}`, []);
}

export function saveRecibosVerdesLocalDocs(workspaceId: string, docs: RecibosVerdesLocalDoc[]) {
  writeJson(`${LOCAL_DOCS_PREFIX}${workspaceId}`, docs);
}

export function upsertRecibosVerdesLocalDoc(
  workspaceId: string,
  doc: RecibosVerdesLocalDoc
): RecibosVerdesLocalDoc[] {
  const list = loadRecibosVerdesLocalDocs(workspaceId);
  const idx = list.findIndex((d) => d.id === doc.id);
  const next = [...list];
  if (idx >= 0) next[idx] = doc;
  else next.unshift(doc);
  saveRecibosVerdesLocalDocs(workspaceId, next);
  return next;
}
