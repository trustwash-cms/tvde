import type { Terminal } from '@xterm/xterm';

type PasteableTerminal = Pick<Terminal, 'focus' | 'paste'>;

type ClipboardTerminal = PasteableTerminal & {
  element?: HTMLElement;
  attachCustomKeyEventHandler: Terminal['attachCustomKeyEventHandler'];
};

async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

function isFocusInside(host: HTMLElement, term: ClipboardTerminal): boolean {
  const active = document.activeElement;
  if (term.element?.contains(active)) return true;
  return host.contains(active);
}

/** Permite colar (Ctrl/Cmd+V) no xterm; devolve cleanup. */
export function attachXtermClipboard(host: HTMLElement, term: ClipboardTerminal): () => void {
  const pasteText = (text: string) => {
    if (!text) return;
    term.focus();
    term.paste(text);
  };

  const pasteFromClipboard = async () => {
    const text = await readClipboardText();
    pasteText(text);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.type !== 'keydown') return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v') return;
    if (!isFocusInside(host, term) && !host.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    void pasteFromClipboard();
  };

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v') return true;
    void pasteFromClipboard();
    return false;
  });

  const onPaste = (ev: ClipboardEvent) => {
    const text = ev.clipboardData?.getData('text');
    if (!text) return;
    ev.preventDefault();
    ev.stopPropagation();
    pasteText(text);
  };

  const onMouseDown = () => term.focus();

  window.addEventListener('keydown', onKeyDown, true);
  host.addEventListener('paste', onPaste, true);
  host.addEventListener('mousedown', onMouseDown);

  return () => {
    term.attachCustomKeyEventHandler(() => true);
    window.removeEventListener('keydown', onKeyDown, true);
    host.removeEventListener('paste', onPaste, true);
    host.removeEventListener('mousedown', onMouseDown);
  };
}

export async function pasteIntoXterm(term: PasteableTerminal): Promise<boolean> {
  const text = await readClipboardText();
  if (!text) return false;
  term.focus();
  term.paste(text);
  return true;
}
