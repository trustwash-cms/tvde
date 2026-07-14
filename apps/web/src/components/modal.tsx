'use client';

import { ReactNode, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  panelClassName?: string;
  /** Corpo com scroll; cabeçalho e rodapé ficam fixos no painel. */
  scrollBody?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  /** Fechar ao clicar no fundo escuro (defeito: true). */
  closeOnBackdrop?: boolean;
  /** Fechar com Escape (defeito: true). */
  closeOnEscape?: boolean;
  /** Botão X no cabeçalho (defeito: false). */
  showCloseButton?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  panelClassName,
  scrollBody = false,
  footer,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = false,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (closeOnEscape && e.key === 'Escape') onClose();
    }

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, closeOnEscape]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {closeOnBackdrop ? (
        <button
          type="button"
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
          aria-label="Fechar"
          onClick={onClose}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" aria-hidden="true" />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`relative z-10 w-full rounded-2xl bg-white shadow-xl ${
          scrollBody
            ? `flex max-h-[min(90vh,720px)] flex-col overflow-hidden ${panelClassName ?? 'max-w-lg'}`
            : `p-6 sm:p-8 ${panelClassName ?? 'max-w-lg'}`
        }`}
      >
        {(title || showCloseButton) && (
          <div
            className={
              scrollBody
                ? 'flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4 sm:px-8'
                : 'mb-6 flex items-start justify-between gap-3'
            }
          >
            {title ? (
              <h3
                id="modal-title"
                className="min-w-0 flex-1 text-lg font-semibold text-slate-900"
              >
                {title}
              </h3>
            ) : (
              <span className="flex-1" />
            )}
            {showCloseButton && (
              <button
                type="button"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Fechar"
                onClick={onClose}
              >
                <X size={20} />
              </button>
            )}
          </div>
        )}
        {scrollBody ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 sm:px-8">
            {children}
          </div>
        ) : (
          children
        )}
        {scrollBody && footer && (
          <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-4 sm:px-8">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
