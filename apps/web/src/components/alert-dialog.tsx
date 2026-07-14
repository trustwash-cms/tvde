'use client';

import { Modal } from '@/components/modal';

export interface AlertDialogProps {
  open: boolean;
  title?: string;
  message: string;
  okLabel?: string;
  variant?: 'default' | 'error' | 'warning';
  onClose: () => void;
}

const TITLE_STYLES = {
  default: 'text-slate-900',
  error: 'text-red-700',
  warning: 'text-amber-800',
};

export function AlertDialog({
  open,
  title = 'Aviso',
  message,
  okLabel = 'OK',
  variant = 'default',
  onClose,
}: AlertDialogProps) {
  return (
    <Modal open={open} onClose={onClose} panelClassName="max-w-md">
      <h3 className={`mb-4 text-lg font-semibold ${TITLE_STYLES[variant]}`}>{title}</h3>
      <p className="mb-6 whitespace-pre-line text-sm leading-relaxed text-slate-600">{message}</p>
      <div className="flex justify-end">
        <button
          type="button"
          className={variant === 'error' ? 'btn-danger' : 'btn-primary'}
          onClick={onClose}
        >
          {okLabel}
        </button>
      </div>
    </Modal>
  );
}
