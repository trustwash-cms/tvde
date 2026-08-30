type VncKeySender = {
  sendKey: (keysym: number, code: string, down?: boolean) => void;
  focus?: () => void;
};

const XK_Shift_L = 0xffe1;
const XK_Return = 0xff0d;
const XK_Tab = 0xff09;
const KEY_DELAY_MS = 15;

/** Teclas US QWERTY usadas em comandos shell. */
const US_KEYS: Record<string, { keysym: number; code: string; shift?: boolean }> = {
  ' ': { keysym: 0x20, code: 'Space' },
  '!': { keysym: 0x21, code: 'Digit1', shift: true },
  '"': { keysym: 0x22, code: 'Quote', shift: true },
  '#': { keysym: 0x23, code: 'Digit3', shift: true },
  $: { keysym: 0x24, code: 'Digit4', shift: true },
  '%': { keysym: 0x25, code: 'Digit5', shift: true },
  '&': { keysym: 0x26, code: 'Digit7', shift: true },
  "'": { keysym: 0x27, code: 'Quote' },
  '(': { keysym: 0x28, code: 'Digit9', shift: true },
  ')': { keysym: 0x29, code: 'Digit0', shift: true },
  '*': { keysym: 0x2a, code: 'Digit8', shift: true },
  '+': { keysym: 0x2b, code: 'Equal', shift: true },
  ',': { keysym: 0x2c, code: 'Comma' },
  '-': { keysym: 0x2d, code: 'Minus' },
  '.': { keysym: 0x2e, code: 'Period' },
  '/': { keysym: 0x2f, code: 'Slash' },
  ':': { keysym: 0x3a, code: 'Semicolon', shift: true },
  ';': { keysym: 0x3b, code: 'Semicolon' },
  '<': { keysym: 0x3c, code: 'Comma', shift: true },
  '=': { keysym: 0x3d, code: 'Equal' },
  '>': { keysym: 0x3e, code: 'Period', shift: true },
  '?': { keysym: 0x3f, code: 'Slash', shift: true },
  '@': { keysym: 0x40, code: 'Digit2', shift: true },
  '[': { keysym: 0x5b, code: 'BracketLeft' },
  '\\': { keysym: 0x5c, code: 'Backslash' },
  ']': { keysym: 0x5d, code: 'BracketRight' },
  '^': { keysym: 0x5e, code: 'Digit6', shift: true },
  '_': { keysym: 0x5f, code: 'Minus', shift: true },
  '`': { keysym: 0x60, code: 'Backquote' },
  '{': { keysym: 0x7b, code: 'BracketLeft', shift: true },
  '|': { keysym: 0x7c, code: 'Backslash', shift: true },
  '}': { keysym: 0x7d, code: 'BracketRight', shift: true },
  '~': { keysym: 0x7e, code: 'Backquote', shift: true },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function keyForChar(char: string): { keysym: number; code: string; shift?: boolean } | null {
  if (char in US_KEYS) return US_KEYS[char]!;
  const cp = char.codePointAt(0)!;
  if (cp >= 0x61 && cp <= 0x7a) return { keysym: cp, code: `Key${char.toUpperCase()}` };
  if (cp >= 0x41 && cp <= 0x5a) return { keysym: cp, code: `Key${char}`, shift: true };
  if (cp >= 0x30 && cp <= 0x39) return { keysym: cp, code: `Digit${char}` };
  return null;
}

function sendChar(rfb: VncKeySender, char: string): void {
  if (char === '\n') {
    rfb.sendKey(XK_Return, 'Enter');
    return;
  }
  if (char === '\t') {
    rfb.sendKey(XK_Tab, 'Tab');
    return;
  }
  const key = keyForChar(char);
  if (!key) return;
  if (key.shift) rfb.sendKey(XK_Shift_L, 'ShiftLeft', true);
  rfb.sendKey(key.keysym, key.code);
  if (key.shift) rfb.sendKey(XK_Shift_L, 'ShiftLeft', false);
}

/** Simula digitação no guest VNC com intervalo entre teclas (evita perda de eventos). */
export async function typeTextIntoVnc(rfb: VncKeySender, text: string): Promise<void> {
  const normalized = text.replace(/\r\n/g, '\n');
  for (const char of normalized) {
    sendChar(rfb, char);
    await sleep(KEY_DELAY_MS);
  }
}

export async function pasteIntoVnc(
  rfb: VncKeySender,
  isConnected: () => boolean
): Promise<'ok' | 'not-connected' | 'empty' | 'denied'> {
  if (!isConnected()) return 'not-connected';

  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return 'denied';
  }
  if (!text) return 'empty';

  try {
    rfb.focus?.();
  } catch {
    // ignore
  }
  await sleep(80);
  await typeTextIntoVnc(rfb, text);
  return 'ok';
}

export function attachVncClipboard(
  host: HTMLElement,
  getRfb: () => VncKeySender | null,
  isConnected: () => boolean
): () => void {
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.type !== 'keydown') return;
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'v') return;
    if (!host.contains(ev.target as Node)) return;
    const rfb = getRfb();
    if (!rfb || !isConnected()) return;
    ev.preventDefault();
    ev.stopPropagation();
    void pasteIntoVnc(rfb, isConnected);
  };

  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
