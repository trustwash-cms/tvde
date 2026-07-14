'use client';

import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog, type ConfirmDialogProps } from '@/components/confirm-dialog';

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  'title' | 'message' | 'confirmLabel' | 'cancelLabel' | 'variant'
>;

export function useConfirmDialog() {
  const [state, setState] = useState<{ open: true; options: ConfirmOptions } | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const opts = typeof options === 'string' ? { message: options } : options;
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, options: opts });
    });
  }, []);

  const finish = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }, []);

  const confirmDialog = state ? (
    <ConfirmDialog
      open
      {...state.options}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  ) : null;

  return { confirm, confirmDialog };
}
