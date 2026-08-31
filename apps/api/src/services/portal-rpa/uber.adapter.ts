import type { Page } from 'playwright';
import {
  defaultUberReportRange,
  resolveUberReportType,
  uberReportTypeLabel,
  uberReportTypeOptionMatches,
  type UberReportListItem,
  type UberReportTypeKey,
  type UberSyncOptions,
} from '@tvde/shared';
import type { PortalAdapter, PortalLoginPhase, PortalSyncOptions, PortalSyncPhase } from './types';
import { captureStorageState } from './types';
import { env } from '../../config/env';

/**
 * Uber Supplier Portal — ver docs/07-UBER.md
 * - Host app: supplier.uber.com (singular)
 * - Auth: auth.uber.com/v2 (Breeze)
 * - OTP SMS: 4 dígitos (#PHONE_SMS_OTP-0..3) via modal TVDE
 * - Pós-OTP: «Iniciar sessão com a palavra-passe» (não passkey)
 * - Sync: lista/escolha relatório ou Gerar «Transação de pagamentos» (`payments_order`) com intervalo → poll
 */

const SUPPLIER_HOME = 'https://supplier.uber.com/';
const AUTH_HOST = 'auth.uber.com';

function isAuthUrl(url: string): boolean {
  return url.includes(AUTH_HOST);
}

function isSupplierUrl(url: string): boolean {
  return url.includes('supplier.uber.com');
}

async function identityInput(page: Page) {
  // Confirmado no Breeze (2026-07-17): id=PHONE_NUMBER_or_EMAIL_ADDRESS type=email name=email
  return page
    .locator('#PHONE_NUMBER_or_EMAIL_ADDRESS')
    .or(page.getByPlaceholder(/telefone|e-?mail|phone|email/i))
    .or(page.getByLabel(/telefone|e-?mail|phone|email/i))
    .or(
      page.locator(
        'input[name="email"], input[type="email"], input[type="tel"], input[inputmode="email"], input[inputmode="tel"]'
      )
    )
    .first();
}

async function dismissUberNoise(page: Page): Promise<void> {
  // Cookies / banners ocasionais
  const accept = page
    .getByRole('button', { name: /aceitar|accept|concordar|got it|ok/i })
    .first();
  if (await accept.isVisible().catch(() => false)) {
    await accept.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}

/** Garante que estamos no auth Breeze com o form de identidade (ou já num desafio). */
async function ensureAuthLanding(page: Page): Promise<void> {
  await page.goto(SUPPLIER_HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Redirect supplier → auth.uber.com/v2/?next_url=…
  try {
    await page.waitForURL(/auth\.uber\.com/, { timeout: 45_000 });
  } catch {
    // Pode já estar autenticado no supplier
    if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) return;
  }
  await dismissUberNoise(page);

  // Spinner Breeze: esperar input OU password/OTP/passkey (até ~45s)
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) return;
    if (await isOtpScreen(page)) return;
    if (await isPasswordScreen(page)) return;
    if (await isPasskeyScreen(page)) return;
    const identity = await identityInput(page);
    if (await identity.isVisible().catch(() => false)) return;
    // Texto do ecrã identidade sem input ainda = SPA a hidratar
    const prompt = page.getByText(/número de telefone ou e-?mail|phone number or email/i).first();
    if (await prompt.isVisible().catch(() => false)) {
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(700);
  }
  // Não lançar aqui — o caller tenta reload / fillIdentity com mensagem clara
}

async function isOtpScreen(page: Page): Promise<boolean> {
  if (await page.locator('[screen-test="PHONE_OTP"]').first().isVisible().catch(() => false)) {
    return true;
  }
  return page.locator('#PHONE_SMS_OTP-0, [data-testid="PHONE_SMS_OTP"]').first().isVisible().catch(() => false);
}

export async function isUberPasswordScreen(page: Page): Promise<boolean> {
  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    return true;
  }
  // Copy PT/EN do form (não o chooser «Iniciar sessão com a palavra-passe»)
  return page
    .getByText(/introduza a sua palavra-?passe|enter (your )?password/i)
    .first()
    .isVisible()
    .catch(() => false);
}

async function isPasswordScreen(page: Page): Promise<boolean> {
  return isUberPasswordScreen(page);
}

/** Arkose / FunCaptcha — «Proteger a sua conta» após Continuar (headless costuma disparar). */
const BOT_CHALLENGE_TEXT_RE =
  /proteger a sua conta|protect your account|resolva este desafio|solve this challenge|iniciar desafio|start (the )?challenge|sabermos que é uma pessoa|verify you are (a )?human|are you a human/i;

const BOT_CHALLENGE_IFRAME_SEL =
  'iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[src*="arkose"], iframe[src*="ec-game-core"], iframe[src*="ak0"], iframe[src*="recaptcha/enterprise"]';

const IDENTITY_EMPTY_ERROR_RE =
  /introduza um número de telefone ou e-?mail|enter (a )?(phone number or )?e-?mail|please enter (a )?(phone|e-?mail)/i;

/**
 * Identidade ainda interactiva com email vazio ou erro de validação.
 * O Breeze pré-carrega iframes Arkose — sem isto classificávamos bot cedo demais.
 */
export async function isStuckOnEmptyIdentity(page: Page): Promise<boolean> {
  const identity = await identityInput(page);
  if (!(await identity.isVisible().catch(() => false))) return false;

  const emptyErr = await page
    .getByText(IDENTITY_EMPTY_ERROR_RE)
    .first()
    .isVisible()
    .catch(() => false);
  if (emptyErr) return true;

  const value = ((await identity.inputValue().catch(() => '')) || '').trim();
  if (value) return false;

  // Vazio + editável = Continuar sem email (nunca handoff bot)
  if (!(await identity.isDisabled().catch(() => true))) return true;
  return false;
}

/** Detecção bruta de iframe/texto Arkose (ignora estado do form identidade). */
async function isBotChallengeSignalRaw(page: Page): Promise<boolean> {
  // Main frame (raro — o copy vive quase sempre no iframe)
  if (await page.getByText(BOT_CHALLENGE_TEXT_RE).first().isVisible().catch(() => false)) return true;

  // Iframes Uber enforcement / Arkose game-core / reCAPTCHA enterprise
  if (
    await page
      .locator(BOT_CHALLENGE_IFRAME_SEL)
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    // Só contar como desafio activo se houver game-core / texto / bframe (não só o badge reCAPTCHA)
    for (const f of page.frames()) {
      const url = f.url();
      if (/ec-game-core|funcaptcha|arkoselabs|recaptcha\/enterprise\/bframe/i.test(url)) return true;
      if (/ak0[a-z0-9]*\.uber\.com/i.test(url)) {
        const has = await f.getByText(BOT_CHALLENGE_TEXT_RE).first().isVisible().catch(() => false);
        if (has) return true;
      }
    }
  }

  for (const f of page.frames()) {
    try {
      const url = f.url();
      if (/ec-game-core|funcaptcha|arkoselabs/i.test(url)) return true;
      if (await f.getByText(BOT_CHALLENGE_TEXT_RE).first().isVisible().catch(() => false)) return true;
    } catch {
      // frame detached
    }
  }
  return false;
}

/**
 * True só para handoff / watcher: sinal Arkose E não estamos no email vazio.
 * Prefill de iframe no ecrã identidade NÃO conta.
 */
export async function isBotChallengeScreen(page: Page): Promise<boolean> {
  if (await isStuckOnEmptyIdentity(page)) return false;
  return isBotChallengeSignalRaw(page);
}

/**
 * Pronto para authChallenge=bot / modal Desafio Uber:
 * email preenchido (se o campo ainda existir), Continuar avançou, e
 * (paint visual OU iframe bot com UI de desafio / form disabled a montar overlay).
 */
export async function canHandoffBotChallenge(page: Page): Promise<boolean> {
  if (await isOtpScreen(page)) return false;
  if (await isUberPasswordScreen(page)) return false;
  if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) return false;
  if (await isStuckOnEmptyIdentity(page)) return false;
  if (!(await isBotChallengeSignalRaw(page))) return false;

  const visual = await isBotChallengeVisuallyReady(page);
  const identity = await identityInput(page);
  const identityVisible = await identity.isVisible().catch(() => false);

  if (!identityVisible) {
    // Saiu do form — pode ser OTP/password, não assumir bot
    if (await isOtpScreen(page)) return false;
    if (await isUberPasswordScreen(page)) return false;
    return true;
  }

  const value = ((await identity.inputValue().catch(() => '')) || '').trim();
  if (!value) return false;

  if (visual) return true;

  // Overlay a montar: input disabled após Continuar com email válido
  if (await identity.isDisabled().catch(() => false)) return true;

  // Form ainda editável com email = Continuar não avançou de forma fiável
  return false;
}

/** FunCaptcha já no puzzle (após «Iniciar desafio») — copy muda para «1 de 5» / Enviar / setas. */
const FUNCAPTCHA_PUZZLE_RE =
  /\d+\s*(de|of)\s*\d+|use as setas|use the arrows|arraste a imagem|drag (the )?image|verificar|verify you|sou humano|i am human/i;

/**
 * True quando o desafio está pintado: copy Arkose, puzzle FunCaptcha, ou canvas no game-core.
 * Em headless o iframe existe mas Arkose não pinta — JPEG = identidade por baixo.
 */
export async function isBotChallengeVisuallyReady(page: Page): Promise<boolean> {
  if (await isOtpScreen(page)) return false;
  if (await isUberPasswordScreen(page)) return false;
  if (await page.getByText(BOT_CHALLENGE_TEXT_RE).first().isVisible().catch(() => false)) {
    return true;
  }
  if (await page.getByText(FUNCAPTCHA_PUZZLE_RE).first().isVisible().catch(() => false)) {
    return true;
  }
  // Botão Enviar do puzzle (só no contexto arkose — evita CTAs genéricos da página)
  for (const f of page.frames()) {
    try {
      const url = f.url();
      const arkoseFrame = /ec-game-core|funcaptcha|arkoselabs|ak0[a-z0-9]*\.uber\.com/i.test(url);
      if (
        await f.getByText(BOT_CHALLENGE_TEXT_RE).first().isVisible().catch(() => false)
      ) {
        return true;
      }
      if (await f.getByText(FUNCAPTCHA_PUZZLE_RE).first().isVisible().catch(() => false)) {
        return true;
      }
      if (arkoseFrame) {
        const sendBtn = f.getByRole('button', { name: /^(enviar|submit|verify|verificar)$/i }).first();
        if (await sendBtn.isVisible().catch(() => false)) return true;
        const canvasCount = await f.locator('canvas').count().catch(() => 0);
        if (canvasCount > 0) {
          const box = await f.locator('canvas').first().boundingBox().catch(() => null);
          if (box && box.width >= 80 && box.height >= 80) return true;
        }
      }
    } catch {
      // frame detached
    }
  }
  return false;
}

/** Overlay Arkose activo (iframe game-core com tamanho) — não re-clicar Continuar. */
export async function hasActiveArkoseOverlay(page: Page): Promise<boolean> {
  if (await isBotChallengeVisuallyReady(page).catch(() => false)) return true;
  const iframe = page.locator(BOT_CHALLENGE_IFRAME_SEL).first();
  if (!(await iframe.isVisible().catch(() => false))) return false;
  const box = await iframe.boundingBox().catch(() => null);
  if (box && box.width >= 200 && box.height >= 200) return true;
  for (const f of page.frames()) {
    const url = f.url();
    if (/ec-game-core|funcaptcha|arkoselabs/i.test(url)) return true;
  }
  return false;
}

async function tryClickStartChallenge(page: Page): Promise<boolean> {
  const startBtn = page.getByRole('button', { name: /iniciar desafio|start (the )?challenge/i }).first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click({ timeout: 5000 }).catch(() => undefined);
    return true;
  }
  for (const f of page.frames()) {
    try {
      const btn = f.getByRole('button', { name: /iniciar desafio|start (the )?challenge/i }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 5000 }).catch(() => undefined);
        return true;
      }
    } catch {
      // frame detached
    }
  }
  return false;
}

/**
 * Nudge: se o iframe Arkose existe mas ainda se vê a identidade —
 * re-preencher email (se vazio) e só depois Continuar. Nunca Continuar em branco.
 * Nunca re-click Continuar quando o overlay/puzzle já está activo (texto identidade
 * continua «visível» no DOM por baixo — Playwright isVisible não detecta cobertura).
 */
export async function nudgeBotChallengePaint(page: Page, username?: string): Promise<void> {
  if (await isBotChallengeVisuallyReady(page)) {
    await tryClickStartChallenge(page);
    return;
  }

  // Email vazio / erro validação — re-fill a partir das credenciais do job
  if (await isStuckOnEmptyIdentity(page)) {
    if (username?.trim()) {
      console.log('[uber-login] bot nudge: identidade vazia/erro — re-fill email + Continuar');
      await fillIdentity(page, username.trim()).catch((err) => {
        console.log(
          '[uber-login] bot nudge re-fill falhou:',
          err instanceof Error ? err.message : err
        );
      });
    } else {
      console.log(
        '[uber-login] bot nudge: identidade vazia sem username — NÃO clicar Continuar ' +
          (await identityFieldDiagnostics(page))
      );
    }
    return;
  }

  if (!(await isBotChallengeSignalRaw(page)) && !(await isBotChallengeScreen(page))) return;

  const identity = await identityInput(page);
  const identityFieldVisible = await identity.isVisible().catch(() => false);
  const identityDisabled = identityFieldVisible
    ? await identity.isDisabled().catch(() => false)
    : false;
  const value = identityFieldVisible
    ? ((await identity.inputValue().catch(() => '')) || '').trim()
    : '';

  // Continuar já avançou (campo disabled) OU overlay Arkose com tamanho —
  // NÃO force-click Continuar (destrói o FunCaptcha / pode fechar o browser).
  if (identityDisabled || (await hasActiveArkoseOverlay(page))) {
    console.log(
      '[uber-login] bot nudge: overlay/puzzle activo (disabled=' +
        String(identityDisabled) +
        ') — só z-index + Iniciar desafio, sem re-click Continuar'
    );
    await boostArkoseIframeVisibility(page);
    await tryClickStartChallenge(page);
    return;
  }

  // Form ainda editável com email = Continuar não avançou de forma fiável
  const identityCopyVisible = await page
    .getByText(/número de telefone ou e-?mail|phone number or email|qual é o seu/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (identityCopyVisible && value) {
    console.log('[uber-login] bot: identidade editável sob iframe — re-click Continuar');
    await clickContinue(page, { force: true }).catch(() => undefined);
    await page.waitForTimeout(1500);
  } else if (identityCopyVisible && !value) {
    console.log('[uber-login] bot nudge: input vazio — skip Continuar');
    return;
  }

  await boostArkoseIframeVisibility(page);
  await tryClickStartChallenge(page);
}

async function boostArkoseIframeVisibility(page: Page): Promise<void> {
  await page
    .evaluate(`(() => {
      const sels = [
        'iframe[src*="arkoselabs"]',
        'iframe[src*="funcaptcha"]',
        'iframe[src*="arkose"]',
        'iframe[src*="ec-game-core"]',
        'iframe[src*="ak0"]',
      ];
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          const iframe = el;
          iframe.style.setProperty('opacity', '1', 'important');
          iframe.style.setProperty('visibility', 'visible', 'important');
          iframe.style.setProperty('pointer-events', 'auto', 'important');
          iframe.style.setProperty('z-index', '2147483647', 'important');
          const r = iframe.getBoundingClientRect();
          if (r.width < 40 || r.height < 40) {
            iframe.style.setProperty('width', '100vw', 'important');
            iframe.style.setProperty('height', '100vh', 'important');
            iframe.style.setProperty('position', 'fixed', 'important');
            iframe.style.setProperty('inset', '0', 'important');
          }
        }
      }
    })()`)
    .catch(() => undefined);
}

async function isSignInBlockedBanner(page: Page): Promise<boolean> {
  return page
    .getByText(/não é possível iniciar sessão|unable to (sign|log) in|try again later/i)
    .first()
    .isVisible()
    .catch(() => false);
}

async function isIdentityScreen(page: Page): Promise<boolean> {
  // Email vazio / erro validação = identidade (mesmo com iframe Arkose pré-carregado)
  if (await isStuckOnEmptyIdentity(page)) return true;
  // Overlay Arkose real (handoff-ready) tapa o form — NÃO reportar como identidade «presa»
  if (await canHandoffBotChallenge(page)) return false;
  if (await isBotChallengeVisuallyReady(page)) return false;
  const identity = await identityInput(page);
  if (!(await identity.isVisible().catch(() => false))) return false;
  if (await isPasswordScreen(page) || (await isOtpScreen(page))) return false;
  const prompt = page.getByText(/número de telefone ou e-?mail|phone number or email|qual é o seu/i).first();
  if (await prompt.isVisible().catch(() => false)) return true;
  return !(await isPasskeyScreen(page));
}

/** Botões Continuar/Seguinte do Breeze (exclui Google/Apple/passkey). */
function primaryContinueButtons(page: Page) {
  return page
    .getByRole('button', { name: /^(continuar|seguinte|next|entrar|sign in)$/i })
    .or(page.locator('button[type="submit"]').filter({ hasText: /^(continuar|seguinte|next)$/i }));
}

/**
 * CTA principal — NÃO apanhar «Continuar com Google/Apple/chave de acesso».
 * Preferir botão exacto «Continuar» / «Seguinte».
 */
async function clickContinue(page: Page, opts?: { force?: boolean }): Promise<boolean> {
  const force = opts?.force === true;
  // Exact match first (Breeze: type=submit «Continuar»)
  const exact = primaryContinueButtons(page);
  const exactCount = await exact.count();
  for (let i = 0; i < exactCount; i += 1) {
    const btn = exact.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const testId = ((await btn.getAttribute('data-testid').catch(() => null)) || '').toLowerCase();
    const id = ((await btn.getAttribute('id').catch(() => null)) || '').toLowerCase();
    if (id === 'passkey-login-btn' || /passkey/.test(testId)) continue;
    const label = ((await btn.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (/google|apple|chave|passkey|acesso|facebook|sms|salvaguarda/i.test(label)) continue;
    for (let w = 0; w < 12; w += 1) {
      if (!(await btn.isDisabled().catch(() => true))) break;
      await page.waitForTimeout(350);
    }
    if (!force && (await btn.isDisabled().catch(() => true))) continue;
    await btn.click({ timeout: 10_000, force }).catch(() => undefined);
    return true;
  }

  const candidates = page.getByRole('button', { name: /continuar|seguinte|next|entrar|sign in/i });
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const btn = candidates.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const testId = ((await btn.getAttribute('data-testid').catch(() => null)) || '').toLowerCase();
    const id = ((await btn.getAttribute('id').catch(() => null)) || '').toLowerCase();
    if (id === 'passkey-login-btn' || /passkey/.test(testId)) continue;
    const label = ((await btn.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (/google|apple|chave|passkey|acesso|facebook|sms|salvaguarda/i.test(label)) continue;
    for (let w = 0; w < 12; w += 1) {
      if (!(await btn.isDisabled().catch(() => true))) break;
      await page.waitForTimeout(350);
    }
    if (!force && (await btn.isDisabled().catch(() => true))) continue;
    await btn.click({ timeout: 10_000, force }).catch(() => undefined);
    return true;
  }
  return false;
}

/**
 * Preenche o input Breeze de forma que o React actualize o estado.
 * Crítico: resetar `_valueTracker` — sem isto o Continuar fica aria-disabled
 * mesmo com o email visível no DOM.
 */
async function setIdentityValue(page: Page, username: string): Promise<void> {
  const safe = JSON.stringify(username);
  await page.evaluate(
    `(() => {
      const el = document.querySelector('#PHONE_NUMBER_or_EMAIL_ADDRESS');
      if (!el) return;
      const value = ${safe};
      el.removeAttribute('disabled');
      el.removeAttribute('readonly');
      el.disabled = false;
      el.readOnly = false;
      el.focus();
      const proto = window.HTMLInputElement.prototype;
      const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const ownSetter = Object.getOwnPropertyDescriptor(el, 'value')?.set;
      // React 16/17/18: tracker deve ver o valor *anterior* antes do set,
      // senão onChange é ignorado e Continuar submete email vazio.
      const tracker = el._valueTracker;
      const prev = el.value;
      if (tracker) tracker.setValue(prev === value ? (value ? value + ' ' : ' ') : prev);
      if (protoSetter) protoSetter.call(el, value);
      else if (ownSetter) ownSetter.call(el, value);
      else el.value = value;
      if (tracker) tracker.setValue(prev);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: value ? 'insertText' : 'deleteContentBackward',
        }));
      } catch (_) {}
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    })()`
  );
}

async function identityFieldDiagnostics(page: Page): Promise<string> {
  try {
    const dump = (await page.evaluate(
      `(() => {
        const el = document.querySelector('#PHONE_NUMBER_or_EMAIL_ADDRESS');
        const buttons = [...document.querySelectorAll('button')].map((b) => ({
          text: (b.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
          disabled: b.disabled,
          ariaDisabled: b.getAttribute('aria-disabled'),
          type: b.getAttribute('type'),
        }));
        const continuar = buttons.find((b) => /^(continuar|seguinte|next)$/i.test(b.text));
        const err =
          document.querySelector('[id*="error"], [data-testid*="error"], [role="alert"]')?.textContent || '';
        return {
          value: el?.value ?? null,
          disabled: el?.disabled ?? null,
          exists: Boolean(el),
          continuarDisabled: continuar?.disabled ?? null,
          continuarAria: continuar?.ariaDisabled ?? null,
          continuarText: continuar?.text ?? null,
          err: (err || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
        };
      })()`
    )) as {
      value: string | null;
      disabled: boolean | null;
      exists: boolean;
      continuarDisabled: boolean | null;
      continuarAria: string | null;
      continuarText: string | null;
      err: string;
    };
    return `input=${JSON.stringify(dump.value)} btn=${dump.continuarText || '?'} disabled=${dump.continuarDisabled} aria=${dump.continuarAria} err=${JSON.stringify(dump.err)}`;
  } catch {
    return 'diag=unavailable';
  }
}

async function captureIdentityStuckDebug(page: Page): Promise<string | null> {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // apps/api cwd → monorepo root; fallbacks for PM2
    const candidates = [
      path.resolve(process.cwd(), '../../.tmp-uber-identity-stuck'),
      path.resolve(process.cwd(), '.tmp-uber-identity-stuck'),
      '/tmp/tvde-uber-identity-stuck',
    ];
    let outDir: string | null = null;
    for (const c of candidates) {
      try {
        await fs.mkdir(c, { recursive: true });
        outDir = c;
        break;
      } catch {
        // try next
      }
    }
    if (!outDir) return null;
    const file = path.join(outDir, `stuck-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`[uber-login] identity stuck screenshot: ${file} ${await identityFieldDiagnostics(page)}`);
    return file;
  } catch (err) {
    console.log(
      '[uber-login] identity stuck screenshot falhou:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Espera o Continuar principal ficar clicável (React validou o email). */
async function waitContinueEnabled(page: Page, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exact = primaryContinueButtons(page);
    const n = await exact.count();
    for (let i = 0; i < n; i += 1) {
      const btn = exact.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      const label = ((await btn.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (/google|apple|chave|passkey|acesso|facebook/i.test(label)) continue;
      if (!(await btn.isDisabled().catch(() => true))) return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function fillIdentity(page: Page, username: string): Promise<void> {
  const identity = await identityInput(page);
  try {
    await identity.waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    const debug = await pageAuthDebug(page);
    throw new Error(
      `Login Uber: formulário de email/telefone não apareceu a tempo (${debug}). ` +
        'Tente Ligar conta outra vez; se repetir, use import manual.'
    );
  }

  // Breeze / WebAuthn: input pode começar disabled (autocomplete="email webauthn")
  const enableDeadline = Date.now() + 15_000;
  while (Date.now() < enableDeadline) {
    const disabled = await identity.isDisabled().catch(() => true);
    if (!disabled) break;
    await page.waitForTimeout(400);
  }

  await page.evaluate(
    `(() => {
      const el = document.querySelector('#PHONE_NUMBER_or_EMAIL_ADDRESS');
      if (!el) return;
      el.removeAttribute('disabled');
      el.removeAttribute('readonly');
      el.disabled = false;
      el.readOnly = false;
    })()`
  );

  // 1) Foco real + limpar (cookies / autocomplete stale)
  await identity.click({ timeout: 8000 }).catch(() =>
    identity.click({ force: true, timeout: 5000 })
  );
  await page.keyboard.press('Meta+a').catch(() => undefined);
  await page.keyboard.press('Control+a').catch(() => undefined);
  await page.keyboard.press('Backspace').catch(() => undefined);
  await identity.fill('').catch(() => undefined);
  await setIdentityValue(page, '');

  // 2) Escrever como humano (eventos de teclado → React onChange)
  let typed = false;
  try {
    await identity.pressSequentially(username, { delay: 25 });
    typed = true;
  } catch {
    typed = false;
  }
  if (!typed) {
    await identity.click({ force: true }).catch(() => undefined);
    await page.keyboard.type(username, { delay: 30 }).catch(() => undefined);
  }

  // 3) Garantir DOM + estado React (_valueTracker) — até 3 tentativas
  let value = ((await identity.inputValue().catch(() => '')) || '').trim();
  for (let retry = 0; retry < 3 && value.toLowerCase() !== username.toLowerCase(); retry += 1) {
    await setIdentityValue(page, username);
    await identity.fill(username).catch(() => undefined);
    await identity.click({ force: true }).catch(() => undefined);
    await page.keyboard.type(username, { delay: 20 }).catch(() => undefined);
    await setIdentityValue(page, username);
    value = ((await identity.inputValue().catch(() => '')) || '').trim();
  }
  // Re-disparar tracker mesmo se o valor DOM já estiver correcto
  await setIdentityValue(page, username);
  value = ((await identity.inputValue().catch(() => '')) || '').trim();

  // 4) Blur / Tab para o Breeze validar e activar Continuar
  await identity.blur().catch(() => undefined);
  await page.keyboard.press('Tab').catch(() => undefined);
  await page.waitForTimeout(400);

  // Re-ler após blur (React pode limpar se o tracker falhou)
  value = ((await identity.inputValue().catch(() => '')) || '').trim();
  if (value.toLowerCase() !== username.toLowerCase()) {
    await setIdentityValue(page, username);
    value = ((await identity.inputValue().catch(() => '')) || '').trim();
  }

  const enabled = await waitContinueEnabled(page, 8_000);
  console.log(
    `[uber-login] identity fill ok=${value.toLowerCase() === username.toLowerCase()} continuarEnabled=${enabled} ${await identityFieldDiagnostics(page)}`
  );

  // NUNCA Continuar com email vazio — causa «Introduza um número…» + falso handoff bot
  if (!value || value.toLowerCase() !== username.toLowerCase()) {
    await captureIdentityStuckDebug(page);
    throw new Error(
      `Login Uber: falha a preencher o email (valor=${JSON.stringify(value)}). ` +
        'Tente Ligar conta outra vez.'
    );
  }

  // 5) Submeter: Continuar (evitar form.submit nativo — parte o SPA Breeze)
  let clicked = await clickContinue(page);
  if (!clicked) {
    // Re-confirmar valor antes de force
    value = ((await identity.inputValue().catch(() => '')) || '').trim();
    if (value.toLowerCase() === username.toLowerCase()) {
      clicked = await clickContinue(page, { force: true });
    }
  }
  if (!clicked) {
    value = ((await identity.inputValue().catch(() => '')) || '').trim();
    if (value.toLowerCase() === username.toLowerCase()) {
      await identity.focus().catch(() => undefined);
      await page.keyboard.press('Enter').catch(() => undefined);
    }
  }

  // Esperar sair do ecrã identidade (até 25s), com retries de submit
  const leaveDeadline = Date.now() + 25_000;
  let attempt = 0;
  while (Date.now() < leaveDeadline) {
    // Só sair para bot quando handoff é seguro (email + Continuar avançou)
    if (await canHandoffBotChallenge(page)) {
      console.log('[uber-login] após Continuar: desafio anti-bot (Arkose)');
      return;
    }
    if (await isStuckOnEmptyIdentity(page)) {
      console.log('[uber-login] após Continuar: email vazio/erro — re-fill');
      await setIdentityValue(page, username);
      await waitContinueEnabled(page, 3_000);
      await clickContinue(page);
      await page.waitForTimeout(800);
      attempt += 1;
      continue;
    }
    // Após submit o form fica disabled enquanto o overlay Arkose monta
    const idNow = await identityInput(page);
    if (await idNow.isDisabled().catch(() => false)) {
      const waitBotUntil = Date.now() + 10_000;
      while (Date.now() < waitBotUntil) {
        if (await canHandoffBotChallenge(page)) {
          console.log('[uber-login] após Continuar: desafio anti-bot (form disabled → Arkose)');
          return;
        }
        if (!(await isIdentityScreen(page))) {
          if ((await isAuthMethodChooser(page)) || (await isPasskeyScreen(page))) {
            await preferSmsOverPasskey(page);
          }
          return;
        }
        await page.waitForTimeout(500);
      }
      // Disabled prolongado sem classificação clara — não martelar Continuar
      console.log(
        `[uber-login] form identity disabled prolongado após Continuar ${await pageAuthDebug(page)}`
      );
      await captureIdentityStuckDebug(page);
      return;
    }
    if (!(await isIdentityScreen(page))) {
      if ((await isAuthMethodChooser(page)) || (await isPasskeyScreen(page))) {
        await preferSmsOverPasskey(page);
      }
      return;
    }
    if (await isSignInBlockedBanner(page)) {
      console.log('[uber-login] banner «Não é possível iniciar sessão» — reload auth');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      await dismissUberNoise(page);
      // Uma tentativa de re-preencher após reload (sem recursão profunda)
      const again = await identityInput(page);
      if (await again.isVisible().catch(() => false)) {
        await setIdentityValue(page, username);
        await again.fill(username).catch(() => undefined);
        const v = ((await again.inputValue().catch(() => '')) || '').trim();
        if (v.toLowerCase() === username.toLowerCase()) {
          await waitContinueEnabled(page, 5_000);
          await clickContinue(page);
        }
      }
      await page.waitForTimeout(1200);
      continue;
    }
    attempt += 1;
    // Confirmar email antes de cada retry Continuar
    const cur = ((await (await identityInput(page)).inputValue().catch(() => '')) || '').trim();
    if (cur.toLowerCase() !== username.toLowerCase()) {
      await setIdentityValue(page, username);
    }
    if (attempt === 2 || attempt === 5) {
      await setIdentityValue(page, username);
      await waitContinueEnabled(page, 3_000);
      const ok = ((await (await identityInput(page)).inputValue().catch(() => '')) || '').trim();
      if (ok.toLowerCase() === username.toLowerCase()) {
        await clickContinue(page, { force: true });
      }
    } else if (attempt === 3) {
      await identity.press('Enter').catch(() => undefined);
    } else if (attempt === 4) {
      await page
        .evaluate(
          `(() => {
            const el = document.querySelector('#PHONE_NUMBER_or_EMAIL_ADDRESS');
            if (!el || !(el.value || '').trim()) return;
            const form = el && el.closest('form');
            const submitBtn = form && form.querySelector('button[type="submit"]');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.removeAttribute('disabled');
              submitBtn.setAttribute('aria-disabled', 'false');
              submitBtn.click();
              return;
            }
            if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
          })()`
        )
        .catch(() => undefined);
    } else {
      const ok = ((await (await identityInput(page)).inputValue().catch(() => '')) || '').trim();
      if (ok.toLowerCase() === username.toLowerCase()) {
        await clickContinue(page);
      }
    }
    await page.waitForTimeout(900);
  }

  await captureIdentityStuckDebug(page);
}

/**
 * Ecrã pós-email: «Verificar com uma chave de acesso» + «Enviar código por SMS».
 * Preferir SMS (human-in-the-loop fiável) em vez de passkey.
 */
async function isAuthMethodChooser(page: Page): Promise<boolean> {
  if (await page.locator('#alt-action-send-via-sms').isVisible().catch(() => false)) return true;
  return page
    .getByText(/verificar com uma chave|já teve sessão iniciada|gostaria de continuar/i)
    .first()
    .isVisible()
    .catch(() => false);
}

/** Cancela o diálogo nativo «Use your security key» / WebAuthn. */
async function dismissSecurityKeyDialog(page: Page): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(250);
  }
}

/**
 * Bloqueia WebAuthn no contexto para o diálogo «security key» não tapar o SMS.
 * (Passkey deixa de ser automático — o caminho correcto neste ecrã é SMS.)
 */
async function blockWebAuthnForSmsPath(page: Page): Promise<void> {
  await page.context().addInitScript(`(() => {
    const fail = () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
    try {
      if (window.PublicKeyCredential) {
        window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => false;
        if (window.PublicKeyCredential.isConditionalMediationAvailable) {
          window.PublicKeyCredential.isConditionalMediationAvailable = async () => false;
        }
      }
      if (navigator.credentials) {
        navigator.credentials.get = fail;
        navigator.credentials.create = fail;
      }
    } catch (_) {}
  })()`);
  // Também na página actual (initScript só aplica a navegações futuras)
  await page.evaluate(
    `(() => {
      const fail = () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
      try {
        if (window.PublicKeyCredential) {
          window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => false;
        }
        if (navigator.credentials) {
          navigator.credentials.get = fail;
          navigator.credentials.create = fail;
        }
      } catch (_) {}
    })()`
  ).catch(() => undefined);
}

async function preferSmsOverPasskey(page: Page): Promise<boolean> {
  await dismissSecurityKeyDialog(page);

  // Nunca clicar #passkey-login-btn («Continuar com uma chave de acesso»).
  const sms = page
    .locator('#alt-action-send-via-sms')
    .or(page.getByTestId('Enviar código por SMS'))
    .or(page.getByRole('button', { name: /enviar código por sms|send .*sms|text me|enviar sms/i }))
    .or(page.getByRole('link', { name: /enviar código por sms|send .*sms|text me|enviar sms/i }))
    .or(page.getByText(/^enviar código por sms$/i))
    .first();

  if (!(await sms.isVisible().catch(() => false))) {
    // Texto/link sem role button (subtree pode interceptar o botão passkey)
    const smsText = page.getByText(/enviar código por sms/i).first();
    if (!(await smsText.isVisible().catch(() => false))) return false;
    console.log('[uber-login] a clicar texto «Enviar código por SMS»');
    await dismissSecurityKeyDialog(page);
    await smsText.click({ timeout: 10_000, force: true }).catch(() => undefined);
  } else {
    console.log('[uber-login] a escolher «Enviar código por SMS» (não passkey)');
    await dismissSecurityKeyDialog(page);
    await sms.click({ timeout: 10_000, force: true }).catch(() => undefined);
  }

  await page.waitForTimeout(2000);
  await dismissSecurityKeyDialog(page);

  if (await isOtpScreen(page)) return true;
  if (!(await isAuthMethodChooser(page))) return true;

  // Retry com evaluate
  await page.evaluate(
    `(() => {
      const btn = document.querySelector('#alt-action-send-via-sms')
        || [...document.querySelectorAll('button,[data-testid]')].find(el =>
             /enviar código por sms/i.test(el.getAttribute('data-testid') || el.innerText || ''));
      if (!btn) return;
      btn.click();
    })()`
  ).catch(() => undefined);
  await page.waitForTimeout(2500);
  await dismissSecurityKeyDialog(page);

  if (await isOtpScreen(page)) return true;
  if (!(await isAuthMethodChooser(page))) return true;

  console.log('[uber-login] SMS ainda no chooser — o gestor pode clicar «Enviar código por SMS» na janela');
  return false;
}

/**
 * Após OTP: ecrã «Bem-vindo… Verificar com chave» → escolher palavra-passe (não passkey).
 */
export async function preferPasswordLogin(page: Page, password: string): Promise<boolean> {
  await dismissSecurityKeyDialog(page);

  if (await isPasswordScreen(page)) {
    return submitPasswordIfVisible(page, password);
  }

  const pwdBtn = page
    .getByRole('button', {
      name: /iniciar sessão com a palavra-?passe|sign in with (a |your )?password|use (your )?password/i,
    })
    .or(
      page.getByText(/iniciar sessão com a palavra-?passe|sign in with (a |your )?password/i)
    )
    .first();

  if (!(await pwdBtn.isVisible().catch(() => false))) return false;

  console.log('[uber-login] a escolher «Iniciar sessão com a palavra-passe» (após OTP)');
  await pwdBtn.click({ timeout: 10_000, force: true }).catch(() => undefined);
  await page.waitForTimeout(2000);
  await dismissSecurityKeyDialog(page);

  if (await isPasswordScreen(page)) {
    return submitPasswordIfVisible(page, password);
  }

  // Às vezes o clique selecciona e precisa de Seguinte
  const seguinte = page.getByRole('button', { name: /^seguinte$|^next$/i }).first();
  if (await seguinte.isVisible().catch(() => false) && !(await seguinte.isDisabled().catch(() => true))) {
    await seguinte.click({ timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
  }

  if (await isPasswordScreen(page)) {
    return submitPasswordIfVisible(page, password);
  }

  return false;
}

async function isPostOtpPasswordChooser(page: Page): Promise<boolean> {
  return page
    .getByText(/iniciar sessão com a palavra-?passe|bem-vindo\(a\) de novo/i)
    .first()
    .isVisible()
    .catch(() => false);
}

/** «Mais opções» / password / SMS quando o ecrã está ambíguo. */
async function tryAlternateAuthPaths(page: Page): Promise<void> {
  if (await preferSmsOverPasskey(page)) return;

  const labels = [
    /iniciar sessão com a palavra-?passe|sign in with .*password/i,
    /mais opções|more options/i,
    /outra forma|other way|try another/i,
    /palavra-?passe|password|senha/i,
    /código de salvaguarda|backup code|código sms|sms|text message/i,
    /utilizar o código|use (a |the )?code/i,
  ];
  for (const re of labels) {
    const el = page
      .getByRole('button', { name: re })
      .or(page.getByRole('link', { name: re }))
      .or(page.getByText(re))
      .first();
    if (await el.isVisible().catch(() => false)) {
      const text = ((await el.innerText().catch(() => '')) || '').toLowerCase();
      if (/google|apple|facebook|chave de acesso|passkey/.test(text)) continue;
      await el.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      return;
    }
  }
}

async function waitForPostLogin(page: Page): Promise<boolean> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (isSupplierUrl(url) && !isAuthUrl(url)) return true;

    const ready = page.getByText(/tudo pronto/i).first();
    if (await ready.isVisible().catch(() => false)) {
      await clickContinue(page);
      await page.waitForTimeout(1500);
      continue;
    }

    await dismissSecurityKeyDialog(page);
    // Pós-OTP: preferir palavra-passe
    if (await isPostOtpPasswordChooser(page)) {
      const pwdBtn = page
        .getByRole('button', { name: /iniciar sessão com a palavra-?passe|sign in with .*password/i })
        .or(page.getByText(/iniciar sessão com a palavra-?passe/i))
        .first();
      if (await pwdBtn.isVisible().catch(() => false)) {
        await pwdBtn.click({ force: true, timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
      }
    }

    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(800);
  }
  return isSupplierUrl(page.url()) && !isAuthUrl(page.url());
}

async function fillUberOtp(page: Page, code: string): Promise<void> {
  const digits = code.replace(/\D/g, '').slice(0, 4);
  if (digits.length < 4) {
    throw new Error('OTP Uber deve ter 4 dígitos');
  }

  const first = page.locator('#PHONE_SMS_OTP-0').first();
  await first.waitFor({ state: 'visible', timeout: 15_000 });

  // Preferir pin individual (Base Web)
  let filled = 0;
  for (let i = 0; i < 4; i += 1) {
    const box = page.locator(`#PHONE_SMS_OTP-${i}`).first();
    if (await box.isVisible().catch(() => false)) {
      await box.click({ timeout: 3000 });
      await box.fill('');
      await box.type(digits[i]!, { delay: 40 });
      filled += 1;
    }
  }

  if (filled < 4) {
    await first.click();
    await page.keyboard.type(digits, { delay: 50 });
  }

  // Uber muitas vezes avança sozinho após o 4.º dígito → ecrã passkey/password.
  // NÃO usar /continuar/i solto: apanha «Continuar com uma chave de acesso» (#passkey-login-btn).
  await page.waitForTimeout(800);
  if (!(await isOtpScreen(page))) {
    console.log('[uber-login] OTP avançou sem clique Seguinte');
    return;
  }

  const clicked = await clickContinue(page);
  if (!clicked) {
    const exact = page.getByRole('button', { name: /^(seguinte|continuar|next)$/i }).first();
    if (
      (await exact.isVisible().catch(() => false)) &&
      !(await exact.isDisabled().catch(() => true))
    ) {
      await exact.click({ timeout: 8_000 }).catch(() => undefined);
    }
  }
}

type ReportRowSnapshot = {
  name: string;
  type: string | null;
  interval: string | null;
  createdAt: string;
  hasDownload: boolean;
  inProgress: boolean;
};

async function readReportRows(page: Page): Promise<ReportRowSnapshot[]> {
  return page.evaluate(`(() => {
    const rows = [];
    const trs = [...document.querySelectorAll('table tbody tr, [role="row"]')];
    for (const tr of trs) {
      const cells = [...tr.querySelectorAll('td, [role="cell"]')]
        .map((c) => (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean);
      if (cells.length < 2) continue;

      const text = cells.join(' | ');
      let name = cells[0] || '';
      let type = null;
      let interval = null;
      let createdAt = '';

      // Tabela Uber: Nome | Tipo | Intervalo | Frequência | Criado em | Ações
      if (cells.length >= 5 && !/^nome$/i.test(cells[0])) {
        name = cells[0];
        type = cells[1] || null;
        interval = cells[2] || null;
        const freqIdx = cells.findIndex((c) =>
          /manualmente|diariamente|semanalmente|mensalmente|daily|weekly|monthly/i.test(c)
        );
        if (freqIdx >= 0 && cells[freqIdx + 1]) {
          createdAt = cells[freqIdx + 1];
        } else if (cells.length >= 6) {
          createdAt = cells[4] || '';
        } else {
          createdAt = cells[cells.length - 2] || '';
        }
      } else {
        type =
          cells.find((c) =>
            /transação|transacao|pagament|atividade|desempenho|qualidade|tempo/i.test(c)
          ) || null;
        interval =
          cells.find((c) => /\\d{1,2}\\s+de\\s+\\w+.+\\d{1,2}\\s+de\\s+\\w+/i.test(c)) ||
          cells.find((c) =>
            /\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}.+\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}/.test(c)
          ) ||
          cells.find((c) => /\\d{8}\\s*[–-]\\s*\\d{8}/.test(c)) ||
          null;
        createdAt =
          cells.find((c) =>
            /\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\b/i.test(
              c
            )
          ) ||
          cells.find((c) => /\\d{1,2}\\s+de\\s+\\w+\\s+de\\s+\\d{4}/i.test(c)) ||
          cells.find((c) => /\\b\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\b/.test(c)) ||
          '';
      }

      if (
        interval &&
        (/^\\d{8}-\\d{8}/.test(interval) || /^payments_/i.test(interval) || interval === name)
      ) {
        interval =
          cells.find((c) => /\\d{1,2}\\s+de\\s+\\w+.+\\d{1,2}\\s+de\\s+\\w+/i.test(c)) ||
          cells.find((c) =>
            /\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}.+\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}/.test(c)
          ) ||
          null;
      }

      const inProgress = /em curso|in progress|processing|a processar|generating/i.test(text);
      const hasDownload =
        /faça o download|faca o download|\\bdownload\\b/i.test(text) && !inProgress;
      if (!name || /^nome$/i.test(name)) continue;
      rows.push({ name, type, interval, createdAt, hasDownload, inProgress });
    }
    return rows;
  })()`) as Promise<ReportRowSnapshot[]>;
}

async function gotoReports(page: Page): Promise<'ok' | 'expired' | 'failed'> {
  await page.goto(SUPPLIER_HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2000);
  if (isAuthUrl(page.url())) return 'expired';

  const reportsNav = page.getByRole('link', { name: /^relatórios$|^reports$/i }).first();
  if (await reportsNav.isVisible().catch(() => false)) {
    await reportsNav.click({ timeout: 10_000 });
    await page.waitForTimeout(2000);
  } else {
    const orgMatch = page.url().match(/supplier\.uber\.com\/orgs\/([^/]+)/i);
    if (orgMatch?.[1]) {
      await page.goto(`https://supplier.uber.com/orgs/${orgMatch[1]}/reports`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page.waitForTimeout(2000);
    } else {
      return 'failed';
    }
  }

  if (isAuthUrl(page.url())) return 'expired';
  return 'ok';
}

/** Descarregar um relatório existente (por nome) ou o de pagamentos mais recente. */
async function downloadExistingPaymentReport(
  page: Page,
  reportName?: string,
  reportTypeKey: UberReportTypeKey = 'REPORT_TYPE_PAYMENTS_ORDER'
): Promise<{ filename: string; buffer: Buffer } | null> {
  const rows = await readReportRows(page);
  const match = reportName
    ? rows.find((r) => r.name === reportName || r.name.startsWith(reportName.slice(0, 24))) ||
      rows.find((r) => reportName.startsWith(r.name.slice(0, 20)))
    : rows.find((r) => r.hasDownload && reportRowMatchesType(r, reportTypeKey)) ||
      rows.find((r) => r.hasDownload && /payments_order/i.test(r.name)) ||
      rows.find((r) => r.hasDownload && /transa[cç][aã]o de pagamentos?/i.test(r.type || '')) ||
      rows.find((r) => r.hasDownload && /payments/i.test(r.name) && !/driver_activity/i.test(r.name)) ||
      rows.find((r) => r.hasDownload && /pagament|transação|transacao/i.test(r.name)) ||
      rows.find((r) => r.hasDownload);

  if (!match) {
    console.log(
      `[uber-sync] sem relatório existente${reportName ? ` matching=${reportName}` : ''}`
    );
    return null;
  }

  console.log(`[uber-sync] a descarregar relatório existente: ${match.name}`);
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
  const row = page.locator('tr, [role="row"]').filter({ hasText: match.name.slice(0, 20) }).first();
  const dlBtn = row
    .getByRole('button', { name: /faça o download|faca o download|download/i })
    .or(row.getByRole('link', { name: /faça o download|download/i }))
    .or(page.getByRole('button', { name: /faça o download|download/i }).first())
    .first();

  await dlBtn.click({ timeout: 15_000 }).catch(async () => {
    await page.getByRole('button', { name: /faça o download|download/i }).first().click({ timeout: 10_000 });
  });

  const download = await downloadPromise;
  if (!download) return null;
  const filename = download.suggestedFilename() || 'uber-payments.csv';
  const stream = await download.createReadStream();
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return { filename, buffer: Buffer.concat(chunks) };
}

/** Lista pública de relatórios (sessão já autenticada). */
export async function listUberReportsFromSession(page: Page): Promise<UberReportListItem[]> {
  const nav = await gotoReports(page);
  if (nav === 'expired') {
    throw new Error('Sessão Uber expirada — volte a ligar a conta');
  }
  if (nav === 'failed') {
    throw new Error('Não encontrei Relatórios no Supplier');
  }
  const reportsTab = page.getByRole('tab', { name: /^relatórios$|^reports$/i }).first();
  if (await reportsTab.isVisible().catch(() => false)) {
    await reportsTab.click().catch(() => undefined);
    await page.waitForTimeout(800);
  }
  const rows = await readReportRows(page);
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    interval: r.interval,
    createdAt: r.createdAt || null,
    hasDownload: r.hasDownload,
  }));
}

function formatLisbonDateParts(iso: string): {
  day: string;
  month: string;
  year: string;
  hour12: number;
  minute: string;
  ampm: 'AM' | 'PM';
  hour24: string;
} {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const hour24n = Number(parts.hour);
  const ampm: 'AM' | 'PM' = hour24n >= 12 ? 'PM' : 'AM';
  const hour12 = hour24n % 12 === 0 ? 12 : hour24n % 12;
  return {
    day: parts.day,
    month: parts.month,
    year: parts.year,
    hour12,
    minute: parts.minute,
    ampm,
    hour24: parts.hour,
  };
}

/** Painel «Gerar relatório» — âncora estável do DOM Uber (DevTools 2026-07-17). */
function reportGeneratePanel(page: Page) {
  return page.locator('[data-tracking-name="report-management-v2"]').first();
}

function reportGenerateModal(page: Page) {
  // Compat: preferir o tracking name; fallback por Cancelar + texto do formulário
  const byTracking = reportGeneratePanel(page);
  const byForm = page
    .locator('div, aside, section')
    .filter({ hasText: /selecione as opções abaixo para gerar/i })
    .filter({ has: page.getByTestId('generate-report-button') })
    .last();
  return byTracking.or(byForm).first();
}

async function listVisibleActionButtons(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    return [...document.querySelectorAll('button')]
      .filter((b) => {
        const s = window.getComputedStyle(b);
        return s.display !== 'none' && s.visibility !== 'hidden' && b.offsetParent !== null;
      })
      .map((b) => (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 40);
  })()`) as Promise<string[]>;
}

function findGenerateConfirmButton(page: Page) {
  // DevTools: data-testid="generate-report-button" aria-label="Gerar"
  return page
    .getByTestId('generate-report-button')
    .or(page.locator('[data-tracking-name="generate-report-request"]'))
    .or(page.getByRole('button', { name: /^gerar$|^generate$/i }))
    .first();
}

/** Scroll no painel até org + Cancelar/Gerar. */
async function scrollGenerateDrawerToBottom(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const panel =
      document.querySelector('[data-tracking-name="report-management-v2"]') ||
      [...document.querySelectorAll('div')].reverse().find((p) => {
        const t = p.textContent || '';
        return /selecione as opções abaixo para gerar/i.test(t) && /cancelar/i.test(t) && t.length < 20000;
      });
    if (!panel) return false;
    const scrollables = [panel, ...panel.querySelectorAll('*')].filter((el) => {
      try {
        const s = getComputedStyle(el);
        return (
          (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflow === 'auto') &&
          el.scrollHeight > el.clientHeight + 40
        );
      } catch {
        return false;
      }
    });
    for (const el of scrollables) el.scrollTop = el.scrollHeight;
    panel.scrollTop = panel.scrollHeight;
    // Também subir ao topo (fluxo começa por cima)
    return true;
  })()`);
  await page.waitForTimeout(300);
}

async function scrollGenerateDrawerToTop(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const panel = document.querySelector('[data-tracking-name="report-management-v2"]');
    if (!panel) return false;
    const scrollables = [panel, ...panel.querySelectorAll('*')].filter((el) => {
      try {
        const s = getComputedStyle(el);
        return (
          (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflow === 'auto') &&
          el.scrollHeight > el.clientHeight + 40
        );
      } catch {
        return false;
      }
    });
    for (const el of scrollables) el.scrollTop = 0;
    panel.scrollTop = 0;
    return true;
  })()`);
  await page.waitForTimeout(200);
}

async function isGenerateDrawerOpen(page: Page): Promise<boolean> {
  if (await reportGeneratePanel(page).isVisible().catch(() => false)) return true;
  if (await page.getByTestId('generate-report-button').isVisible().catch(() => false)) return true;
  if (await page.locator('[data-tracking-name="generate-report-cancel"]').isVisible().catch(() => false)) {
    return true;
  }
  return page.getByText(/selecione as opções abaixo para gerar/i).first().isVisible().catch(() => false);
}

async function openGenerateDrawer(page: Page): Promise<void> {
  if (await isGenerateDrawerOpen(page)) {
    console.log('[uber-sync] painel Gerar já aberto');
    return;
  }
  const gerarBtn = page
    .getByRole('button', { name: /^gerar relatório$|^generate report$/i })
    .first();
  await gerarBtn.waitFor({ state: 'visible', timeout: 20_000 });
  await gerarBtn.click({ timeout: 10_000 });
  console.log('[uber-sync] cliquei «Gerar relatório»');
  await reportGeneratePanel(page).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(300);
    if (await isGenerateDrawerOpen(page)) {
      console.log(`[uber-sync] painel Gerar aberto (${(i + 1) * 300}ms)`);
      return;
    }
  }
  throw new Error('Sync Uber: não abri o painel «Gerar relatório».');
}

function isUberReportTypeSelected(reportTypeKey: UberReportTypeKey, text: string, value = ''): boolean {
  return uberReportTypeOptionMatches(reportTypeKey, value, text);
}

async function isReportTypeSelected(page: Page, reportTypeKey: UberReportTypeKey): Promise<boolean> {
  const panel = reportGeneratePanel(page);
  if (
    await panel
      .locator(`[value="${reportTypeKey}"]`)
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return true;
  }
  const selectedText = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-tracking-name="report-management-v2"]');
    if (!panel) return '';
    const select =
      panel.querySelector('label[for="report-type"]')?.parentElement?.querySelector('[data-baseweb="select"]') ||
      panel.querySelector('[data-baseweb="select"]');
    if (!select) return '';
    const val = select.getAttribute('value') || select.querySelector('[value]')?.getAttribute('value') || '';
    const t = (select.textContent || '').replace(/\\s+/g, ' ').trim();
    return JSON.stringify({ t, val });
  })()`);
  try {
    const parsed = JSON.parse(String(selectedText || '{}')) as { t?: string; val?: string };
    return isUberReportTypeSelected(reportTypeKey, parsed.t || '', parsed.val || '');
  } catch {
    return false;
  }
}

async function listOpenReportTypeOptions(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const nodes = [
      ...document.querySelectorAll('[role="option"], [data-baseweb="menu"] li, [data-baseweb="popover"] li, li[role="option"]'),
    ];
    return nodes
      .map((n) => {
        const val = n.getAttribute('value') || '';
        const t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
        return val ? \`\${t} [\${val}]\` : t;
      })
      .filter(Boolean)
      .slice(0, 80);
  })()`) as Promise<string[]>;
}

async function clickReportTypeOption(page: Page, reportTypeKey: UberReportTypeKey): Promise<string | null> {
  const key = JSON.stringify(reportTypeKey);
  return page.evaluate(`(() => {
    const reportTypeKey = ${key};
    const match = (val, t) => {
      if (reportTypeKey === 'REPORT_TYPE_PAYMENTS_ORDER') {
        if (val === 'REPORT_TYPE_PAYMENTS_ORDER') return true;
        if (/^transa[cç][aã]o de pagamentos?$/i.test(t)) return true;
        if (/^payment transactions?$/i.test(t)) return true;
        if (/transa[cç][aã]o/i.test(t) && /pagamento/i.test(t) && !/motorista/i.test(t)) return true;
        return false;
      }
      if (val === 'REPORT_TYPE_PAYMENTS_DRIVER') return true;
      if (/^pagamentos? do?s? motoristas?$/i.test(t)) return true;
      if (/^driver payments?$/i.test(t)) return true;
      if (/pagamento/i.test(t) && /motorista/i.test(t) && !/transa[cç][aã]o/i.test(t)) return true;
      if (/driver/i.test(t) && /payment/i.test(t) && !/order|transaction/i.test(t)) return true;
      return false;
    };
    const nodes = [
      ...document.querySelectorAll('[role="option"], [data-baseweb="menu"] li, [data-baseweb="popover"] li, li, div[value]'),
    ];
    for (const n of nodes) {
      const val = n.getAttribute('value') || '';
      const t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!match(val, t)) continue;
      const target = n.closest('[role="option"]') || n;
      target.scrollIntoView({ block: 'center' });
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.click();
      return t || val;
    }
    return null;
  })()`) as Promise<string | null>;
}

async function dumpUberReportTypeFailure(page: Page): Promise<string> {
  const options = await listOpenReportTypeOptions(page).catch(() => [] as string[]);
  console.log(`[uber-sync] opções tipo visíveis (${options.length}): ${options.slice(0, 40).join(' | ')}`);
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const candidates = [
      path.resolve(process.cwd(), '../../.tmp-uber-report-type'),
      path.resolve(process.cwd(), '.tmp-uber-report-type'),
      '/tmp/tvde-uber-report-type',
    ];
    for (const c of candidates) {
      try {
        await fs.mkdir(c, { recursive: true });
        const file = path.join(c, `type-${Date.now()}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log(`[uber-sync] screenshot tipo: ${file}`);
        break;
      } catch {
        // try next
      }
    }
  } catch (err) {
    console.log('[uber-sync] screenshot tipo falhou:', err instanceof Error ? err.message : err);
  }
  return options.slice(0, 12).join(', ') || '(nenhuma opção listada)';
}

async function selectUberReportType(page: Page, reportTypeKey: UberReportTypeKey): Promise<void> {
  const label = uberReportTypeLabel(reportTypeKey);
  const filterText =
    reportTypeKey === 'REPORT_TYPE_PAYMENTS_ORDER'
      ? 'Transação de pagamentos'
      : 'Pagamentos do motorista';

  if (!(await isGenerateDrawerOpen(page))) await openGenerateDrawer(page);
  await scrollGenerateDrawerToTop(page);

  if (await isReportTypeSelected(page, reportTypeKey)) {
    console.log(`[uber-sync] tipo já «${label}»`);
    return;
  }

  const panel = reportGeneratePanel(page);
  const typeSelect = panel
    .locator('label[for="report-type"]')
    .locator('xpath=following::*[@data-baseweb="select"][1]')
    .or(panel.locator('#report-type').locator('xpath=ancestor::*[@data-baseweb="select"][1]'))
    .or(panel.locator('[data-baseweb="select"]').first())
    .or(panel.getByText(/^atividade do motorista$|^driver activity$/i).first());

  await typeSelect.first().scrollIntoViewIfNeeded().catch(() => undefined);
  await typeSelect.first().click({ timeout: 8000 });
  await page.waitForTimeout(500);

  for (let i = 0; i < 20; i += 1) {
    const n = await page.locator('[role="option"], [data-baseweb="menu"] li').count().catch(() => 0);
    if (n > 0) break;
    await page.waitForTimeout(150);
  }

  const filterInput = page
    .locator('[data-baseweb="popover"] input, [data-baseweb="menu"] input, [role="listbox"] input, input[aria-autocomplete="list"]')
    .first();
  if (await filterInput.isVisible().catch(() => false)) {
    await filterInput.fill(filterText).catch(() => undefined);
    await page.waitForTimeout(400);
    console.log(`[uber-sync] filtrei tipo por «${filterText}»`);
  }

  let opted = await clickReportTypeOption(page, reportTypeKey);
  if (!opted) {
    await page.keyboard.press('End').catch(() => undefined);
    await page.waitForTimeout(120);
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press(i % 8 === 0 ? 'PageDown' : 'ArrowDown').catch(() => undefined);
      await page.waitForTimeout(35);
      opted = await clickReportTypeOption(page, reportTypeKey);
      if (opted) break;
    }
  }

  if (!opted) {
    const roleOpt = page
      .getByRole('option', {
        name:
          reportTypeKey === 'REPORT_TYPE_PAYMENTS_ORDER'
            ? /transa[cç][aã]o de pagamentos?|payment transactions?/i
            : /pagamentos?.*motorista|driver\s*payments?/i,
      })
      .first();
    if (await roleOpt.isVisible().catch(() => false)) {
      await roleOpt.click({ force: true, timeout: 6_000 }).catch(() => undefined);
      opted = 'getByRole';
      console.log('[uber-sync] tipo via getByRole');
    }
  } else {
    console.log(`[uber-sync] tipo DOM: ${opted}`);
  }
  await page.waitForTimeout(600);

  if (!(await isReportTypeSelected(page, reportTypeKey))) {
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForTimeout(400);
  }

  if (!(await isReportTypeSelected(page, reportTypeKey))) {
    const sample = await dumpUberReportTypeFailure(page);
    throw new Error(
      `Sync Uber: não seleccionei «${label}» (${reportTypeKey}). Opções vistas: ${sample}`
    );
  }
  console.log(`[uber-sync] tipo = ${label}`);
}

/** Snap minutos ao slot de 15 min do dropdown Uber (ex.: 1:00 AM, 11:30 PM). */
function snapUberTimeOption(parts: ReturnType<typeof formatLisbonDateParts>): string {
  const minute = Math.round(Number(parts.minute) / 15) * 15;
  const clamped = Math.min(45, Math.max(0, minute));
  const mm = String(clamped).padStart(2, '0');
  return `${parts.hour12}:${mm} ${parts.ampm}`;
}

async function fillCustomReportRange(
  page: Page,
  rangeStart: string,
  rangeEnd: string
): Promise<void> {
  if (!(await isGenerateDrawerOpen(page))) return;
  await scrollGenerateDrawerToTop(page);

  // Começar por cima: abrir o resumo readonly do período (DevTools)
  const periodSummary = page
    .locator('input[placeholder="Selecione o período do relatório"]')
    .or(page.getByPlaceholder(/selecione o período do relatório/i))
    .first();
  if (await periodSummary.isVisible().catch(() => false)) {
    await periodSummary.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    console.log('[uber-sync] abri resumo do período');
  }

  const customTab = page.getByRole('tab', { name: /intervalo personalizado|custom/i }).first();
  if (await customTab.isVisible().catch(() => false)) {
    await customTab.click();
    await page.waitForTimeout(500);
  }

  const start = formatLisbonDateParts(rangeStart);
  const end = formatLisbonDateParts(rangeEnd);
  const startDate = `${start.year}/${start.month}/${start.day}`;
  const endDate = `${end.year}/${end.month}/${end.day}`;
  const startTimeOpt = snapUberTimeOption(start);
  const endTimeOpt = snapUberTimeOption(end);

  const filled = await page.evaluate(
    `(payload) => {
      const panel =
        document.querySelector('[data-tracking-name="report-management-v2"]') ||
        [...document.querySelectorAll('div')].reverse().find((p) =>
          /data de início|intervalo personalizado|selecione as opções abaixo/i.test(p.textContent || '')
        );
      if (!panel) return { ok: false, reason: 'no-panel' };
      const setNative = (el, value) => {
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };
      const inputs = [...panel.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"])')];
      const dateInputs = inputs.filter((el) => {
        if (el.readOnly && /período|periodo|organiz/i.test(el.placeholder || '')) return false;
        const blob = [el.type, el.placeholder, el.getAttribute('aria-label'), el.value].join('|').toLowerCase();
        if (/filiais|organiz|search|hora|time|período|periodo/.test(blob)) return false;
        return /\\d{4}\\/\\d{2}|data|date|yyyy/.test(blob) || /^\\d{4}\\/\\d{2}\\/\\d{2}$/.test(el.value || '') || el.type === 'text' || el.type === 'date';
      });
      let n = 0;
      if (dateInputs[0]) { setNative(dateInputs[0], payload.startDate); n++; }
      if (dateInputs[1]) { setNative(dateInputs[1], payload.endDate); n++; }
      return { ok: n >= 1, n, vals: dateInputs.slice(0, 2).map((e) => e.value) };
    }`,
    { startDate, endDate }
  );
  console.log(`[uber-sync] datas JS: ${JSON.stringify(filled)}`);

  const pickTime = async (nearLabel: RegExp, optionText: string) => {
    const label = page.getByText(nearLabel).first();
    if (!(await label.isVisible().catch(() => false))) return;
    const trigger = label.locator('xpath=following::*[@data-baseweb="select" or @role="combobox"][1]').first();
    await trigger.click({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const opt = page
      .locator('[role="option"], [data-baseweb="menu"] li')
      .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') })
      .first();
    if (await opt.isVisible().catch(() => false)) {
      await opt.click({ timeout: 4000 }).catch(() => undefined);
    } else {
      await page.keyboard.type(optionText, { delay: 20 }).catch(() => undefined);
      await page.keyboard.press('Enter').catch(() => undefined);
    }
    await page.getByText(/selecione as opções abaixo para gerar/i).first().click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  };

  await pickTime(/^data de início$/i, startTimeOpt);
  await pickTime(/^data de fim$/i, endTimeOpt);

  // Fechar o popover do período (voltar ao formulário «de cima»: tipo → período → org → Gerar)
  await page.getByText(/selecione as opções abaixo para gerar/i).first().click({ timeout: 2000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  console.log(`[uber-sync] intervalo ok: ${startDate} ${startTimeOpt} → ${endDate} ${endTimeOpt}`);
}

async function ensureOrganizationSelected(
  page: Page,
  organizationName?: string
): Promise<void> {
  const orgHint = (organizationName || 'CAMINHOS TOLERANTES, LDA').trim();
  console.log(`[uber-sync] organização: ${orgHint}`);

  await scrollGenerateDrawerToBottom(page);

  const orgInput = page
    .locator('input[placeholder="Selecione as organizações a incluir no relatório"]')
    .or(page.getByPlaceholder(/selecione as organizações a incluir/i))
    .first();

  await orgInput.waitFor({ state: 'visible', timeout: 15_000 });
  await orgInput.scrollIntoViewIfNeeded().catch(() => undefined);

  const confirm = findGenerateConfirmButton(page);
  const current = ((await orgInput.inputValue().catch(() => '')) || '').trim();
  if (
    current &&
    /caminhos|tolerantes/i.test(current) &&
    !(await confirm.isDisabled().catch(() => true))
  ) {
    console.log(`[uber-sync] org já no input: ${current}`);
    return;
  }

  const orgNeedle = orgHint.replace(/,.*/, '').trim(); // «CAMINHOS TOLERANTES»
  const orgRe = new RegExp(orgNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await orgInput.click({ timeout: 8000 });
    await page.waitForTimeout(400);

    // Popover «Filiais» (vídeo) — NÃO clicar no header da página
    const filiais = page.getByPlaceholder(/^filiais$/i).or(page.getByPlaceholder(/filiais/i)).first();
    await filiais.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
    if (await filiais.isVisible().catch(() => false)) {
      await filiais.fill('');
      await filiais.fill(orgNeedle);
      await page.waitForTimeout(450);
    }

    const popover = page
      .locator('[data-baseweb="popover"], [data-baseweb="menu"], [role="listbox"]')
      .filter({ hasText: orgRe })
      .last();

    let clicked = false;

    // 1) checkbox acessível (Base Web)
    const roleCb = page.getByRole('checkbox', { name: orgRe }).first();
    if (await roleCb.isVisible().catch(() => false)) {
      const checked = await roleCb.isChecked().catch(() => false);
      if (!checked) {
        await roleCb.click({ force: true, timeout: 5_000 }).catch(() => undefined);
      }
      clicked = true;
      console.log(`[uber-sync] org via role=checkbox (attempt ${attempt + 1})`);
    }

    // 2) data-baseweb=checkbox dentro do popover
    if (!clicked && (await popover.isVisible().catch(() => false))) {
      const bwCb = popover.locator('[data-baseweb="checkbox"]').filter({ hasText: orgRe }).first();
      if (await bwCb.isVisible().catch(() => false)) {
        await bwCb.click({ force: true, timeout: 5_000 }).catch(() => undefined);
        clicked = true;
        console.log(`[uber-sync] org via data-baseweb=checkbox (attempt ${attempt + 1})`);
      }
    }

    // 3) label com o nome
    if (!clicked) {
      const label = page.locator('label').filter({ hasText: orgRe }).last();
      if (await label.isVisible().catch(() => false)) {
        await label.click({ force: true, timeout: 5_000 }).catch(() => undefined);
        clicked = true;
        console.log(`[uber-sync] org via label (attempt ${attempt + 1})`);
      }
    }

    // 4) texto no popover — clicar à esquerda (zona do checkbox)
    if (!clicked) {
      const textOpt = (await popover.isVisible().catch(() => false))
        ? popover.getByText(orgRe).first()
        : page.getByText(orgRe).last();
      await textOpt.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
      await textOpt.scrollIntoViewIfNeeded().catch(() => undefined);
      await textOpt
        .click({ force: true, position: { x: 12, y: 12 }, timeout: 5_000 })
        .catch(async () => {
          await textOpt.click({ force: true, timeout: 5_000 }).catch(() => undefined);
        });
      clicked = true;
      console.log(`[uber-sync] org via texto/checkbox-zone (attempt ${attempt + 1})`);
    }

    // 5) DOM: só dentro do popover Filiais (nunca no header da página)
    await page.evaluate(
      `(needle) => {
        const norm = (s) =>
          String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\\u0300-\\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        const tokens = norm(needle)
          .split(' ')
          .filter((w) => w.length > 2 && w !== 'lda');
        const roots = [
          ...document.querySelectorAll('[data-baseweb="popover"], [data-baseweb="menu"], [role="listbox"]'),
        ].filter((r) => /filiais|caminhos|organiz/i.test(r.textContent || ''));
        const root = roots[roots.length - 1];
        if (!root) return null;
        const candidates = [
          ...root.querySelectorAll('[data-baseweb="checkbox"], label, [role="option"], [role="checkbox"], li'),
        ];
        for (const el of candidates) {
          const t = norm(el.textContent || '');
          if (!tokens.every((w) => t.includes(w))) continue;
          if ((el.textContent || '').trim().length > 90) continue;
          const input = el.querySelector('input[type="checkbox"]') || (el.matches('input') ? el : null);
          const target =
            el.matches('[data-baseweb="checkbox"]') || el.getAttribute('role') === 'checkbox'
              ? el
              : el.querySelector('[data-baseweb="checkbox"], [role="checkbox"]') || el;
          if (input instanceof HTMLInputElement && !input.checked) {
            input.click();
          }
          target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          if (typeof target.click === 'function') target.click();
          return (el.textContent || '').trim().slice(0, 60);
        }
        return null;
      }`,
      orgNeedle
    );

    await page.waitForTimeout(400);

    // Fechar popover só depois de tentar seleccionar
    await page.getByText(/selecione as opções abaixo para gerar/i).first().click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(350);
    await scrollGenerateDrawerToBottom(page);

    const after = ((await orgInput.inputValue().catch(() => '')) || '').trim();
    const enabled = !(await findGenerateConfirmButton(page).isDisabled().catch(() => true));
    console.log(`[uber-sync] org after attempt ${attempt + 1}: value="${after || '(vazio)'}" gerarEnabled=${enabled}`);
    if (after && /caminhos|tolerantes/i.test(after)) return;
    if (enabled) return;
  }

  console.log('[uber-sync] org: não confirmada após tentativas');
}


async function generatePaymentReport(
  page: Page,
  range?: { rangeStart: string; rangeEnd: string },
  organizationName?: string,
  reportTypeKey: UberReportTypeKey = 'REPORT_TYPE_PAYMENTS_ORDER'
): Promise<void> {
  const rangeToUse = range ?? defaultUberReportRange();

  await openGenerateDrawer(page);
  await scrollGenerateDrawerToTop(page);
  await selectUberReportType(page, reportTypeKey);
  await fillCustomReportRange(page, rangeToUse.rangeStart, rangeToUse.rangeEnd);

  if (!(await isGenerateDrawerOpen(page))) {
    throw new Error('Sync Uber: o painel Gerar fechou durante o preenchimento do intervalo.');
  }

  await scrollGenerateDrawerToBottom(page);
  await ensureOrganizationSelected(page, organizationName);
  await scrollGenerateDrawerToBottom(page);

  let confirm = findGenerateConfirmButton(page);
  await confirm.scrollIntoViewIfNeeded().catch(() => undefined);
  await confirm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    confirm = findGenerateConfirmButton(page);
    const disabled = await confirm.isDisabled().catch(() => true);
    if (!disabled && (await confirm.isVisible().catch(() => false))) break;
    console.log(`[uber-sync] «Gerar» disabled/oculto — org tentativa ${attempt + 1}`);
    await ensureOrganizationSelected(page, organizationName);
    await scrollGenerateDrawerToBottom(page);
    await page.waitForTimeout(500);
  }

  if ((await confirm.isDisabled().catch(() => true)) && env.portalRpaUberInteractive) {
    console.log(
      `[uber-sync] INTERACTIVE: marque a org «${organizationName || '…'}» e/ou clique Gerar (até 3 min).`
    );
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      await scrollGenerateDrawerToBottom(page);
      confirm = findGenerateConfirmButton(page);
      if (!(await isGenerateDrawerOpen(page))) {
        console.log('[uber-sync] INTERACTIVE: painel fechou — Gerar feito pelo utilizador');
        return;
      }
      if (!(await confirm.isDisabled().catch(() => true))) break;
    }
  }

  confirm = findGenerateConfirmButton(page);
  await confirm.scrollIntoViewIfNeeded().catch(() => undefined);
  if (await confirm.isDisabled().catch(() => true)) {
    throw new Error(
      `Sync Uber: «Gerar» continua desactivado — organização «${organizationName || '—'}» não ficou no input.`
    );
  }
  await confirm.click({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  console.log('[uber-sync] Gerar (generate-report-button) clicado — poll Criado em');
}

async function closeGenerateDrawerIfOpen(page: Page): Promise<void> {
  if (!(await isGenerateDrawerOpen(page))) return;
  const cancel = page
    .locator('[data-tracking-name="generate-report-cancel"]')
    .or(page.getByRole('button', { name: /^cancelar$|^cancel$/i }))
    .first();
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    return;
  }
  const closeBtn = page.getByRole('button', { name: /^close$|^fechar$/i }).first();
  await closeBtn.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

function reportRowMatchesType(r: ReportRowSnapshot, reportTypeKey: UberReportTypeKey): boolean {
  const blob = `${r.name} ${r.type || ''}`;
  if (/driver_activity/i.test(blob)) return false;
  if (reportTypeKey === 'REPORT_TYPE_PAYMENTS_ORDER') {
    return (
      /payments_order|payments_orde/i.test(r.name) ||
      /transa[cç][aã]o de pag|transacao de pag|payment.?transaction/i.test(blob)
    );
  }
  return (
    /payments_driver/i.test(r.name) ||
    /pagamentos? do?s? motoristas?|driver payments?/i.test(blob)
  );
}

function isPaymentsReportRow(r: ReportRowSnapshot, reportTypeKey?: UberReportTypeKey): boolean {
  if (reportTypeKey) return reportRowMatchesType(r, reportTypeKey);
  return (
    (/payments_order|payments_orde|payments_driver|payments/i.test(r.name) &&
      !/driver_activity/i.test(r.name)) ||
    /pagament/i.test(r.name) ||
    /pagamentos? do?s? motoristas?|transação de pag|transacao de pag|payment.?transaction|driver payments?/i.test(
      r.type || ''
    )
  );
}

async function refreshReportsList(page: Page): Promise<void> {
  // Evitar reload cego (pode falhar / auth). Voltar a Relatórios.
  const reportsTab = page.getByRole('tab', { name: /^relatórios$|^reports$/i }).first();
  if (await reportsTab.isVisible().catch(() => false)) {
    await reportsTab.click().catch(() => undefined);
    await page.waitForTimeout(1200);
    return;
  }
  const orgMatch = page.url().match(/supplier\.uber\.com\/orgs\/([^/]+)/i);
  if (orgMatch?.[1]) {
    await page.goto(`https://supplier.uber.com/orgs/${orgMatch[1]}/reports`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);
    return;
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}

async function downloadReportRowByName(
  page: Page,
  reportName: string
): Promise<{ filename: string; buffer: Buffer } | null> {
  const needle = reportName.slice(0, 28);
  const row = page.locator('tr, [role="row"]').filter({ hasText: needle }).first();
  await row.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);

  const dlBtn = row
    .getByRole('button', { name: /faça o download|faca o download|download/i })
    .or(row.getByRole('link', { name: /faça o download|download/i }))
    .first();

  if (!(await dlBtn.isVisible().catch(() => false))) {
    console.log(`[uber-sync] download: botão ainda não visível para ${needle}`);
    return null;
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 }).catch(() => null);
  await dlBtn.click({ timeout: 15_000 });
  const download = await downloadPromise;
  if (!download) {
    console.log('[uber-sync] download event não disparou');
    return null;
  }
  const filename = download.suggestedFilename() || 'uber-payments.csv';
  const stream = await download.createReadStream();
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return { filename, buffer: Buffer.concat(chunks) };
}

async function pollForNewReportAndDownload(
  page: Page,
  before: ReportRowSnapshot[],
  onProgress?: (msg: string) => void | Promise<void>,
  reportTypeKey: UberReportTypeKey = 'REPORT_TYPE_PAYMENTS_ORDER'
): Promise<{ filename: string; buffer: Buffer } | null> {
  const beforeKeys = new Set(before.map((r) => `${r.name}|${r.createdAt}`));
  const beforeNames = new Set(before.map((r) => r.name));
  const pollIntervalMs = 15_000;
  const maxWaitMs = 12 * 60_000; // Uber «Em curso» pode demorar vários minutos
  const started = Date.now();
  let trackedReportName: string | null = null;

  await closeGenerateDrawerIfOpen(page);
  await page.waitForTimeout(2000);

  const notify = async (msg: string) => {
    console.log(`[uber-sync] ${msg}`);
    await onProgress?.(msg);
  };

  while (Date.now() - started < maxWaitMs) {
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (isAuthUrl(page.url())) return null;

    const rows = await readReportRows(page);
    const newRows = rows.filter(
      (r) =>
        isPaymentsReportRow(r, reportTypeKey) &&
        (!beforeNames.has(r.name) || !beforeKeys.has(`${r.name}|${r.createdAt}`))
    );

    const pendingRow: ReportRowSnapshot | undefined =
      newRows.find((r) => r.inProgress) ||
      rows.find((r) => r.inProgress && isPaymentsReportRow(r, reportTypeKey) && !beforeNames.has(r.name));

    const watchPrefix: string | null = trackedReportName
      ? trackedReportName.slice(0, 24)
      : null;
    let readyRow: ReportRowSnapshot | undefined = newRows.find((r) => r.hasDownload);
    if (!readyRow && watchPrefix) {
      readyRow = rows.find((r) => r.name.startsWith(watchPrefix) && r.hasDownload);
    }

    if (pendingRow) {
      trackedReportName = pendingRow.name;
      await notify(
        `Relatório Uber «Em curso» (${elapsed}s) — à espera de «Faça o download»…`
      );
    } else if (readyRow) {
      trackedReportName = readyRow.name;
      await notify(`A descarregar ${readyRow.name.slice(0, 42)}…`);
      const file = await downloadReportRowByName(page, readyRow.name);
      if (file && file.buffer.length >= 20) return file;
      await notify('Download falhou — a tentar outra vez…');
    } else if (watchPrefix) {
      const still = rows.find((r) => r.name.startsWith(watchPrefix));
      if (still?.hasDownload) {
        await notify(`A descarregar ${still.name.slice(0, 42)}…`);
        const file = await downloadReportRowByName(page, still.name);
        if (file && file.buffer.length >= 20) return file;
      } else {
        await notify(
          `À espera do relatório${still?.inProgress ? ' (Em curso)' : ''}… ${elapsed}s`
        );
      }
    } else {
      await notify(`À espera da linha nova em Relatórios… ${elapsed}s`);
    }

    await page.waitForTimeout(pollIntervalMs);
    await refreshReportsList(page);
  }

  return null;
}

async function isPasskeyScreen(page: Page): Promise<boolean> {
  if (
    await page
      .getByText(
        /passkey|chave de acesso|security key|código QR|scan this QR|verificar com uma chave|continuar com uma chave|passkeys and security|use your security key|não foi possível verificar a sua passkey/i
      )
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return true;
  }
  return page
    .locator('img[alt*="QR" i], img[alt*="qr" i], canvas, [data-testid*="qr" i]')
    .first()
    .isVisible()
    .catch(() => false);
}

/** NÃO abrir passkey automaticamente — neste ecrã o caminho é SMS. */
async function openPasskeyChallengeIfNeeded(page: Page): Promise<void> {
  await preferSmsOverPasskey(page);
  // Não clicar #passkey-login-btn — dispara «Use your security key» e tapa o SMS
}

async function captureChallengeImage(page: Page): Promise<string> {
  await openPasskeyChallengeIfNeeded(page);
  await page.waitForTimeout(800);

  // QR passkey Uber costuma ser canvas ~512×512
  const canvases = page.locator('canvas');
  const count = await canvases.count();
  let best: { idx: number; area: number } | null = null;
  for (let i = 0; i < count; i += 1) {
    const box = await canvases.nth(i).boundingBox().catch(() => null);
    if (!box) continue;
    const area = box.width * box.height;
    if (area >= 200 * 200 && (!best || area > best.area)) best = { idx: i, area };
  }
  if (best) {
    try {
      const buf = await canvases.nth(best.idx).screenshot({ type: 'png' });
      return buf.toString('base64');
    } catch {
      // fallback
    }
  }

  const qr = page
    .locator('img[alt*="QR" i], img[alt*="qr" i], [data-testid*="qr" i]')
    .first();
  try {
    if (await qr.isVisible().catch(() => false)) {
      const buf = await qr.screenshot({ type: 'png' });
      return buf.toString('base64');
    }
  } catch {
    // fallback full page
  }
  const buf = await page.screenshot({ type: 'png', fullPage: false });
  return buf.toString('base64');
}

async function pageAuthDebug(page: Page): Promise<string> {
  const url = page.url();
  const bits: string[] = [`url=${url.slice(0, 120)}`];
  if (await isStuckOnEmptyIdentity(page)) bits.push('stuck=empty_identity');
  if (await isIdentityScreen(page)) {
    bits.push('screen=identity');
    bits.push(await identityFieldDiagnostics(page));
  }
  if (await isBotChallengeSignalRaw(page)) {
    bits.push('signal=bot_iframe');
    bits.push(`handoff=${(await canHandoffBotChallenge(page)) ? 'yes' : 'no'}`);
    bits.push(`visual=${(await isBotChallengeVisuallyReady(page)) ? 'yes' : 'no'}`);
  }
  if (await isBotChallengeScreen(page)) bits.push('screen=bot_challenge');
  if (await isSignInBlockedBanner(page)) bits.push('banner=signin_blocked');
  if (await isAuthMethodChooser(page)) bits.push('screen=chooser');
  if (await isOtpScreen(page)) bits.push('screen=otp');
  if (await isPasswordScreen(page)) bits.push('screen=password');
  if (await isPasskeyScreen(page)) bits.push('screen=passkey');
  if (await page.getByText(/tudo pronto/i).first().isVisible().catch(() => false)) bits.push('screen=ready');
  try {
    const body = ((await page.locator('body').innerText({ timeout: 2000 })) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    if (body) bits.push(`body="${body}"`);
  } catch {
    // ignore
  }
  return bits.join(' ');
}

async function submitPasswordIfVisible(page: Page, password: string): Promise<boolean> {
  if (!(await isPasswordScreen(page))) return false;

  // Esperar o input password (copy PT pode aparecer antes)
  const pass = page.locator('input[type="password"]').first();
  await pass.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => undefined);
  if (!(await pass.isVisible().catch(() => false))) return false;

  console.log('[uber-login] a preencher palavra-passe + Seguinte');
  await pass.click({ timeout: 5000 }).catch(() => undefined);
  await pass.fill('');
  await pass.pressSequentially(password, { delay: 25 }).catch(async () => {
    await pass.fill(password);
  });
  await page.waitForTimeout(500);

  // Preferir «Seguinte» exacto (ecrã pós-OTP PT)
  const seguinte = page
    .getByRole('button', { name: /^(seguinte|continuar|next|entrar|sign in)$/i })
    .first();
  if (await seguinte.isVisible().catch(() => false)) {
    for (let w = 0; w < 16; w += 1) {
      if (!(await seguinte.isDisabled().catch(() => true))) break;
      await page.waitForTimeout(250);
    }
    if (!(await seguinte.isDisabled().catch(() => true))) {
      await seguinte.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      return true;
    }
  }

  const clicked = await clickContinue(page);
  if (!clicked) await pass.press('Enter').catch(() => undefined);
  await page.waitForTimeout(2000);
  return true;
}

/** Espera ecrã pós-identidade (OTP / password / passkey / bot / supplier). */
async function waitForAuthChallenge(
  page: Page,
  timeoutMs = 25_000
): Promise<'connected' | 'otp' | 'password' | 'passkey' | 'identity' | 'bot' | 'unknown'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) return 'connected';
    if (await canHandoffBotChallenge(page)) return 'bot';
    if (await page.getByText(/tudo pronto/i).first().isVisible().catch(() => false)) {
      await clickContinue(page);
      await page.waitForTimeout(1000);
      if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) return 'connected';
    }
    if (await isOtpScreen(page)) return 'otp';
    if (await isPasswordScreen(page)) return 'password';

    // Chooser «Enviar código por SMS» / passkey — preferir SMS
    if ((await isAuthMethodChooser(page)) || (await isPasskeyScreen(page))) {
      if (await preferSmsOverPasskey(page)) {
        await page.waitForTimeout(1500);
        if (await isOtpScreen(page)) return 'otp';
        continue;
      }
      return 'passkey';
    }

    if (await isIdentityScreen(page) || (await isStuckOnEmptyIdentity(page))) {
      await page.waitForTimeout(800);
      continue;
    }
    await page.waitForTimeout(700);
  }
  if (await canHandoffBotChallenge(page)) return 'bot';
  if (await isOtpScreen(page)) return 'otp';
  if (await isPasswordScreen(page)) return 'password';
  if ((await isAuthMethodChooser(page)) || (await isPasskeyScreen(page))) {
    if (await preferSmsOverPasskey(page)) {
      if (await isOtpScreen(page)) return 'otp';
    }
    return 'passkey';
  }
  if (await isIdentityScreen(page) || (await isStuckOnEmptyIdentity(page))) return 'identity';
  return 'unknown';
}

async function botChallengeLoginPhase(page: Page, username?: string): Promise<PortalLoginPhase> {
  // Gate: nunca abrir Desafio Uber com identidade vazia
  if (await isStuckOnEmptyIdentity(page)) {
    if (username?.trim()) {
      console.log('[uber-login] bot phase recusada (email vazio) — a preencher identidade');
      await fillIdentity(page, username.trim());
      if (await canHandoffBotChallenge(page)) {
        // fall through to normal bot wait
      } else if (await isStuckOnEmptyIdentity(page) || (await isIdentityScreen(page))) {
        await captureIdentityStuckDebug(page);
        return {
          status: 'failed',
          message:
            `Login Uber: email não ficou preenchido antes do desafio anti-bot (${await pageAuthDebug(page)}). ` +
            'Tente Ligar conta outra vez.',
        };
      } else {
        // fillIdentity avançou para outro ecrã — o caller trata; devolver unknown via failed? 
        // Melhor: se já não é bot, devolver failed com debug para o automated loop re-entrar
        if (!(await canHandoffBotChallenge(page))) {
          await captureIdentityStuckDebug(page);
          return {
            status: 'failed',
            message:
              `Login Uber: após re-fill do email ainda sem desafio anti-bot pronto (${await pageAuthDebug(page)}).`,
          };
        }
      }
    } else {
      await captureIdentityStuckDebug(page);
      return {
        status: 'failed',
        message:
          `Login Uber: desafio anti-bot detectado com email vazio (${await pageAuthDebug(page)}). ` +
          'Tente Ligar conta outra vez.',
      };
    }
  }

  if (!(await canHandoffBotChallenge(page)) && !(await isBotChallengeSignalRaw(page))) {
    return {
      status: 'failed',
      message: `Login Uber: sem sinal de desafio anti-bot (${await pageAuthDebug(page)}).`,
    };
  }

  await captureIdentityStuckDebug(page);

  // Esperar o overlay Arkose pintar («Proteger a sua conta» / «Iniciar desafio»).
  // Em headless o iframe URL basta para isBotChallengeScreen, mas o JPEG fica na identidade.
  const paintDeadline = Date.now() + 18_000;
  let visual = await isBotChallengeVisuallyReady(page);
  let lastNudgeAt = 0;
  while (!visual && Date.now() < paintDeadline) {
    if (await isStuckOnEmptyIdentity(page)) {
      if (username?.trim()) {
        console.log('[uber-login] bot wait: identidade vazia — re-fill');
        await fillIdentity(page, username.trim()).catch(() => undefined);
      }
      if (await isStuckOnEmptyIdentity(page)) {
        await captureIdentityStuckDebug(page);
        return {
          status: 'failed',
          message:
            `Login Uber: ficou no email vazio durante o desafio anti-bot (${await pageAuthDebug(page)}).`,
        };
      }
    }
    if (Date.now() - lastNudgeAt > 3500) {
      await nudgeBotChallengePaint(page, username);
      lastNudgeAt = Date.now();
    }
    await page.waitForTimeout(500);
    visual = await isBotChallengeVisuallyReady(page);
    if (await canHandoffBotChallenge(page) && visual) break;
  }

  // Ainda sem handoff seguro → não abrir modal Desafio Uber
  if (!(await canHandoffBotChallenge(page))) {
    await captureIdentityStuckDebug(page);
    console.log(
      `[uber-login] bot challenge SEM handoff seguro — ${await pageAuthDebug(page)}`
    );
    if (await isIdentityScreen(page) || (await isStuckOnEmptyIdentity(page))) {
      return {
        status: 'failed',
        message:
          `Login Uber: Continuar não avançou para o desafio anti-bot (${await pageAuthDebug(page)}). ` +
          'Verifique o email da conta e tente Ligar conta outra vez.',
      };
    }
    return {
      status: 'failed',
      message:
        `Login Uber: desafio anti-bot sem paint/UI clara (${await pageAuthDebug(page)}). ` +
        'Confirme PORTAL_RPA_UBER_HEADED_CONNECT + DISPLAY e tente outra vez.',
    };
  }

  if (visual) {
    await tryClickStartChallenge(page);
    await page.waitForTimeout(800);
  } else {
    console.log(
      `[uber-login] bot challenge SEM paint visual após espera — ${await pageAuthDebug(page)} ` +
        '(headed+Xvfb recomendado: PORTAL_RPA_UBER_HEADED_CONNECT + DISPLAY)'
    );
    await nudgeBotChallengePaint(page, username);
    await page.waitForTimeout(1200);
  }

  const img = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false }).then((b) =>
    b.toString('base64')
  );
  const ready = await isBotChallengeVisuallyReady(page);
  console.log(
    `[uber-login] bot challenge visual=${ready} handoff=yes ${await pageAuthDebug(page)}`
  );
  return {
    status: 'awaiting_passkey',
    kind: 'bot',
    hint: ready
      ? 'Uber pediu desafio anti-bot («Proteger a sua conta»). Resolva o desafio na janela «Desafio Uber» do dashboard; ' +
        'depois o fluxo continua (SMS/OTP ou password).'
      : 'A carregar o desafio anti-bot Uber… Se continuar a ver o ecrã de email, aguarde ou cancele e tente Ligar conta outra vez.',
    challengeImageBase64: img,
    storageState: await captureStorageState(page.context()),
  };
}

/** Usado pelo watcher do job enquanto o gestor digitaliza o passkey / resolve Arkose. */
export async function inspectUberLiveAuth(
  page: Page,
  password?: string
): Promise<'connected' | 'otp' | 'passkey' | 'password' | 'bot' | 'identity' | 'unknown'> {
  if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) return 'connected';
  if (await page.getByText(/tudo pronto/i).first().isVisible().catch(() => false)) {
    await clickContinue(page);
    await page.waitForTimeout(1200);
    if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) return 'connected';
  }
  // SMS / password têm prioridade sobre iframe Arkose residual
  if (await isOtpScreen(page)) return 'otp';
  if (await isPasswordScreen(page)) return 'password';
  // Identidade vazia / erro — NÃO reportar bot (evita OTP pendente falso)
  if (await isStuckOnEmptyIdentity(page) || (await isIdentityScreen(page))) {
    if (await canHandoffBotChallenge(page)) return 'bot';
    return 'identity';
  }
  if (await canHandoffBotChallenge(page)) return 'bot';
  if (await isBotChallengeVisuallyReady(page)) return 'bot';

  // Pós-OTP: palavra-passe em vez de chave de acesso
  if (password && (await isPostOtpPasswordChooser(page))) {
    await preferPasswordLogin(page, password);
    if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) return 'connected';
    if (await isPasswordScreen(page)) return 'password';
  }

  // No chooser inicial, insistir em SMS
  if (await isAuthMethodChooser(page)) {
    await preferSmsOverPasskey(page);
    if (await isOtpScreen(page)) return 'otp';
    return 'passkey';
  }
  if (await isPasskeyScreen(page)) {
    if (password) await preferPasswordLogin(page, password);
    return 'passkey';
  }
  // Sinal iframe sem handoff = ainda a montar / identidade
  if (await isBotChallengeSignalRaw(page)) return 'identity';
  return 'unknown';
}

export const uberAdapter: PortalAdapter = {
  portal: 'uber',

  async login(page, username, password): Promise<PortalLoginPhase> {
    try {
      if (!password?.trim()) {
        return {
          status: 'failed',
          message: 'Password Uber em falta — no modal Ligar conta preencha email e password.',
        };
      }

      if (env.portalRpaUberInteractive) {
        return interactiveUberLogin(page, username, password);
      }

      return automatedUberLogin(page, username, password);
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : 'Falha no login Uber' };
    }
  },

  async submitOtp(page, code): Promise<PortalLoginPhase> {
    try {
      await fillUberOtp(page, code);
      await page.waitForTimeout(2000);

      const otpError = page.locator('#PHONE_SMS_OTP-error, [data-testid="otp-error"]').first();
      if (await otpError.isVisible().catch(() => false)) {
        const msg = ((await otpError.textContent()) || '').trim();
        if (msg) return { status: 'failed', message: msg };
      }

      if (await isOtpScreen(page)) {
        return { status: 'failed', message: 'OTP Uber inválido ou expirado' };
      }

      // Pós-OTP: «Iniciar sessão com a palavra-passe» (não chave de acesso).
      // Password é preenchida em continueOtpJob / submitPortalPassword (não aqui).
      await dismissSecurityKeyDialog(page);
      if (await isPostOtpPasswordChooser(page) || (await isPasskeyScreen(page))) {
        const pwdBtn = page
          .getByRole('button', { name: /iniciar sessão com a palavra-?passe|sign in with .*password/i })
          .or(page.getByText(/iniciar sessão com a palavra-?passe/i))
          .first();
        if (await pwdBtn.isVisible().catch(() => false)) {
          console.log('[uber-login] pós-OTP → escolher palavra-passe');
          await pwdBtn.click({ force: true, timeout: 10_000 }).catch(() => undefined);
          await page.waitForTimeout(2000);
        }
      }

      // Curto: OTP → password costuma ser imediato. NÃO bloquear 45s em waitForPostLogin
      // (isso deixava o modal «A validar…» preso enquanto o Chromium já pedia password).
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) {
          return { status: 'connected', storageState: await captureStorageState(page.context()) };
        }
        const ready = page.getByText(/tudo pronto/i).first();
        if (await ready.isVisible().catch(() => false)) {
          await clickContinue(page);
          await page.waitForTimeout(1200);
          continue;
        }
        if (await isPasswordScreen(page)) {
          console.log('[uber-login] pós-OTP → ecrã palavra-passe (awaiting_password)');
          return {
            status: 'awaiting_password',
            hint: 'OTP OK — introduza a password Uber.',
            storageState: await captureStorageState(page.context()),
          };
        }
        if (await isOtpScreen(page)) {
          return { status: 'failed', message: 'OTP Uber inválido ou expirado' };
        }
        await dismissSecurityKeyDialog(page);
        if (await isPostOtpPasswordChooser(page) || (await isPasskeyScreen(page))) {
          const pwdBtn = page
            .getByRole('button', { name: /iniciar sessão com a palavra-?passe|sign in with .*password/i })
            .or(page.getByText(/iniciar sessão com a palavra-?passe/i))
            .first();
          if (await pwdBtn.isVisible().catch(() => false)) {
            await pwdBtn.click({ force: true, timeout: 8000 }).catch(() => undefined);
          }
        }
        await page.waitForTimeout(600);
      }

      if (await isPasswordScreen(page)) {
        return {
          status: 'awaiting_password',
          hint: 'OTP OK — introduza a password Uber.',
          storageState: await captureStorageState(page.context()),
        };
      }
      if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) {
        return { status: 'connected', storageState: await captureStorageState(page.context()) };
      }

      return {
        status: 'failed',
        message:
          'OTP aceite mas não entrou no Supplier. Escolha «Iniciar sessão com a palavra-passe» na janela Chromium.',
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Falha ao submeter OTP Uber';
      if (/passkey-login-btn|chave de acesso|intercepts pointer/i.test(raw)) {
        return {
          status: 'failed',
          message:
            'Login Uber: após o OTP o portal pediu chave de acesso. Não use passkey — Ligar conta outra vez e escolha «Enviar código por SMS», depois a password.',
        };
      }
      return { status: 'failed', message: raw };
    }
  },

  async sync(_context, page, options?: PortalSyncOptions): Promise<PortalSyncPhase> {
    try {
      const nav = await gotoReports(page);
      if (nav === 'expired') {
        return { status: 'expired', message: 'Sessão Uber expirada — volte a ligar a conta' };
      }
      if (nav === 'failed') {
        return {
          status: 'failed',
          message: 'Não encontrei Relatórios no Supplier. Confirme a org e a sessão.',
        };
      }

      const reportsTab = page.getByRole('tab', { name: /^relatórios$|^reports$/i }).first();
      if (await reportsTab.isVisible().catch(() => false)) {
        await reportsTab.click().catch(() => undefined);
        await page.waitForTimeout(800);
      }

      const before = await readReportRows(page);
      console.log(`[uber-sync] snapshot rows=${before.length}`);

      const uberSync: UberSyncOptions | undefined = options?.uberSync;
      const mode = uberSync?.mode ?? 'existing';
      const reportTypeKey = resolveUberReportType(uberSync?.reportTypeKey);

      if (mode === 'existing') {
        const existing = await downloadExistingPaymentReport(
          page,
          uberSync?.reportName,
          reportTypeKey
        );
        if (existing && existing.buffer.length >= 20) {
          return {
            status: 'ok',
            files: [existing],
            warnings: [
              uberSync?.reportName
                ? `Sync: download «${uberSync.reportName.slice(0, 48)}»`
                : `Sync: download de relatório existente (${uberReportTypeLabel(reportTypeKey)})`,
            ],
          };
        }
        if (uberSync?.reportName) {
          return {
            status: 'failed',
            message: `Não encontrei o relatório «${uberSync.reportName}» com download disponível.`,
          };
        }
        // Sem opção explícita / sem lista: fallback gerar com default Mon–Sun
        console.log('[uber-sync] sem existente — fallback gerar intervalo default');
      }

      const range =
        mode === 'generate' && uberSync?.rangeStart && uberSync?.rangeEnd
          ? { rangeStart: uberSync.rangeStart, rangeEnd: uberSync.rangeEnd }
          : defaultUberReportRange();

      await generatePaymentReport(page, range, uberSync?.organizationName, reportTypeKey);
      console.log('[uber-sync] relatório pedido — a iniciar poll Criado em / Em curso');
      await options?.onProgress?.('Relatório pedido — à espera de «Em curso» → download…');

      const file = await pollForNewReportAndDownload(page, before, options?.onProgress, reportTypeKey);
      if (!file) {
        if (isAuthUrl(page.url())) {
          return { status: 'expired', message: 'Sessão Uber expirada durante o sync' };
        }
        return {
          status: 'failed',
          message:
            'Relatório Uber pedido, mas «Faça o download» não apareceu a tempo (até ~12 min com Em curso). Quando o portal terminar, use Descarregar seleccionado ou volte a Gerar.',
        };
      }

      if (file.buffer.length < 20) {
        return { status: 'failed', message: 'Download Uber vazio' };
      }

      return {
        status: 'ok',
        files: [file],
        warnings: [
          `ficheiro=${file.filename}`,
          `Sync Relatórios: ${uberReportTypeLabel(reportTypeKey)} (${range.rangeStart.slice(0, 16)} → ${range.rangeEnd.slice(0, 16)})`,
        ],
      };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : 'Sync Uber falhou' };
    }
  },

  async refresh(_context, page): Promise<'ok' | 'expired'> {
    await page.goto(SUPPLIER_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1500);
    if (isAuthUrl(page.url())) return 'expired';
    if (isSupplierUrl(page.url())) return 'ok';
    return 'expired';
  },
};

/**
 * Login interactivo: Chromium visível — o gestor clica Continuar / SMS / OTP na janela.
 * O RPA só pré-preenche email/password e espera chegar ao Supplier.
 */
async function interactiveUberLogin(
  page: Page,
  username: string,
  password: string
): Promise<PortalLoginPhase> {
  console.log(
    '[uber-login] MODO INTERACTIVO — SMS (não passkey). Cancel security key → Enviar código por SMS'
  );

  // Evitar o popup «Use your security key» a tapar o botão SMS
  await blockWebAuthnForSmsPath(page);

  await ensureAuthLanding(page);

  if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) {
    return { status: 'connected', storageState: await captureStorageState(page.context()) };
  }

  // Pré-preencher o que for possível (não falhar se Continuar não avançar)
  try {
    if (await isPasswordScreen(page)) {
      await submitPasswordIfVisible(page, password);
    } else if (
      (await isIdentityScreen(page)) ||
      (await (await identityInput(page)).isVisible().catch(() => false))
    ) {
      await fillIdentity(page, username);
      if (await isPasswordScreen(page)) {
        await submitPasswordIfVisible(page, password);
      }
    }
  } catch (err) {
    console.log(
      '[uber-login] pré-preenchimento falhou (ok em modo interactivo):',
      err instanceof Error ? err.message : err
    );
  }

  // Assim que aparecer o chooser: Cancel security key + SMS (não passkey)
  await dismissSecurityKeyDialog(page);
  if ((await isAuthMethodChooser(page)) || (await isPasskeyScreen(page))) {
    await preferSmsOverPasskey(page);
  }

  // Arkose: só handoff quando email preenchido + Continuar avançou + sinal bot real.
  // NÃO abrir «Desafio Uber» com identidade vazia (iframe pré-carregado ≠ desafio).
  if (await canHandoffBotChallenge(page)) {
    console.log(
      '[uber-login] desafio anti-bot — handoff para modal Desafio Uber (live stream)'
    );
    return botChallengeLoginPhase(page, username);
  }

  console.log(`[uber-login] à espera… ${await pageAuthDebug(page)}`);
  console.log(
    '[uber-login] Fluxo: SMS → OTP → «Iniciar sessão com a palavra-passe» (não a chave de acesso)'
  );

  const deadline = Date.now() + 9 * 60_000;
  let lastLog = 0;
  while (Date.now() < deadline) {
    if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) {
      console.log('[uber-login] interactivo: entrou no Supplier');
      return { status: 'connected', storageState: await captureStorageState(page.context()) };
    }

    if (await isStuckOnEmptyIdentity(page)) {
      console.log('[uber-login] interactivo: identidade vazia — re-fill');
      await fillIdentity(page, username).catch((err) => {
        console.log('[uber-login] re-fill falhou:', err instanceof Error ? err.message : err);
      });
    }

    // Bot pode aparecer a meio (pós-Continuar lento) — mesmo handoff
    if (await canHandoffBotChallenge(page)) {
      console.log(
        '[uber-login] desafio anti-bot (durante espera) — handoff para modal Desafio Uber'
      );
      return botChallengeLoginPhase(page, username);
    }

    if (await page.getByText(/tudo pronto/i).first().isVisible().catch(() => false)) {
      await clickContinue(page);
      await page.waitForTimeout(1200);
      continue;
    }

    await dismissSecurityKeyDialog(page);

    // Após OTP: «Iniciar sessão com a palavra-passe»
    if (await isPostOtpPasswordChooser(page) || (await isPasskeyScreen(page))) {
      const usedPwd = await preferPasswordLogin(page, password);
      if (usedPwd) {
        await page.waitForTimeout(1500);
        continue;
      }
    }

    // Chooser inicial: SMS
    if (
      (await isAuthMethodChooser(page)) ||
      (await page.locator('#alt-action-send-via-sms').isVisible().catch(() => false))
    ) {
      await preferSmsOverPasskey(page);
    }

    if (await isPasswordScreen(page)) {
      await submitPasswordIfVisible(page, password);
    }

    if (Date.now() - lastLog > 15_000) {
      console.log(`[uber-login] interactivo ainda à espera… ${await pageAuthDebug(page)}`);
      lastLog = Date.now();
      await page.bringToFront().catch(() => undefined);
    }

    await page.waitForTimeout(1500);
  }

  if (await isOtpScreen(page)) {
    return {
      status: 'awaiting_otp',
      otpHint:
        'Introduza o código SMS de 4 dígitos (também pode escrever directamente na janela Chromium).',
      storageState: await captureStorageState(page.context()),
    };
  }

  if ((await isAuthMethodChooser(page)) || (await isPasskeyScreen(page)) || (await isPostOtpPasswordChooser(page))) {
    const img = await page.screenshot({ type: 'png', fullPage: false }).then((b) => b.toString('base64'));
    return {
      status: 'awaiting_passkey',
      hint:
        'Após o OTP escolha «Iniciar sessão com a palavra-passe» (não a chave de acesso). O servidor também tenta automaticamente.',
      challengeImageBase64: img,
      storageState: await captureStorageState(page.context()),
    };
  }

  return {
    status: 'failed',
    message:
      `Login Uber interactivo: timeout (9 min) sem entrar no Supplier (${await pageAuthDebug(page)}). ` +
      'Fluxo: SMS → OTP → Iniciar sessão com a palavra-passe.',
  };
}

async function automatedUberLogin(
  page: Page,
  username: string,
  password: string
): Promise<PortalLoginPhase> {
  // SMS-first: bloquear WebAuthn para não tapar com «security key»
  await blockWebAuthnForSmsPath(page);
  await ensureAuthLanding(page);

  if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) {
    return { status: 'connected', storageState: await captureStorageState(page.context()) };
  }

  // Já no desafio (sessão parcial) — só se handoff seguro; senão preencher email
  if (await canHandoffBotChallenge(page)) {
    return botChallengeLoginPhase(page, username);
  }
  if (await isOtpScreen(page)) {
    return {
      status: 'awaiting_otp',
      otpHint: 'Introduza o código SMS de 4 dígitos da Uber',
      storageState: await captureStorageState(page.context()),
    };
  }
  if ((await isPasskeyScreen(page)) || (await isAuthMethodChooser(page))) {
    await preferSmsOverPasskey(page);
    if (await isOtpScreen(page)) {
      return {
        status: 'awaiting_otp',
        otpHint: 'Introduza o código SMS de 4 dígitos da Uber',
        storageState: await captureStorageState(page.context()),
      };
    }
    await preferPasswordLogin(page, password);
  }
  if (await isPasswordScreen(page)) {
    await submitPasswordIfVisible(page, password);
  } else {
    const onIdentity =
      (await isIdentityScreen(page)) ||
      (await isStuckOnEmptyIdentity(page)) ||
      (await (await identityInput(page)).isVisible().catch(() => false));
    if (onIdentity) {
      await fillIdentity(page, username);
      console.log(`[uber-login] após identidade: ${await pageAuthDebug(page)}`);
    } else if (!(await canHandoffBotChallenge(page))) {
      // Reload único se o form não hidratou
      console.log(`[uber-login] form ausente — reload. ${await pageAuthDebug(page)}`);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      await dismissUberNoise(page);
      if (!(await (await identityInput(page)).isVisible().catch(() => false))) {
        await ensureAuthLanding(page);
      }
      if (isSupplierUrl(page.url()) && !isAuthUrl(page.url())) {
        return { status: 'connected', storageState: await captureStorageState(page.context()) };
      }
      if (await canHandoffBotChallenge(page)) {
        return botChallengeLoginPhase(page, username);
      }
      await fillIdentity(page, username);
      console.log(`[uber-login] após identidade (retry): ${await pageAuthDebug(page)}`);
    }
  }

  if (await canHandoffBotChallenge(page)) {
    return botChallengeLoginPhase(page, username);
  }

  let challenge = await waitForAuthChallenge(page, 20_000);
  console.log(`[uber-login] challenge=${challenge} ${await pageAuthDebug(page)}`);

  if (challenge === 'bot' || (await canHandoffBotChallenge(page))) {
    return botChallengeLoginPhase(page, username);
  }

  // Pós-Continuar: insistir SMS
  if (challenge === 'passkey' || challenge === 'unknown') {
    await preferSmsOverPasskey(page);
    challenge = await waitForAuthChallenge(page, 12_000);
  }

  if (challenge === 'bot' || (await canHandoffBotChallenge(page))) {
    return botChallengeLoginPhase(page, username);
  }

  // Ainda no form identidade (Continuar não avançou) — só então re-submeter
  if (
    (challenge === 'identity' || (await isStuckOnEmptyIdentity(page))) &&
    (await isIdentityScreen(page))
  ) {
    await fillIdentity(page, username);
    challenge = await waitForAuthChallenge(page, 15_000);
    console.log(`[uber-login] retry identidade: challenge=${challenge}`);
  }

  if (challenge === 'bot' || (await canHandoffBotChallenge(page))) {
    return botChallengeLoginPhase(page, username);
  }

  for (let i = 0; i < 12; i += 1) {
    if (challenge === 'connected' || (isSupplierUrl(page.url()) && !isAuthUrl(page.url()))) {
      return { status: 'connected', storageState: await captureStorageState(page.context()) };
    }
    if (challenge === 'bot' || (await canHandoffBotChallenge(page))) {
      return botChallengeLoginPhase(page, username);
    }
    if (challenge === 'otp' || (await isOtpScreen(page))) {
      return {
        status: 'awaiting_otp',
        otpHint: 'Introduza o código SMS de 4 dígitos da Uber',
        storageState: await captureStorageState(page.context()),
      };
    }
    if (challenge === 'passkey' || (await isPasskeyScreen(page)) || (await isAuthMethodChooser(page))) {
      if (await preferSmsOverPasskey(page)) {
        challenge = await waitForAuthChallenge(page, 15_000);
        continue;
      }
      if (await preferPasswordLogin(page, password)) {
        challenge = await waitForAuthChallenge(page, 15_000);
        continue;
      }
      return {
        status: 'awaiting_otp',
        otpHint: 'Introduza o código SMS de 4 dígitos da Uber (Enviar código por SMS no portal).',
        storageState: await captureStorageState(page.context()),
      };
    }
    if (
      challenge === 'password' ||
      (await isPasswordScreen(page)) ||
      (await isPostOtpPasswordChooser(page))
    ) {
      await preferPasswordLogin(page, password);
      console.log(`[uber-login] password submetida: ${await pageAuthDebug(page)}`);
      challenge = await waitForAuthChallenge(page, 15_000);
      continue;
    }

    await tryAlternateAuthPaths(page);
    if (await submitPasswordIfVisible(page, password)) {
      challenge = await waitForAuthChallenge(page, 12_000);
      continue;
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(1000);
    challenge = await waitForAuthChallenge(page, 5_000);
    if (challenge === 'unknown' || challenge === 'identity') break;
  }

  if ((await isAuthMethodChooser(page)) || (await isPasskeyScreen(page))) {
    const img = await captureChallengeImage(page);
    return {
      status: 'awaiting_passkey',
      hint:
        'Uber pede chave de acesso. Se o QR aparecer, digitalize no telemóvel. O botão «Enviar código por SMS» também está no ecrã — o servidor continua a tentar SMS automaticamente.',
      challengeImageBase64: img,
      storageState: await captureStorageState(page.context()),
    };
  }

  if (isAuthUrl(page.url()) && !(await isIdentityScreen(page))) {
    const img = await captureChallengeImage(page);
    console.log(`[uber-login] fallback screenshot (~${img.length} b64) ${await pageAuthDebug(page)}`);
    return {
      status: 'awaiting_passkey',
      hint:
        'Confirme o ecrã Uber abaixo (passkey/QR ou outro desafio). Se pedir SMS a seguir, o modal OTP abre automaticamente.',
      challengeImageBase64: img,
      storageState: await captureStorageState(page.context()),
    };
  }

  if (await isIdentityScreen(page)) {
    await captureIdentityStuckDebug(page);
    return {
      status: 'failed',
      message:
        `Login Uber: o botão Continuar não avançou após o email (${await pageAuthDebug(page)}). ` +
        'Se a Uber mostrar «Proteger a sua conta», o dashboard abre o Desafio Uber (stream live). ' +
        'Caso contrário tente Ligar conta outra vez.',
    };
  }

  return {
    status: 'failed',
    message: `Login Uber sem passkey/OTP/password claros (${await pageAuthDebug(page)}).`,
  };
}