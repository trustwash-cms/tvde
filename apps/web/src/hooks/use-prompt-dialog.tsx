'use client';

import { useCallback, useRef, useState } from 'react';
import { PromptDialog, type PromptDialogProps } from '@/components/prompt-dialog';

export type PromptOptions = Pick<
  PromptDialogProps,
  'title' | 'message' | 'label' | 'defaultValue' | 'confirmLabel' | 'cancelLabel' | 'placeholder'
>;

export function usePromptDialog() {
  const [state, setState] = useState<{ open: true; options: PromptOptions } | null>(null);
  const resolveRef = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, options });
    });
  }, []);

  const finish = useCallback((result: string | null) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  }, []);

  const promptDialog = state ? (
    <PromptDialog
      open
      {...state.options}
      onConfirm={(value) => finish(value)}
      onCancel={() => finish(null)}
    />
  ) : null;

  return { prompt, promptDialog };
}
