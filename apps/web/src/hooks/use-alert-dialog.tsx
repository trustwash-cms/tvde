'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertDialog, type AlertDialogProps } from '@/components/alert-dialog';

export type AlertOptions = Pick<AlertDialogProps, 'title' | 'message' | 'okLabel' | 'variant'>;

export function useAlertDialog() {
  const [state, setState] = useState<{ open: true; options: AlertOptions } | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);

  const alert = useCallback((options: AlertOptions | string): Promise<void> => {
    const opts = typeof options === 'string' ? { message: options } : options;
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, options: opts });
    });
  }, []);

  const finish = useCallback(() => {
    resolveRef.current?.();
    resolveRef.current = null;
    setState(null);
  }, []);

  const alertDialog = state ? (
    <AlertDialog open {...state.options} onClose={finish} />
  ) : null;

  return { alert, alertDialog };
}
