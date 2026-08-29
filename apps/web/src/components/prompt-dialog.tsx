'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Modal } from '@/components/modal';

export interface PromptDialogProps {
  open: boolean;
  title?: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title = 'Indicar valor',
  message,
  label,
  defaultValue = '',
  confirmLabel = 'Guardar',
  cancelLabel = 'Cancelar',
  placeholder,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    onConfirm(value.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      panelClassName="max-w-md"
      showCloseButton
      overlayClassName="z-[60]"
    >
      <form onSubmit={submit}>
        {message ? <p className="mb-4 text-sm text-slate-600">{message}</p> : null}
        <label className="block text-sm">
          {label ? <span className="mb-1 block text-slate-700">{label}</span> : null}
          <input
            className="input w-full"
            value={value}
            placeholder={placeholder}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="submit" className="btn-primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
