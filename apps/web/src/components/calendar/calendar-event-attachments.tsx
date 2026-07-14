'use client';

import { useRef, useState } from 'react';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import type { CalendarEventAttachment } from '@/components/calendar/calendar-types';

const MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: string | number): string {
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!Number.isFinite(n) || n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadAttachment(eventId: string, attachment: CalendarEventAttachment) {
  const token = getStoredToken();
  const res = await fetch(
    `${getApiUrl()}${API_PATHS.calendar.eventAttachmentDownload(eventId, attachment.id)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!res.ok) throw new Error('Não foi possível descarregar o ficheiro');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

interface CalendarEventAttachmentsProps {
  eventId: string | null;
  attachments: CalendarEventAttachment[];
  pendingFiles: File[];
  onAttachmentsChange: (attachments: CalendarEventAttachment[]) => void;
  onPendingFilesChange: (files: File[]) => void;
  disabled?: boolean;
}

export function CalendarEventAttachments({
  eventId,
  attachments,
  pendingFiles,
  onAttachmentsChange,
  onPendingFilesChange,
  disabled = false,
}: CalendarEventAttachmentsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function uploadFile(file: File) {
    if (!eventId) {
      onPendingFilesChange([...pendingFiles, file]);
      return;
    }

    if (file.size > MAX_BYTES) {
      setError('Cada ficheiro pode ter no máximo 10 MB');
      return;
    }

    setBusy(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);

    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.calendar.eventAttachmentUpload(eventId)}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    const raw = await res.text();
    let parsed: { success?: boolean; data?: CalendarEventAttachment; error?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { success: false, error: raw.slice(0, 200) };
    }

    setBusy(false);
    if (!res.ok || !parsed.success || !parsed.data) {
      setError(parsed.error ?? 'Falha ao carregar anexo');
      return;
    }

    onAttachmentsChange([...attachments, parsed.data]);
  }

  async function handlePickFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  async function removeAttachment(attachmentId: string) {
    if (!eventId) return;
    setBusy(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.calendar.eventAttachmentById(eventId, attachmentId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    onAttachmentsChange(attachments.filter((a) => a.id !== attachmentId));
  }

  function removePending(index: number) {
    onPendingFilesChange(pendingFiles.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-slate-600">Anexos</label>
        <button
          type="button"
          className="text-xs font-medium text-[var(--color-primary)] hover:underline disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
        >
          Adicionar ficheiro
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        disabled={disabled || busy}
        onChange={(e) => void handlePickFiles(e.target.files)}
      />

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      <ul className="space-y-1.5 rounded-lg border border-slate-200 p-2">
        {attachments.length === 0 && pendingFiles.length === 0 && (
          <li className="text-xs text-slate-400">Sem anexos</li>
        )}

        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex items-center justify-between gap-2 text-sm">
            <button
              type="button"
              className="truncate text-left text-[var(--color-primary)] hover:underline"
              onClick={() => void downloadAttachment(eventId!, attachment).catch(() => setError('Falha ao descarregar'))}
              disabled={!eventId}
            >
              {attachment.fileName}
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] text-slate-400">{formatBytes(attachment.sizeBytes)}</span>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
                onClick={() => void removeAttachment(attachment.id)}
                disabled={disabled || busy}
              >
                Remover
              </button>
            </div>
          </li>
        ))}

        {pendingFiles.map((file, index) => (
          <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-slate-700">{file.name}</span>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] text-amber-600">pendente</span>
              <span className="text-[10px] text-slate-400">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => removePending(index)}
                disabled={disabled || busy}
              >
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!eventId && pendingFiles.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-400">
          Os ficheiros serão carregados após criar o evento.
        </p>
      )}
    </div>
  );
}

export async function uploadPendingCalendarAttachments(eventId: string, files: File[]) {
  const token = getStoredToken();
  const errors: string[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: demasiado grande`);
      continue;
    }
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${getApiUrl()}${API_PATHS.calendar.eventAttachmentUpload(eventId)}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      const raw = await res.text();
      errors.push(`${file.name}: ${raw.slice(0, 80)}`);
    }
  }

  return errors;
}
