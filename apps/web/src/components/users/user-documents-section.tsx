'use client';

import { useRef, useState } from 'react';
import {
  API_PATHS,
  USER_DOCUMENT_MAX_BYTES,
  USER_DOCUMENT_TYPE_LABELS,
  USER_DOCUMENT_TYPES,
  USER_DOCUMENT_VISIBILITY_LABELS,
  USER_DOCUMENT_VISIBILITIES,
  type UserDocumentItem,
  type UserDocumentType,
  type UserDocumentVisibility,
} from '@tvde/shared';
import { Download, Trash2, Upload } from 'lucide-react';
import { getApiUrl, getStoredToken } from '@/lib/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadDocument(
  userId: string | 'me',
  doc: UserDocumentItem,
  selfMode: boolean
) {
  const token = getStoredToken();
  const path = selfMode
    ? API_PATHS.users.meDocumentDownload(doc.id)
    : API_PATHS.users.documentDownload(userId, doc.id);

  const res = await fetch(`${getApiUrl()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Não foi possível descarregar o ficheiro');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = doc.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

interface UserDocumentsSectionProps {
  userId: string;
  documents: UserDocumentItem[];
  onDocumentsChange: (documents: UserDocumentItem[]) => void;
  selfMode?: boolean;
  canUpload?: boolean;
  canDelete?: boolean;
  disabled?: boolean;
}

export function UserDocumentsSection({
  userId,
  documents,
  onDocumentsChange,
  selfMode = false,
  canUpload = true,
  canDelete = true,
  disabled = false,
}: UserDocumentsSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<UserDocumentType>('comprovativo_morada');
  const [visibility, setVisibility] = useState<UserDocumentVisibility>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function uploadFile(file: File) {
    if (file.size > USER_DOCUMENT_MAX_BYTES) {
      setError('Cada ficheiro pode ter no máximo 5 MB');
      return;
    }

    setBusy(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    formData.append('visibility', visibility);

    const token = getStoredToken();
    const uploadPath = selfMode
      ? API_PATHS.users.meDocumentUpload
      : API_PATHS.users.documentUpload(userId);

    const res = await fetch(`${getApiUrl()}${uploadPath}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    const raw = await res.text();
    let parsed: { success?: boolean; data?: UserDocumentItem; error?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { success: false, error: raw.slice(0, 200) };
    }

    setBusy(false);

    if (!res.ok || !parsed.success || !parsed.data) {
      setError(parsed.error ?? 'Falha ao carregar documento');
      return;
    }

    onDocumentsChange([parsed.data, ...documents]);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handlePickFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
  }

  async function handleDelete(doc: UserDocumentItem) {
    setBusy(true);
    setError('');

    const token = getStoredToken();
    const deletePath = selfMode
      ? API_PATHS.users.meDocumentById(doc.id)
      : API_PATHS.users.documentById(userId, doc.id);

    const res = await fetch(`${getApiUrl()}${deletePath}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    const raw = await res.text();
    let parsed: { success?: boolean; error?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { success: false, error: raw.slice(0, 200) };
    }

    setBusy(false);

    if (!res.ok || !parsed.success) {
      setError(parsed.error ?? 'Não foi possível eliminar o documento');
      return;
    }

    onDocumentsChange(documents.filter((d) => d.id !== doc.id));
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-800">Documentos</h4>
        <p className="mt-1 text-xs text-slate-500">PDF, JPG ou PNG — máximo 5 MB por ficheiro.</p>
      </div>

      {canUpload ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Tipo</label>
              <select
                className="input text-sm"
                value={documentType}
                disabled={disabled || busy}
                onChange={(e) => setDocumentType(e.target.value as UserDocumentType)}
              >
                {USER_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {USER_DOCUMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Visibilidade</label>
              <select
                className="input text-sm"
                value={visibility}
                disabled={disabled || busy}
                onChange={(e) => setVisibility(e.target.value as UserDocumentVisibility)}
              >
                {USER_DOCUMENT_VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {USER_DOCUMENT_VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) => handlePickFiles(e.target.files)}
          />

          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 text-sm"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={16} />
            {busy ? 'A carregar…' : 'Carregar documento'}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum documento carregado.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{doc.fileName}</p>
                <p className="text-xs text-slate-500">
                  {USER_DOCUMENT_TYPE_LABELS[doc.documentType]} · {formatBytes(doc.sizeBytes)} ·{' '}
                  {USER_DOCUMENT_VISIBILITY_LABELS[doc.visibility]}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Descarregar"
                  className="rounded-md p-1.5 text-sky-600 hover:bg-sky-50"
                  disabled={busy}
                  onClick={() =>
                    downloadDocument(userId, doc, selfMode).catch(() =>
                      setError('Não foi possível descarregar o ficheiro')
                    )
                  }
                >
                  <Download size={18} />
                </button>
                {canDelete ? (
                  <button
                    type="button"
                    title="Eliminar"
                    className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                    disabled={busy}
                    onClick={() => handleDelete(doc)}
                  >
                    <Trash2 size={18} />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
