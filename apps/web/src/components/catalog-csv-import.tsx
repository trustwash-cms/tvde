'use client';

import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { buildCatalogImportTemplateCsv, type CatalogImportResult } from '@tvde/shared';
import { getApiUrl, getStoredToken } from '@/lib/api';
import { isCatalogImportFile, parseCatalogImportFile } from '@/lib/catalog-import-file';
import { CatalogImportMapModal } from '@/components/catalog-import-map-modal';

interface CatalogCsvImportProps {
  workspaceId: string | null;
  uploadPath: string;
  extraFields?: Record<string, string>;
  templateFileName: string;
  allowUpdateExisting?: boolean;
  disabled?: boolean;
  onImported: (result: CatalogImportResult) => void;
  onError: (message: string) => void;
}

export function CatalogCsvImport({
  workspaceId,
  uploadPath,
  extraFields,
  templateFileName,
  allowUpdateExisting = false,
  disabled,
  onImported,
  onError,
}: CatalogCsvImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [pendingFileName, setPendingFileName] = useState('');
  const [pendingRows, setPendingRows] = useState<string[][]>([]);

  function downloadTemplate() {
    const csv = buildCatalogImportTemplateCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = templateFileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function resetPicker() {
    if (inputRef.current) inputRef.current.value = '';
  }

  function closeMapper() {
    setMapOpen(false);
    setPendingFileName('');
    setPendingRows([]);
    resetPicker();
  }

  async function uploadCsvText(csvText: string, updateExisting: boolean) {
    if (!workspaceId) {
      onError('Seleccione um workspace');
      return;
    }

    setBusy(true);
    onError('');

    try {
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
      const formData = new FormData();
      formData.append('file', blob, 'import.csv');
      formData.append('workspaceId', workspaceId);
      if (allowUpdateExisting) {
        formData.append('updateExisting', updateExisting ? '1' : '0');
      }
      if (extraFields) {
        Object.entries(extraFields).forEach(([key, value]) => {
          formData.append(key, value);
        });
      }

      const token = getStoredToken();
      const res = await fetch(`${getApiUrl()}${uploadPath}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const raw = await res.text();
      let parsed: { success?: boolean; data?: CatalogImportResult; error?: string } = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = { success: false, error: raw.slice(0, 200) };
      }

      if (!res.ok || !parsed.success || !parsed.data) {
        onError(parsed.error ?? 'Falha na importação');
        return;
      }

      onImported(parsed.data);
      closeMapper();
    } catch {
      onError('Erro de ligação ao servidor');
    } finally {
      setBusy(false);
      resetPicker();
    }
  }

  async function handleFileSelected(file: File) {
    if (!workspaceId) {
      onError('Seleccione um workspace');
      resetPicker();
      return;
    }

    if (!isCatalogImportFile(file)) {
      onError('Formato não suportado — use CSV, XLS ou XLSX');
      resetPicker();
      return;
    }

    onError('');

    try {
      const rows = await parseCatalogImportFile(file);
      if (!rows.length) {
        onError('Ficheiro vazio ou sem linhas legíveis');
        resetPicker();
        return;
      }

      setPendingFileName(file.name);
      setPendingRows(rows);
      setMapOpen(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Não foi possível ler o ficheiro');
      resetPicker();
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.xls,.xlsx,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelected(file);
          }}
        />
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5 text-sm"
          disabled={disabled || busy || !workspaceId}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={14} />
          {busy ? 'A importar…' : 'Importar lote'}
        </button>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5 text-sm"
          disabled={busy}
          onClick={downloadTemplate}
        >
          <Download size={14} />
          Modelo CSV
        </button>
      </div>

      <CatalogImportMapModal
        open={mapOpen}
        fileName={pendingFileName}
        rows={pendingRows}
        allowUpdateExisting={allowUpdateExisting}
        onClose={closeMapper}
        onConfirm={(csvText, _rowCount, updateExisting) => void uploadCsvText(csvText, updateExisting)}
      />
    </>
  );
}
