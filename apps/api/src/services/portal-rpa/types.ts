import { existsSync } from 'fs';
import type { Browser, BrowserContext, Page, LaunchOptions } from 'playwright';
import type { MyPrioSyncScope, PortalKind, UberSyncOptions } from '@tvde/shared';

export type PortalLoginPhase =
  | { status: 'connected'; storageState: string }
  | { status: 'awaiting_otp'; otpHint?: string; storageState?: string }
  /** Uber passkey: QR/screenshot para o gestor digitalizar no telemóvel; browser fica vivo. */
  | {
      status: 'awaiting_passkey';
      hint?: string;
      /** PNG base64 (sem prefixo data:) */
      challengeImageBase64: string;
      storageState?: string;
    }
  | { status: 'failed'; message: string };

export type PortalSyncPhase =
  | { status: 'ok'; files: Array<{ filename: string; buffer: Buffer }>; warnings?: string[] }
  | { status: 'expired'; message: string }
  | { status: 'failed'; message: string };

export type PortalSyncOptions = {
  /** MyPRIO: Electric e Frota são syncs independentes. */
  syncScope?: MyPrioSyncScope;
  /** Uber: existing report vs generate with date range */
  uberSync?: UberSyncOptions;
  /** Progresso para actualizar mensagem do job (UI). */
  onProgress?: (message: string) => void | Promise<void>;
};

export interface PortalAdapter {
  portal: PortalKind;
  login(page: Page, username: string, password: string): Promise<PortalLoginPhase>;
  submitOtp(page: Page, code: string): Promise<PortalLoginPhase>;
  sync(context: BrowserContext, page: Page, options?: PortalSyncOptions): Promise<PortalSyncPhase>;
  refresh(context: BrowserContext, page: Page): Promise<'ok' | 'expired'>;
}

/** Sessões vivas enquanto se espera OTP (browser não pode fechar a meio do login). */
export interface LiveOtpSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: number;
}

const liveOtpSessions = new Map<string, LiveOtpSession>();
const LIVE_OTP_TTL_MS = 10 * 60 * 1000;

let browserReadyCache: { checkedAt: number; ready: boolean; detail: string } | null = null;
const BROWSER_READY_TTL_MS = 30_000;

export function getLiveOtpSession(jobId: string): LiveOtpSession | undefined {
  const session = liveOtpSessions.get(jobId);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > LIVE_OTP_TTL_MS) {
    void disposeLiveOtpSession(jobId);
    return undefined;
  }
  return session;
}

export async function disposeLiveOtpSession(jobId: string): Promise<void> {
  const session = liveOtpSessions.get(jobId);
  if (!session) return;
  liveOtpSessions.delete(jobId);
  await session.browser.close().catch(() => undefined);
}

/** Fecha todos os browsers OTP vivos (tsx reload / SIGTERM). */
export async function disposeAllLiveOtpSessions(): Promise<void> {
  const ids = [...liveOtpSessions.keys()];
  await Promise.all(ids.map((id) => disposeLiveOtpSession(id)));
}

export async function registerLiveOtpSession(
  jobId: string,
  browser: Browser,
  context: BrowserContext,
  page: Page
): Promise<void> {
  const existing = liveOtpSessions.get(jobId);
  if (existing) await existing.browser.close().catch(() => undefined);
  liveOtpSessions.set(jobId, { browser, context, page, createdAt: Date.now() });
}

export function isMissingBrowserError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /Browser Playwright em falta|Executable doesn't exist|playwright install|chromium_headless_shell/i.test(
    message
  );
}

export function humanizePlaywrightError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Executable doesn't exist|playwright install|chromium_headless_shell/i.test(message)) {
    return (
      'Browser Playwright em falta. No servidor execute: npm run playwright:install ' +
      'e reinicie a API. Depois clique em «Ligar conta» outra vez (o erro antigo fica guardado até nova tentativa).'
    );
  }
  if (/Target page, context or browser has been closed/i.test(message)) {
    return 'O browser Playwright fechou inesperadamente. Tente Ligar conta novamente.';
  }
  return message;
}

/**
 * Preferir Chromium completo (não headless_shell) — mais estável em macOS 12.
 * Ignorar PLAYWRIGHT_BROWSERS_PATH de sandboxes Cursor se o path default tiver browsers.
 */
function preparePlaywrightEnv() {
  // Headless shell falha com "Executable doesn't exist" em alguns setups; Chromium full é fiável.
  process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL = '0';

  const sandboxHint = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '';
  if (sandboxHint.includes('cursor-sandbox-cache')) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
}

export function probePlaywrightBrowser(): { ready: boolean; detail: string } {
  const now = Date.now();
  if (browserReadyCache && now - browserReadyCache.checkedAt < BROWSER_READY_TTL_MS) {
    return { ready: browserReadyCache.ready, detail: browserReadyCache.detail };
  }

  preparePlaywrightEnv();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pw = require('playwright') as typeof import('playwright');
    const exe = pw.chromium.executablePath();
    const ready = Boolean(exe && existsSync(exe));
    const detail = ready ? `Chromium OK (${exe})` : `Chromium em falta (${exe || 'sem path'})`;
    browserReadyCache = { checkedAt: now, ready, detail };
    return { ready, detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    browserReadyCache = { checkedAt: now, ready: false, detail };
    return { ready: false, detail };
  }
}

export function invalidatePlaywrightBrowserCache() {
  browserReadyCache = null;
}

async function launchChromium(headless: boolean): Promise<Browser> {
  preparePlaywrightEnv();
  const { chromium } = await import('playwright');

  const probe = probePlaywrightBrowser();
  if (!probe.ready) {
    throw new Error(
      'Browser Playwright em falta. Execute `npm run playwright:install` na raiz do projecto e reinicie a API.'
    );
  }

  const options: LaunchOptions = {
    headless,
    args: [
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  };

  try {
    return await chromium.launch(options);
  } catch (err) {
    invalidatePlaywrightBrowserCache();
    // Fallback: tentar com executablePath explícito
    try {
      const exe = chromium.executablePath();
      return await chromium.launch({ ...options, executablePath: exe });
    } catch {
      throw new Error(humanizePlaywrightError(err));
    }
  }
}

export async function withPlaywrightPage<T>(
  options: {
    headless: boolean;
    storageStateJson?: string | null;
    /** Se true, o caller fica responsável por fechar o browser (OTP live). */
    keepAlive?: boolean;
    /** Timeout global — fecha o browser à força (evita jobs `running` eternos e tsx a não reiniciar). */
    timeoutMs?: number;
  },
  fn: (browser: Browser, context: BrowserContext, page: Page) => Promise<T>
): Promise<T> {
  const browser = await launchChromium(options.headless);
  const timeoutMs = options.timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    let storageState: string | { cookies: never[]; origins: never[] } | undefined;
    if (options.storageStateJson) {
      storageState = JSON.parse(options.storageStateJson) as {
        cookies: never[];
        origins: never[];
      };
    }
    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
      locale: 'pt-PT',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      } catch {
        // ignore
      }
    });

    const work = fn(browser, context, page);
    const result =
      timeoutMs && timeoutMs > 0
        ? await Promise.race([
            work,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(new Error(`Timeout Playwright (${Math.round(timeoutMs / 1000)}s) — sync abortado`));
              }, timeoutMs);
            }),
          ])
        : await work;

    if (timer) clearTimeout(timer);
    if (options.keepAlive) return result;
    await browser.close().catch(() => undefined);
    return result;
  } catch (err) {
    if (timer) clearTimeout(timer);
    await browser.close().catch(() => undefined);
    throw err instanceof Error ? err : new Error(humanizePlaywrightError(err));
  }
}

export async function captureStorageState(context: BrowserContext): Promise<string> {
  const state = await context.storageState();
  return JSON.stringify(state);
}
