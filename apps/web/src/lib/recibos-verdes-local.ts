import type { RecibosVerdesCatalogItem, RecibosVerdesDraft } from '@tvde/shared';

const CATALOG_PREFIX = 'tvde.rv.catalog.';
const ADQUIRENTE_PREFIX = 'tvde.rv.adquirentes.';
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

export type AdquirenteLocal = {
  nif: string;
  nome: string;
  pais: string;
  morada: string;
  codigoPostal: string;
  localidade: string;
  updatedAt: string;
};

export function loadAdquirentesLocal(workspaceId: string): AdquirenteLocal[] {
  return readJson(`${ADQUIRENTE_PREFIX}${workspaceId}`, []);
}

export function findAdquirenteLocal(
  workspaceId: string,
  nif: string
): AdquirenteLocal | null {
  const normalized = nif.replace(/\D/g, '');
  if (!normalized) return null;
  return (
    loadAdquirentesLocal(workspaceId).find((a) => a.nif.replace(/\D/g, '') === normalized) ??
    null
  );
}

export function upsertAdquirenteLocal(
  workspaceId: string,
  item: Omit<AdquirenteLocal, 'updatedAt'>
): AdquirenteLocal[] {
  const list = loadAdquirentesLocal(workspaceId);
  const nif = item.nif.replace(/\D/g, '');
  const nextItem: AdquirenteLocal = { ...item, nif, updatedAt: new Date().toISOString() };
  const idx = list.findIndex((a) => a.nif.replace(/\D/g, '') === nif);
  const next = [...list];
  if (idx >= 0) next[idx] = nextItem;
  else next.unshift(nextItem);
  writeJson(`${ADQUIRENTE_PREFIX}${workspaceId}`, next);
  return next;
}

/** Tenta extrair CP e localidade de uma morada numa só linha. */
export function parseMoradaPt(moradaRaw: string): {
  morada: string;
  codigoPostal: string;
  localidade: string;
} {
  const morada = moradaRaw.trim();
  if (!morada) return { morada: '', codigoPostal: '', localidade: '' };
  const m = morada.match(/^(.*?)\s+(\d{4}-\d{3})\s+(.+)$/);
  if (m) {
    return { morada: m[1].trim(), codigoPostal: m[2], localidade: m[3].trim() };
  }
  return { morada, codigoPostal: '', localidade: '' };
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
