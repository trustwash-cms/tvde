'use client';

import { Modal } from '@/components/modal';

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title = 'Confirmar',
  message,
  confirmLabel,
  cancelLabel = 'Cancelar',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const resolvedConfirmLabel =
    confirmLabel ?? (variant === 'danger' ? 'Eliminar' : 'Confirmar');

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      panelClassName="max-w-md"
      overlayClassName="z-[60]"
    >
      <p className="mb-6 whitespace-pre-line text-sm leading-relaxed text-slate-600">{message}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
          onClick={onConfirm}
        >
          {resolvedConfirmLabel}
        </button>
      </div>
    </Modal>
  );
}
