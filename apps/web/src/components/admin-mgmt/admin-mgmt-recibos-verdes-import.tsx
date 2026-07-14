'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  formatAdminMgmtMoney,
  getAdminMgmtFaturaTipoLabel,
  type RecibosVerdesImportPreviewRow,
  type RecibosVerdesImportResult,
} from '@tvde/shared';
import { API_PATHS, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';

interface PreviewData {
  rows: RecibosVerdesImportPreviewRow[];
  errors: RecibosVerdesImportResult['erros'];
}

export function AdminMgmtRecibosVerdesImport({
  workspaceId,
  onImported,
  onError,
}: {
  workspaceId: string | null;
  onImported: () => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [result, setResult] = useState<RecibosVerdesImportResult | null>(null);

  function reset() {
    setPreviewOpen(false);
    setPreview(null);
    setPendingFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function uploadPreview(file: File) {
    if (!workspaceId) {
      onError('Seleccione um workspace');
      return;
    }
    setBusy(true);
    onError('');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspaceId', workspaceId);

    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.adminMgmt.recibosVerdesImportPreview}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const raw = await res.json();
    setBusy(false);

    if (!res.ok || !raw.success) {
      onError(raw.error ?? 'Falha na pré-visualização');
      reset();
      return;
    }

    setPendingFile(file);
    setPreview(raw.data as PreviewData);
    setPreviewOpen(true);
  }

  async function confirmImport() {
    if (!workspaceId || !pendingFile) return;
    setBusy(true);
    onError('');
    const formData = new FormData();
    formData.append('file', pendingFile);
    formData.append('workspaceId', workspaceId);

    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.adminMgmt.recibosVerdesImportConfirm}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const raw = await res.json();
    setBusy(false);

    if (!res.ok || !raw.success) {
      onError(getApiErrorMessage(raw));
      return;
    }

    setResult(raw.data as RecibosVerdesImportResult);
    onImported();
  }

  const novos = preview?.rows.filter((r) => r.status === 'novo').length ?? 0;
  const duplicados = preview?.rows.filter((r) => r.status === 'duplicado').length ?? 0;

  return (
    <>
      <div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadPreview(file);
          }}
        />
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2 text-sm"
          disabled={busy || !workspaceId}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={14} />
          {busy ? 'A processar…' : 'Importar recibos verdes (CSV)'}
        </button>
      </div>

      <Modal
        open={previewOpen}
        onClose={reset}
        title="Importar recibos verdes"
        panelClassName="max-w-3xl"
        scrollBody
      >
        {!result && preview && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Exportação do portal AT —{' '}
              <span className="font-medium">Consultar → Exportar tabela</span>. Serão importados{' '}
              <strong>{novos}</strong> documento(s) novo(s); <strong>{duplicados}</strong> duplicado(s)
              ignorado(s).
            </p>

            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {preview.errors.length} aviso(s) de parsing — linhas com erro não serão importadas.
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                    <th className="px-3 py-2">Referência</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={`${row.referencia}-${row.line}`} className="border-b border-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{row.referencia}</div>
                        <div className="text-xs text-slate-400">
                          {getAdminMgmtFaturaTipoLabel(row.tipoDocumentoCms)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{row.nomeAdquirente}</div>
                        <div className="text-xs text-slate-400">{row.nifAdquirente ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.dataEmissao}</td>
                      <td className="px-3 py-2">{formatAdminMgmtMoney(row.valorTotal)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            row.status === 'novo'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {row.status === 'novo' ? 'Novo' : 'Duplicado'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || novos === 0}
                onClick={() => void confirmImport()}
              >
                {busy ? 'A importar…' : `Confirmar importação (${novos})`}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <p className="text-sm text-green-700 font-medium">Importação concluída.</p>
            <ul className="text-sm text-slate-700">
              <li>Clientes criados: {result.clientesCriados}</li>
              <li>Clientes actualizados: {result.clientesActualizados}</li>
              <li>Faturas criadas: {result.faturasCriadas}</li>
              <li>Ignoradas (duplicadas): {result.faturasIgnoradas}</li>
              {result.erros.length > 0 && <li className="text-amber-700">Erros: {result.erros.length}</li>}
            </ul>
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={reset}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
