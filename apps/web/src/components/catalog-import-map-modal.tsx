'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  CATALOG_IMPORT_FIELD_OPTIONS,
  CATALOG_IMPORT_IGNORE,
  CATALOG_IMPORT_MAX_ROWS,
  applyCatalogImportMapping,
  buildCatalogImportCsvFromRows,
  getCatalogImportColumnCount,
  guessCatalogFieldMapping,
  padCatalogImportRows,
  validateCatalogImportMapping,
} from '@tvde/shared';
import { Modal } from '@/components/modal';

const PREVIEW_ROWS = 8;

interface CatalogImportMapModalProps {
  open: boolean;
  fileName: string;
  rows: string[][];
  allowUpdateExisting?: boolean;
  onClose: () => void;
  onConfirm: (csvText: string, rowCount: number, updateExisting: boolean) => void;
}

export function CatalogImportMapModal({
  open,
  fileName,
  rows,
  allowUpdateExisting = false,
  onClose,
  onConfirm,
}: CatalogImportMapModalProps) {
  const columnCount = useMemo(() => getCatalogImportColumnCount(rows), [rows]);
  const paddedRows = useMemo(() => padCatalogImportRows(rows, columnCount), [rows, columnCount]);

  const [hasHeader, setHasHeader] = useState(true);
  const [headerConfirmed, setHeaderConfirmed] = useState(false);
  const [columnMapping, setColumnMapping] = useState<string[]>([]);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;

    const headerLabels = hasHeader
      ? (paddedRows[0] ?? []).map((label, index) => label.trim() || `Coluna ${index + 1}`)
      : Array.from({ length: columnCount }, (_, index) => `Coluna ${index + 1}`);

    setColumnMapping(guessCatalogFieldMapping(headerLabels));
    setHeaderConfirmed(false);
    setUpdateExisting(true);
    setError('');
  }, [open, hasHeader, paddedRows, columnCount]);

  const columnLabels = useMemo(() => {
    if (!hasHeader) {
      return Array.from({ length: columnCount }, (_, index) => `Coluna ${index + 1}`);
    }
    return (paddedRows[0] ?? []).map((label, index) => label.trim() || `Coluna ${index + 1}`);
  }, [hasHeader, paddedRows, columnCount]);

  const previewRows = useMemo(() => {
    const dataRows = hasHeader ? paddedRows.slice(1) : paddedRows;
    return dataRows.filter((row) => row.some((cell) => cell.trim())).slice(0, PREVIEW_ROWS);
  }, [hasHeader, paddedRows]);

  const mappedPreviewCount = useMemo(() => {
    return applyCatalogImportMapping({
      rows: paddedRows,
      hasHeader,
      columnMapping,
    }).length;
  }, [paddedRows, hasHeader, columnMapping]);

  function updateMapping(columnIndex: number, fieldKey: string) {
    setColumnMapping((current) => {
      const next = [...current];
      while (next.length < columnCount) next.push(CATALOG_IMPORT_IGNORE);
      next[columnIndex] = fieldKey;
      return next;
    });
  }

  function handleConfirm() {
    setError('');

    if (hasHeader && !headerConfirmed) {
      setError('Confirme que a primeira linha é o cabeçalho');
      return;
    }

    const mappingError = validateCatalogImportMapping(columnMapping);
    if (mappingError) {
      setError(mappingError);
      return;
    }

    const mappedRows = applyCatalogImportMapping({
      rows: paddedRows,
      hasHeader,
      columnMapping,
    });

    if (!mappedRows.length) {
      setError('Não foram encontradas linhas com dados para importar');
      return;
    }

    if (mappedRows.length > CATALOG_IMPORT_MAX_ROWS) {
      setError(`Máximo de ${CATALOG_IMPORT_MAX_ROWS} linhas por importação`);
      return;
    }

    onConfirm(buildCatalogImportCsvFromRows(mappedRows), mappedRows.length, updateExisting);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar em lote"
      panelClassName="max-w-5xl"
      scrollBody
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {mappedPreviewCount} linha{mappedPreviewCount === 1 ? '' : 's'} pronta
            {mappedPreviewCount === 1 ? '' : 's'} para importar
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={handleConfirm}>
              Importar
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{fileName}</p>
            <p className="text-xs text-slate-500">Mapeie as colunas do ficheiro para os campos do catálogo.</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-700"
            aria-label="Fechar"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
            />
            <span>A primeira linha é cabeçalho (nomes das colunas)</span>
          </label>
          {hasHeader && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={headerConfirmed}
                onChange={(e) => setHeaderConfirmed(e.target.checked)}
              />
              <span>Confirmo que a primeira linha contém os títulos das colunas e não dados</span>
            </label>
          )}
          {allowUpdateExisting && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
              />
              <span>Actualizar registos com a mesma referência (não duplica)</span>
            </label>
          )}
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
                {columnLabels.map((label, index) => (
                  <th key={`header-${index}`} className="px-3 py-2 font-medium whitespace-nowrap">
                    {label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-slate-100 bg-white">
                {columnLabels.map((_, index) => (
                  <th key={`map-${index}`} className="px-2 py-2">
                    <select
                      className="input text-xs"
                      value={columnMapping[index] ?? CATALOG_IMPORT_IGNORE}
                      onChange={(e) => updateMapping(index, e.target.value)}
                    >
                      {CATALOG_IMPORT_FIELD_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columnLabels.length, 1)} className="px-3 py-6 text-center text-slate-400">
                    Sem linhas de dados — linhas em branco são ignoradas
                  </td>
                </tr>
              ) : (
                previewRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-slate-50 last:border-0">
                    {columnLabels.map((_, columnIndex) => (
                      <td key={columnIndex} className="max-w-[220px] truncate px-3 py-2 text-slate-700">
                        {row[columnIndex] || '—'}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
