import { existsSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import type { Browser, BrowserContext, Page, LaunchOptions } from 'playwright';
import type { MyPrioSyncScope, PortalKind, UberSyncOptions } from '@tvde/shared';

export type PortalLoginPhase =
  | { status: 'connected'; storageState: string }
  | { status: 'awaiting_otp'; otpHint?: string; storageState?: string }
  /**
   * Uber pós-OTP: ecrã «Introduza a sua palavra-passe».
   * Browser vivo mantém-se; UI mostra modal password (authChallenge=password).
   */
  | { status: 'awaiting_password'; hint?: string; storageState?: string }
  /** Uber passkey / bot: QR ou stream live; browser fica vivo. */
  | {
      status: 'awaiting_passkey';
      hint?: string;
      /** PNG base64 (sem prefixo data:) — preview inicial; bot usa live-frame a seguir */
      challengeImageBase64: string;
      storageState?: string;
      /** passkey = QR; bot = Arkose («Proteger a sua conta») via stream no fleet */
      kind?: 'passkey' | 'bot';
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
const LIVE_OTP_TTL_MS = 12 * 60 * 1000;
/** Cap de browsers vivos em paralelo (OTP / passkey / Arkose). */
const MAX_LIVE_OTP_SESSIONS = 6;

type BrowserReadyState = {
  checkedAt: number;
  ready: boolean;
  detail: string;
  /** true = Chromium launch realmente testado (não só ficheiro no disco) */
  launchVerified: boolean;
};

let browserReadyCache: BrowserReadyState | null = null;
const BROWSER_READY_TTL_MS = 30_000;
let ensurePlaywrightInFlight: Promise<{
  ready: boolean;
  detail: string;
  healed: boolean;
}> | null = null;

export function getLiveOtpSession(jobId: string): LiveOtpSession | undefined {
  const session = liveOtpSessions.get(jobId);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > LIVE_OTP_TTL_MS) {
    void disposeLiveOtpSession(jobId);
    return undefined;
  }
  return session;
}

/** Prolongar TTL enquanto o gestor faz poll do live-frame / interage (desafio ~10 min). */
export function touchLiveOtpSession(jobId: string): void {
  const session = liveOtpSessions.get(jobId);
  if (!session) return;
  session.createdAt = Date.now();
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

  if (!liveOtpSessions.has(jobId) && liveOtpSessions.size >= MAX_LIVE_OTP_SESSIONS) {
    // Evict oldest session to free a slot
    let oldestId: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [id, s] of liveOtpSessions) {
      if (s.createdAt < oldestAt) {
        oldestAt = s.createdAt;
        oldestId = id;
      }
    }
    if (oldestId) await disposeLiveOtpSession(oldestId);
  }

  liveOtpSessions.set(jobId, { browser, context, page, createdAt: Date.now() });
}

export function countLiveOtpSessions(): number {
  return liveOtpSessions.size;
}

/** Erro de browser em falta (binário Playwright). */
export function isMissingBrowserError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /Browser Playwright em falta|Executable doesn't exist|playwright install|chromium_headless_shell/i.test(
    message
  );
}

/**
 * Falha de infra do Chromium (binário, libs, fonts, DISPLAY) — não é estado da conta.
 * Usado para limpar lastError stale sem confundir com credenciais/OTP.
 */
export function isInfraBrowserError(message: string | null | undefined): boolean {
  if (!message) return false;
  if (isMissingBrowserError(message)) return true;
  return /Dependências do Chromium|Fontes do sistema em falta|Display gráfico em falta|shared libraries|libatk|libgbm|cannot open shared object|Fontconfig|Could not find any font|TextRunHarfBuzz|Missing X server|without having a XServer|playwright:libs|playwright:install/i.test(
    message
  );
}

export function humanizePlaywrightError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    /unsupported state or unable to authenticate data|unable to authenticate data/i.test(message) ||
    /Password guardada ilegível|Sessão guardada ilegível|chave de encriptação mudou/i.test(message)
  ) {
    if (/Sessão guardada ilegível/i.test(message)) {
      return 'Sessão guardada ilegível (chave de encriptação mudou). Volte a Ligar conta.';
    }
    return (
      'Password guardada ilegível (chave de encriptação mudou). ' +
      'Clique em «Esquecer password» e volte a Ligar conta com a password correcta.'
    );
  }
  if (/Executable doesn't exist|playwright install|chromium_headless_shell|Browser Playwright em falta/i.test(message)) {
    return (
      'Browser Playwright em falta no servidor. A API tenta reinstalar automaticamente no arranque; ' +
      'se persistir, no servidor execute `npm run playwright:install` e reinicie a API. Depois clique em «Ligar conta».'
    );
  }
  if (/error while loading shared libraries|libatk|libgbm|cannot open shared object|Dependências do Chromium/i.test(message)) {
    return (
      'Dependências do Chromium em falta no servidor. A API tenta reparar com `npm run playwright:libs` no arranque; ' +
      'se persistir, execute esse comando (ou `sudo npx playwright install-deps chromium`) e reinicie a API.'
    );
  }
  if (/Fontconfig|Could not find any font|TextRunHarfBuzz|Fontes do sistema/i.test(message)) {
    return (
      'Fontes do sistema em falta para o Chromium. Execute `npm run playwright:libs` no servidor e reinicie a API.'
    );
  }
  if (/Missing X server|without having a XServer|DISPLAY/i.test(message) && /headed|XServer|ozone|Display gráfico/i.test(message)) {
    return (
      'Display gráfico em falta para o Chromium headed (Arkose). ' +
      'Confirme DISPLAY + XAUTHORITY (contentor tvde-rpa-vnc) ou Xvfb, e reinicie a API.'
    );
  }
  if (/Target page, context or browser has been closed/i.test(message)) {
    return 'O browser Playwright fechou inesperadamente. Tente Ligar conta novamente.';
  }
  return message;
}

/** Libs/fonts extraídas sem root (Ubuntu) — ver `scripts/setup-playwright-libs.sh`. */
function resolvePlaywrightLibsDir(): string | null {
  const fromEnv = process.env.PORTAL_RPA_LIBS_DIR?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates = [
    join(process.cwd(), '.playwright-libs'),
    join(process.cwd(), '..', '..', '.playwright-libs'),
    join(homedir(), 'tvde', '.playwright-libs'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'usr', 'lib', 'x86_64-linux-gnu'))) return dir;
  }
  return null;
}

/**
 * Preferir Chromium completo (não headless_shell) — mais estável em macOS 12.
 * Em Linux sem `apt install` (sem sudo), usa `.playwright-libs` via LD_LIBRARY_PATH + FONTCONFIG.
 * Ignorar PLAYWRIGHT_BROWSERS_PATH de sandboxes Cursor se o path default tiver browsers.
 */
function preparePlaywrightEnv() {
  // Headless shell falha com "Executable doesn't exist" em alguns setups; Chromium full é fiável.
  process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL = '0';

  const sandboxHint = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '';
  if (sandboxHint.includes('cursor-sandbox-cache')) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }

  const libsDir = resolvePlaywrightLibsDir();
  if (!libsDir) return;

  const libPath = [
    join(libsDir, 'usr', 'lib', 'x86_64-linux-gnu'),
    join(libsDir, 'lib', 'x86_64-linux-gnu'),
    process.env.LD_LIBRARY_PATH,
  ]
    .filter(Boolean)
    .join(':');
  process.env.LD_LIBRARY_PATH = libPath;

  const fontsConf = join(libsDir, 'etc', 'fonts', 'fonts.conf');
  if (existsSync(fontsConf)) {
    process.env.FONTCONFIG_PATH = join(libsDir, 'etc', 'fonts');
    process.env.FONTCONFIG_FILE = fontsConf;
  }
}

function setBrowserReadyCache(
  ready: boolean,
  detail: string,
  launchVerified: boolean
): { ready: boolean; detail: string } {
  browserReadyCache = {
    checkedAt: Date.now(),
    ready,
    detail,
    launchVerified,
  };
  return { ready, detail };
}

/** Raiz do monorepo (scripts/setup-playwright-libs.sh, package.json). */
export function resolvePortalRpaRepoRoot(): string {
  const candidates = [
    join(process.cwd(), '..', '..'),
    join(homedir(), 'tvde'),
    process.cwd(),
    join(process.cwd(), '..'),
  ];
  for (const dir of candidates) {
    if (
      existsSync(join(dir, 'package.json')) &&
      existsSync(join(dir, 'scripts', 'setup-playwright-libs.sh'))
    ) {
      return dir;
    }
  }
  return join(process.cwd(), '..', '..');
}

function runHealCommand(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): { ok: boolean; detail: string } {
  console.log(`[portal-rpa] auto-heal: ${label}…`);
  const r = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  const stderr = (r.stderr || '').trim();
  const stdout = (r.stdout || '').trim();
  if (r.error) {
    const detail = `${label} falhou: ${r.error.message}`;
    console.warn(`[portal-rpa] ${detail}`);
    return { ok: false, detail };
  }
  if (r.status !== 0) {
    const detail =
      `${label} saiu com código ${r.status}` +
      (stderr ? `: ${stderr.slice(-400)}` : stdout ? `: ${stdout.slice(-400)}` : '');
    console.warn(`[portal-rpa] ${detail}`);
    return { ok: false, detail };
  }
  console.log(`[portal-rpa] auto-heal OK: ${label}`);
  return { ok: true, detail: `${label} OK` };
}

function tryHealMissingBrowser(root: string): { ok: boolean; detail: string } {
  return runHealCommand(
    'playwright install chromium',
    'npx',
    ['playwright', 'install', 'chromium'],
    root,
    180_000
  );
}

function tryHealMissingLibs(root: string): { ok: boolean; detail: string } {
  const script = join(root, 'scripts', 'setup-playwright-libs.sh');
  if (!existsSync(script)) {
    return { ok: false, detail: 'scripts/setup-playwright-libs.sh em falta' };
  }
  return runHealCommand('playwright:libs', 'bash', [script], root, 300_000);
}

function classifyLaunchFailure(detail: string): 'missing_browser' | 'missing_libs' | 'other' {
  if (/Executable doesn't exist|playwright install|chromium_headless_shell|Chromium em falta/i.test(detail)) {
    return 'missing_browser';
  }
  if (
    /shared libraries|libatk|libgbm|cannot open shared object|Fontconfig|Could not find any font|TextRunHarfBuzz/i.test(
      detail
    )
  ) {
    return 'missing_libs';
  }
  return 'other';
}

/**
 * Probe rápido: cache (preferência launch-verified) ou existência do binário.
 * Não lança o browser — use `probePlaywrightBrowserLaunch` / `ensurePlaywrightReady`.
 */
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
    const detail = ready
      ? `Chromium no disco (${exe}) — launch ainda não verificado`
      : `Chromium em falta (${exe || 'sem path'})`;
    // Sem launch: só marcar ready se o ficheiro existe (boot async confirma a seguir)
    return setBrowserReadyCache(ready, detail, false);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return setBrowserReadyCache(false, detail, false);
  }
}

/** Lança Chromium headless e fecha — prova real de libs + binário. */
export async function probePlaywrightBrowserLaunch(): Promise<{
  ready: boolean;
  detail: string;
}> {
  preparePlaywrightEnv();
  try {
    const { chromium } = await import('playwright');
    const exe = chromium.executablePath();
    if (!exe || !existsSync(exe)) {
      return setBrowserReadyCache(false, `Chromium em falta (${exe || 'sem path'})`, true);
    }
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
    });
    await browser.close().catch(() => undefined);
    return setBrowserReadyCache(true, `Chromium OK (launch ${exe})`, true);
  } catch (err) {
    const detail = humanizePlaywrightError(err);
    invalidatePlaywrightBrowserCache();
    return setBrowserReadyCache(false, detail, true);
  }
}

/**
 * No arranque (ou antes de Ligar): probe de launch; se falhar, tenta auto-heal
 * em user-space (`playwright install` / `playwright:libs`) e volta a testar.
 */
export async function ensurePlaywrightReady(options?: {
  heal?: boolean;
  force?: boolean;
}): Promise<{ ready: boolean; detail: string; healed: boolean }> {
  const heal = options?.heal !== false;
  const force = options?.force === true;

  if (!force && browserReadyCache?.launchVerified) {
    const age = Date.now() - browserReadyCache.checkedAt;
    if (age < BROWSER_READY_TTL_MS) {
      return {
        ready: browserReadyCache.ready,
        detail: browserReadyCache.detail,
        healed: false,
      };
    }
  }

  if (ensurePlaywrightInFlight && !force) {
    return ensurePlaywrightInFlight;
  }

  const run = (async () => {
    let healed = false;
    if (force) invalidatePlaywrightBrowserCache();

    let probe = await probePlaywrightBrowserLaunch();
    if (probe.ready) {
      return { ready: true, detail: probe.detail, healed };
    }
    if (!heal) {
      return { ready: false, detail: probe.detail, healed };
    }

    const root = resolvePortalRpaRepoRoot();
    const kind = classifyLaunchFailure(probe.detail);
    const attempts: Array<'missing_browser' | 'missing_libs'> =
      kind === 'missing_libs'
        ? ['missing_libs', 'missing_browser']
        : kind === 'missing_browser'
          ? ['missing_browser', 'missing_libs']
          : ['missing_libs', 'missing_browser'];

    for (const step of attempts) {
      const result =
        step === 'missing_browser' ? tryHealMissingBrowser(root) : tryHealMissingLibs(root);
      if (!result.ok) continue;
      healed = true;
      preparePlaywrightEnv();
      invalidatePlaywrightBrowserCache();
      probe = await probePlaywrightBrowserLaunch();
      if (probe.ready) {
        return { ready: true, detail: probe.detail, healed };
      }
    }

    return {
      ready: false,
      detail: probe.detail,
      healed,
    };
  })();

  ensurePlaywrightInFlight = run.finally(() => {
    ensurePlaywrightInFlight = null;
  });
  return ensurePlaywrightInFlight;
}

export function invalidatePlaywrightBrowserCache() {
  browserReadyCache = null;
}

export function getPlaywrightReadinessSnapshot(): {
  ready: boolean;
  detail: string;
  launchVerified: boolean;
} {
  if (browserReadyCache) {
    return {
      ready: browserReadyCache.ready,
      detail: browserReadyCache.detail,
      launchVerified: browserReadyCache.launchVerified,
    };
  }
  const probe = probePlaywrightBrowser();
  return { ...probe, launchVerified: false };
}

let xvfbEnsuredFor: string | null = null;

function resolveTvdeX11Root(): string | null {
  const candidates = [
    process.env.TVDE_X11_ROOT,
    join(homedir(), 'tvde-x11', 'root'),
    join(process.cwd(), '..', '..', 'tvde-x11', 'root'),
    '/home/macbusinesss/tvde-x11/root',
  ].filter(Boolean) as string[];
  for (const root of candidates) {
    if (existsSync(join(root, 'usr', 'bin', 'Xvfb'))) return root;
  }
  return null;
}

function prependPathEnv(key: string, ...dirs: string[]) {
  const existing = process.env[key] ?? '';
  const parts = [...dirs.filter((d) => d && existsSync(d)), ...existing.split(':').filter(Boolean)];
  process.env[key] = [...new Set(parts)].join(':');
}

/**
 * Xvnc do contentor `tvde-rpa-vnc` partilha `/tmp/.X11-unix/X1` mas exige XAUTHORITY.
 * Sem cookie o Chromium headed aborta com «Missing X server».
 */
function ensureXAuthority(): void {
  if (process.platform === 'darwin') return;
  const current = process.env.XAUTHORITY?.trim();
  if (current && existsSync(current)) return;

  const candidates = [
    process.env.PORTAL_RPA_XAUTHORITY?.trim(),
    join(homedir(), 'tvde', '.xauthority-vnc'),
    '/tmp/tvde-xauth',
    join(homedir(), '.Xauthority'),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (existsSync(path)) {
      process.env.XAUTHORITY = path;
      return;
    }
  }

  const dest = join(homedir(), 'tvde', '.xauthority-vnc');
  try {
    const r = spawnSync('docker', ['cp', 'tvde-rpa-vnc:/headless/.Xauthority', dest], {
      stdio: 'ignore',
      timeout: 8000,
    });
    if (r.status === 0 && existsSync(dest)) {
      process.env.XAUTHORITY = dest;
      console.log(`[portal-rpa] XAUTHORITY sincronizado de tvde-rpa-vnc → ${dest}`);
    }
  } catch {
    // ignore — headed pode falhar e cair para headless
  }
}

/**
 * Arkose / FunCaptcha quase nunca pinta em headless — o iframe existe (detecção OK)
 * mas o JPEG mostra a identidade por baixo. Para «Desafio Uber» usamos Chromium headed
 * num display virtual (Xvfb / tvde-x11 / VNC :1), sem VNC para o gestor.
 */
export function ensureVirtualDisplay(preferred = process.env.DISPLAY || ':1'): string | null {
  if (process.platform === 'darwin') {
    return process.env.DISPLAY || null;
  }

  const display = preferred.startsWith(':') ? preferred : `:${preferred}`;
  const n = display.replace(/^:/, '');
  const x11Root = resolveTvdeX11Root();
  if (x11Root) {
    prependPathEnv('PATH', join(x11Root, 'usr', 'bin'));
    prependPathEnv(
      'LD_LIBRARY_PATH',
      join(x11Root, 'usr', 'lib', 'x86_64-linux-gnu'),
      join(x11Root, 'lib', 'x86_64-linux-gnu')
    );
  }

  ensureXAuthority();

  const socketOk = () => existsSync(`/tmp/.X11-unix/X${n}`);

  const displayWorks = (d: string) => {
    if (existsSync(`/tmp/.X11-unix/X${d.replace(/^:/, '')}`)) return true;
    const r = spawnSync('xdpyinfo', ['-display', d], {
      stdio: 'ignore',
      timeout: 2500,
      env: { ...process.env, DISPLAY: d },
    });
    return r.status === 0;
  };

  if (displayWorks(display)) {
    process.env.DISPLAY = display;
    xvfbEnsuredFor = display;
    return display;
  }

  if (xvfbEnsuredFor === display && socketOk()) {
    process.env.DISPLAY = display;
    return display;
  }

  const xvfbBin =
    (x11Root ? join(x11Root, 'usr', 'bin', 'Xvfb') : '') ||
    (spawnSync('which', ['Xvfb'], { encoding: 'utf8' }).stdout || '').trim();
  if (!xvfbBin || !existsSync(xvfbBin)) {
    // Sem binário novo: se o socket já existir (ex. Xvfb antigo / VNC), usar na mesma
    if (socketOk()) {
      process.env.DISPLAY = display;
      xvfbEnsuredFor = display;
      return display;
    }
    console.warn(
      `[portal-rpa] Xvfb não encontrado — headed Chromium precisa de DISPLAY (tvde-x11 ou apt install xvfb). Pedido: ${display}`
    );
    return null;
  }

  try {
    const child = spawn(
      xvfbBin,
      [display, '-screen', '0', '1440x900x24', '-ac', '-nolisten', 'tcp'],
      { detached: true, stdio: 'ignore', env: process.env }
    );
    child.unref();
    console.log(`[portal-rpa] Xvfb arrancado em DISPLAY=${display} (${xvfbBin} pid≈${child.pid})`);
  } catch (err) {
    console.warn(
      '[portal-rpa] falha a arrancar Xvfb:',
      err instanceof Error ? err.message : err
    );
    if (socketOk()) {
      process.env.DISPLAY = display;
      return display;
    }
    return null;
  }

  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (displayWorks(display) || socketOk()) {
      process.env.DISPLAY = display;
      xvfbEnsuredFor = display;
      return display;
    }
    spawnSync('sleep', ['0.2']);
  }

  process.env.DISPLAY = display;
  xvfbEnsuredFor = display;
  console.warn(`[portal-rpa] Xvfb DISPLAY=${display} ainda sem socket — a tentar mesmo assim`);
  return display;
}

async function launchChromium(headless: boolean): Promise<Browser> {
  preparePlaywrightEnv();
  const { chromium } = await import('playwright');

  let probe = probePlaywrightBrowser();
  if (!probe.ready || (browserReadyCache && !browserReadyCache.launchVerified)) {
    const ensured = await ensurePlaywrightReady({ heal: true });
    probe = { ready: ensured.ready, detail: ensured.detail };
  }
  if (!probe.ready) {
    throw new Error(humanizePlaywrightError(new Error(probe.detail)));
  }

  let useHeadless = headless;
  if (!useHeadless) {
    const display = ensureVirtualDisplay();
    if (!display && !process.env.DISPLAY) {
      console.warn(
        '[portal-rpa] headed pedido mas sem DISPLAY — fallback headless (Arkose pode não pintar)'
      );
      useHeadless = true;
    } else {
      console.log(
        `[portal-rpa] Chromium headed DISPLAY=${display ?? process.env.DISPLAY ?? '(none)'} ` +
          `(Arkose precisa de paint real para o stream Desafio Uber)`
      );
    }
  }

  const options: LaunchOptions = {
    headless: useHeadless,
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      // Headed + Xvfb: GPU software costuma falhar; headless clássico também
      '--disable-gpu',
      ...(useHeadless ? [] : ['--window-size=1440,900']),
    ],
  };

  const launchOnce = async (opts: LaunchOptions) => chromium.launch(opts);

  try {
    return await launchOnce(options);
  } catch (err) {
    invalidatePlaywrightBrowserCache();
    // One-shot auto-heal (libs/binário) depois de falha de launch
    const healed = await ensurePlaywrightReady({ heal: true, force: true });
    if (healed.ready) {
      try {
        return await launchOnce(options);
      } catch {
        // cair para fallbacks abaixo
      }
    }

    // Fallback: tentar com executablePath explícito
    try {
      const exe = chromium.executablePath();
      return await launchOnce({ ...options, executablePath: exe });
    } catch (err2) {
      // Último recurso: se headed falhou por display, tentar headless
      if (!useHeadless) {
        console.warn(
          '[portal-rpa] headed launch falhou — retry headless:',
          err2 instanceof Error ? err2.message : err2
        );
        try {
          return await launchOnce({
            ...options,
            headless: true,
            args: options.args?.filter((a) => !a.startsWith('--window-size')),
          });
        } catch (err3) {
          throw new Error(
            humanizePlaywrightError(
              err instanceof Error &&
                /shared libraries|libatk|Missing X server|XServer/i.test(err.message)
                ? err
                : err3 instanceof Error
                  ? err3
                  : err2 instanceof Error
                    ? err2
                    : err
            )
          );
        }
      }
      throw new Error(
        humanizePlaywrightError(
          err instanceof Error && /shared libraries|libatk|Missing X server|XServer/i.test(err.message)
            ? err
            : err2 instanceof Error
              ? err2
              : err
        )
      );
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
    await page.addInitScript(
      `(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        } catch (_) {}
        try {
          const fail = () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
          if (window.PublicKeyCredential) {
            window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => false;
          }
          if (navigator.credentials) {
            navigator.credentials.get = fail;
            navigator.credentials.create = fail;
          }
        } catch (_) {}
      })()`
    );

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
