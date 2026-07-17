import type { Page, Locator } from 'playwright';
import type { MyPrioSyncScope } from '@tvde/shared';
import type { PortalAdapter, PortalLoginPhase, PortalSyncOptions, PortalSyncPhase } from './types';
import { captureStorageState } from './types';

/**
 * MyPRIO (Prio) — utilizador numérico + password + OTP SMS (6 dígitos).
 *
 * UI real confirmada (2026-07-16, vídeo):
 * - Login: https://www.myprio.com/MyPrioReactiveTheme/Login
 * - Modal SMS: «Insira o código recebido por SMS» · 6 caixas · ~2 min
 * - Após OTP: toast «Código validado com sucesso» → Home
 * - Home: https://www.myprio.com/MyPrio/HomePage.aspx
 * - Frota: https://www.myprio.com/Transactions/Transactions (+ Exportar) — sync scope=fleet
 * - Electric: …/Transactions?TradIsElectric=True (+ Exportar) — sync scope=electric
 * Syncs são separados: página Eletricidade vs Combustível (mesma conta, um export por job).
 * Nunca usar apex myprio.com — certificado inválido → chrome-error://chromewebdata/.
 */

/**
 * Só www.myprio.com — o apex myprio.com tem certificado inválido
 * (ERR_CERT_COMMON_NAME_INVALID) e o Chromium fica em chrome-error://chromewebdata/.
 */
const LOGIN_URLS = [
  'https://www.myprio.com/MyPrioReactiveTheme/Login',
  'https://www.myprio.com/',
];

const HOME_URLS = ['https://www.myprio.com/MyPrio/HomePage.aspx'];

const TRANSACTIONS_FLEET_URLS = ['https://www.myprio.com/Transactions/Transactions'];

/** Confirmado no portal: TradIsElectric=True (mesmo padrão que Frota, só muda o query). */
const TRANSACTIONS_ELECTRIC_URLS = [
  'https://www.myprio.com/Transactions/Transactions?TradIsElectric=True',
];

async function dismissCookies(page: Page) {
  const candidates = [
    page.locator('#onetrust-accept-btn-handler'),
    page.getByRole('button', { name: /aceitar todos|aceitar|accept all|concordar|ok/i }),
  ];
  for (const btn of candidates) {
    if (await btn.first().isVisible().catch(() => false)) {
      await btn.first().click({ timeout: 3000, force: true }).catch(() => undefined);
      await page.waitForTimeout(300);
      return;
    }
  }
}

async function pageDebug(page: Page): Promise<string> {
  const info = await page
    .evaluate(`(() => {
      const texts = [...document.querySelectorAll('a,button,span,h1,h2,h3,label,p')]
        .map((el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter((t) => t && /sms|código|codigo|otp|login|export|excel|transac|frota|carreg/i.test(t))
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 20);
      return { url: location.href, title: document.title, texts };
    })()`)
    .catch(() => ({ url: page.url(), title: '', texts: [] as string[] }));
  const texts = Array.isArray((info as { texts?: string[] }).texts)
    ? (info as { texts: string[] }).texts.join(' | ')
    : '';
  return `url=${(info as { url?: string }).url || page.url()} · UI=[${texts}]`;
}

/** Popup SMS: o texto «Tempo restante» é único do modal OTP (não confundir com o login). */
function otpTimerLocator(page: Page) {
  return page.getByText(/Tempo restante\s*:/i).first();
}

function otpTitleLocator(page: Page) {
  return page.getByText(/Insira o c[oó]digo recebido por SMS/i).first();
}

async function isSmsOtpVisible(page: Page): Promise<boolean> {
  if (await otpTimerLocator(page).isVisible().catch(() => false)) return true;
  if (await otpTitleLocator(page).isVisible().catch(() => false)) return true;
  return false;
}

/** Descreve inputs candidatos a OTP (para erros de debug). Nunca expõe passwords. */
async function diagnoseOtpInputs(page: Page): Promise<string> {
  const info = await page
    .evaluate(`(() => {
      const inputs = [...document.querySelectorAll('input')].filter((el) => {
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return {
        timer: /Tempo restante/i.test(document.body.innerText || ''),
        title: /Insira o c[oó]digo recebido por SMS/i.test(document.body.innerText || ''),
        toast: /C[oó]digo validado com sucesso/i.test(document.body.innerText || ''),
        inputs: inputs.slice(0, 14).map((el) => {
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          const raw = String(el.value || '');
          const val =
            type === 'password'
              ? raw
                ? '***'
                : ''
              : raw.slice(0, 6);
          return {
            type,
            max: el.getAttribute('maxlength') || '',
            mode: el.getAttribute('inputmode') || '',
            name: el.getAttribute('name') || el.id || '',
            val,
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
          };
        }),
      };
    })()`)
    .catch(() => null);
  if (!info) return 'diagnose=fail';
  const data = info as {
    timer: boolean;
    title: boolean;
    toast: boolean;
    inputs: Array<{ type: string; max: string; mode: string; name: string; val: string; w: number; h: number }>;
  };
  const inputs = data.inputs
    .map((i) => `${i.type}|max=${i.max}|${i.w}x${i.h}|v=${i.val}`)
    .join('; ');
  return `timer=${data.timer} title=${data.title} toast=${data.toast} inputs=[${inputs}]`;
}

function isLoginUrl(url: string): boolean {
  return /\/login|MyPrioReactiveTheme\/Login/i.test(url);
}

/** Password no ecrã de login (não widgets noutras páginas). */
async function hasLoginPasswordField(page: Page): Promise<boolean> {
  if (!isLoginUrl(page.url())) return false;
  const pass = page.locator('input[type="password"]').first();
  return pass.isVisible().catch(() => false);
}

async function sawOtpSuccessToast(page: Page): Promise<boolean> {
  return page
    .getByText(/C[oó]digo validado com sucesso/i)
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Localiza as 6 caixas OTP.
 * MyPRIO real (2026-07-16): `input[type=number]` ~157×48, sem maxlength=1
 * (não confundir com user text 323px / password).
 */
async function locateOtpDigitBoxes(page: Page): Promise<Locator[]> {
  // Preferência: 6 inputs number visíveis (padrão confirmado no portal)
  const numberInputs = page.locator('input[type="number"]:visible');
  const numberCount = await numberInputs.count().catch(() => 0);
  if (numberCount >= 6) {
    const boxes: Locator[] = [];
    for (let i = 0; i < numberCount && boxes.length < 6; i += 1) {
      const el = numberInputs.nth(i);
      const box = await el.boundingBox().catch(() => null);
      // Caixas OTP ~157px; ignorar number fields muito largos (filtros, etc.)
      if (box && box.width > 40 && box.width <= 220 && box.height >= 20 && box.height <= 80) {
        boxes.push(el);
      }
    }
    if (boxes.length >= 6) return boxes.slice(0, 6);
    if (numberCount >= 6) {
      // Fallback: primeiros 6 number visíveis
      return Array.from({ length: 6 }, (_, i) => numberInputs.nth(i));
    }
  }

  const all = page.locator('input:visible');
  const count = await all.count().catch(() => 0);
  const boxes: Locator[] = [];

  for (let i = 0; i < count; i += 1) {
    const el = all.nth(i);
    const type = ((await el.getAttribute('type')) || 'text').toLowerCase();
    if (type === 'password' || type === 'hidden' || type === 'checkbox' || type === 'submit') continue;
    // Login username é text largo — nunca OTP
    if (type === 'text') {
      const maxLen = await el.getAttribute('maxlength');
      if (maxLen !== '1') continue;
    }

    const maxLen = await el.getAttribute('maxlength');
    const box = await el.boundingBox().catch(() => null);
    const isDigitBox =
      maxLen === '1' ||
      type === 'number' ||
      (box != null && box.width > 40 && box.width <= 220 && box.height > 20 && box.height <= 80);

    if (!isDigitBox) continue;
    // Excluir campos de login largos (~323px)
    if (box && box.width > 220) continue;
    boxes.push(el);
    if (boxes.length >= 6) break;
  }

  return boxes;
}

/**
 * Preenche OTP MyPRIO — sem botão Confirmar; valida ao completar o 6.º dígito (vídeo 2026-07-16).
 */
async function fillSmsOtp(page: Page, code: string): Promise<{ ok: boolean; detail: string }> {
  const digits = code.replace(/\D/g, '').slice(0, 6);
  if (digits.length !== 6) return { ok: false, detail: 'código não tem 6 dígitos' };

  // Esperar modal (timer)
  for (let i = 0; i < 10; i += 1) {
    if (await isSmsOtpVisible(page)) break;
    await page.waitForTimeout(300);
  }
  if (!(await isSmsOtpVisible(page))) {
    return { ok: false, detail: `modal SMS não visível · ${await diagnoseOtpInputs(page)}` };
  }

  let boxes = await locateOtpDigitBoxes(page);
  if (boxes.length < 6) {
    // Às vezes o popup anima — retry
    await page.waitForTimeout(800);
    boxes = await locateOtpDigitBoxes(page);
  }
  if (boxes.length < 6) {
    return {
      ok: false,
      detail: `só encontrei ${boxes.length}/6 caixas OTP · ${await diagnoseOtpInputs(page)}`,
    };
  }

  // Estratégia A: dígito a dígito nas 6 caixas type=number (MyPRIO)
  // Importante: NÃO tratar «modal sumiu» a meio dos 6 dígitos como sucesso —
  // o OutSystems re-renderiza e isSmsOtpVisible pode falhar momentaneamente.
  await boxes[0]!.click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(150);
  for (let i = 0; i < 6; i += 1) {
    const digit = digits[i]!;
    const live = await locateOtpDigitBoxes(page);
    const target = live[i] ?? live[live.length - 1] ?? boxes[i]!;
    await target.click({ timeout: 3000 }).catch(() => undefined);
    // type=number: fill é mais fiável que keypress isolado
    await target.fill('').catch(() => undefined);
    await target.fill(digit).catch(async () => {
      await page.keyboard.press(digit, { delay: 40 }).catch(async () => {
        await target.press(digit).catch(() => undefined);
      });
    });
    // Disparar input/change para OutSystems
    await target.dispatchEvent('input').catch(() => undefined);
    await target.dispatchEvent('change').catch(() => undefined);
    await page.waitForTimeout(120);

    if (await sawOtpSuccessToast(page)) {
      return { ok: true, detail: `toast após dígito ${i + 1}/6` };
    }
    // Só após o 6.º dígito o portal valida sozinho
    if (i === 5 && !(await isSmsOtpVisible(page))) {
      return { ok: true, detail: 'modal fechou após 6.º dígito' };
    }
  }

  await page.waitForTimeout(800);
  if (await sawOtpSuccessToast(page)) {
    return { ok: true, detail: 'toast após 6 fills' };
  }
  if (!(await isSmsOtpVisible(page)) && !(await hasLoginPasswordField(page))) {
    return { ok: true, detail: 'modal fechou e saiu do login' };
  }
  if (!(await isSmsOtpVisible(page)) && /HomePage\.aspx|\/MyPrio\/|\/Transactions\//i.test(page.url())) {
    return { ok: true, detail: 'navegou após 6 fills' };
  }

  // Estratégia B: colar/escrever os 6 no 1.º (alguns widgets OutSystems fazem split no OnChange)
  const again = await locateOtpDigitBoxes(page);
  if (again.length >= 1) {
    await again[0]!.click().catch(() => undefined);
    await page.keyboard.press('Meta+A').catch(() => undefined);
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.press('Backspace').catch(() => undefined);
    await page.keyboard.type(digits, { delay: 80 });
    await page.waitForTimeout(1000);
    if (await sawOtpSuccessToast(page)) {
      return { ok: true, detail: 'toast após type sequência' };
    }
    if (!(await isSmsOtpVisible(page)) && !(await hasLoginPasswordField(page))) {
      return { ok: true, detail: 'aceite após type sequência (saiu do login)' };
    }
  }

  // Estratégia C: native setter + input/change em cada caixa
  const joined = await page
    .evaluate(
      `(() => {
        const otpCode = ${JSON.stringify(digits)};
        const candidates = [...document.querySelectorAll('input')].filter((el) => {
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') return false;
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          if (type === 'password' || type === 'hidden') return false;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          // MyPRIO: type=number ~157px; ou maxlength=1
          if (type === 'number' && r.width <= 220) return true;
          const max = el.getAttribute('maxlength');
          return max === '1' || (r.width <= 220 && r.width > 40 && r.height <= 80 && type !== 'text');
        });
        if (candidates.length < 6) return 'count=' + candidates.length;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        for (let i = 0; i < 6; i++) {
          const input = candidates[i];
          setter?.call(input, otpCode[i] || '');
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: otpCode[i] || '', inputType: 'insertText' }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: otpCode[i] || '' }));
        }
        return candidates.slice(0, 6).map((i) => i.value).join('');
      })()`
    )
    .catch((e) => `eval-err:${e instanceof Error ? e.message : String(e)}`);

  await page.waitForTimeout(1200);
  if (await sawOtpSuccessToast(page)) {
    return { ok: true, detail: `toast após evaluate (joined=${joined})` };
  }
  if (!(await isSmsOtpVisible(page)) && !(await hasLoginPasswordField(page))) {
    return { ok: true, detail: `aceite após evaluate (joined=${joined})` };
  }

  return {
    ok: false,
    detail: `fill sem efeito (joined=${joined}) · ${await diagnoseOtpInputs(page)}`,
  };
}

async function otpModalShowsInvalid(page: Page): Promise<boolean> {
  return page
    .getByText(/inv[aá]lido|incorrecto|incorreto|expirad|tente novamente|c[oó]digo errado/i)
    .first()
    .isVisible()
    .catch(() => false);
}

async function stillOnLogin(page: Page): Promise<boolean> {
  if (await isSmsOtpVisible(page)) return true;
  return hasLoginPasswordField(page);
}

async function isChromeErrorPage(page: Page): Promise<boolean> {
  const url = page.url();
  return /chrome-error:|chromewebdata|about:blank|data:text\/html/i.test(url);
}

/** OutSystems grava o id do utilizador no localStorage após login completo. */
async function readOsSessionUserId(page: Page): Promise<string | null> {
  return page
    .evaluate(`(() => {
      try {
        const keys = Object.keys(localStorage);
        const hit = keys.find((k) => /SESSION_USER_ID/i.test(k));
        return hit ? localStorage.getItem(hit) : null;
      } catch (_) {
        return null;
      }
    })()`)
    .catch(() => null) as Promise<string | null>;
}

async function hasAuthenticatedNav(page: Page): Promise<boolean> {
  return page
    .locator('a, button, nav, span, div')
    .filter({
      hasText: /transa[cç][oõ]es de cart[oõ]es|prio frota|prio electric|gest[aã]o de conta|conta corrente/i,
    })
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * OTP toast ≠ sessão pronta. Esperar Home + nav OU SESSION_USER_ID ≠ 0,
 * senão o storageState fica com SESSION_USER_ID=0 e o sync cai em «expirada».
 *
 * Não forçar goto Home logo no 1.º tick — interrompe o redirect OutSystems pós-OTP
 * e pode devolver ao Login sem SESSION_USER_ID.
 */
async function waitUntilAuthenticated(page: Page): Promise<boolean> {
  const homeUrl = 'https://www.myprio.com/MyPrio/HomePage.aspx';
  const t0 = Date.now();

  for (let i = 0; i < 50; i += 1) {
    const url = page.url();
    const elapsed = Date.now() - t0;

    if (/\/Transactions\//i.test(url) && !(await stillOnLogin(page))) {
      await page.waitForTimeout(800);
      console.log(`[myprio-otp] auth-ok via Transactions ${elapsed}ms`);
      return true;
    }

    const onHome = /HomePage\.aspx|\/MyPrio\//i.test(url) && !isLoginUrl(url);
    if (onHome) {
      const uid = await readOsSessionUserId(page);
      const nav = await hasAuthenticatedNav(page);
      if (nav || (uid != null && uid !== '' && uid !== '0')) {
        await page.waitForTimeout(1200);
        const uid2 = await readOsSessionUserId(page);
        if (nav || (uid2 != null && uid2 !== '' && uid2 !== '0')) {
          console.log(`[myprio-otp] auth-ok Home uid=${uid2 ?? uid} nav=${nav} ${elapsed}ms`);
          return true;
        }
      }
    }

    // Toast/splash: dar tempo ao redirect natural (~8s) antes de forçar Home
    if (elapsed >= 8_000 && (i % 5 === 0)) {
      console.log(`[myprio-otp] force-home ${elapsed}ms url=${url.slice(0, 80)}`);
      await gotoWithRetry(page, homeUrl, 2).catch(() => false);
      // Se Home → Login com password, OTP não criou sessão
      if ((await hasLoginPasswordField(page)) && !(await isSmsOtpVisible(page))) {
        console.log(`[myprio-otp] home-redirected-to-login ${Date.now() - t0}ms`);
        return false;
      }
    }

    if ((await isSmsOtpVisible(page)) && elapsed > 25_000) {
      console.log(`[myprio-otp] still-on-sms-modal ${elapsed}ms`);
      break;
    }

    await page.waitForTimeout(500);
  }
  return false;
}

/** Valida storageState já serializado (evitar gravar sessão mid-OTP). */
function storageStateLooksAuthenticated(storageStateJson: string): boolean {
  try {
    const state = JSON.parse(storageStateJson) as {
      cookies?: Array<{ name: string }>;
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    for (const origin of state.origins ?? []) {
      for (const item of origin.localStorage ?? []) {
        if (/SESSION_USER_ID/i.test(item.name) && item.value && item.value !== '0') {
          return true;
        }
      }
    }
    // Fallback fraco: vários cookies + não só os de visita
    const names = new Set((state.cookies ?? []).map((c) => c.name).filter(Boolean));
    if (names.size >= 4 && ![...names].every((n) => /osVisit|osVisitor|nr1Users|nr2Users/i.test(n))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function waitForPostOtpLanding(page: Page): Promise<boolean> {
  // Primeiro: sair do modal / ver toast
  for (let i = 0; i < 40; i += 1) {
    if (await sawOtpSuccessToast(page)) break;
    if (!(await isSmsOtpVisible(page))) break;
    if (/HomePage\.aspx|\/Transactions\//i.test(page.url())) break;
    await page.waitForTimeout(400);
  }
  // Depois: autenticação real (nav / SESSION_USER_ID)
  return waitUntilAuthenticated(page);
}

async function extractOtpHint(page: Page): Promise<string> {
  const body = await page.locator('body').innerText().catch(() => '');
  const phoneMatch = body.match(/enviado para o n[uú]mero\s*:\s*([0-9*]+)/i);
  const phone = phoneMatch?.[1]?.trim();
  if (phone) {
    return `SMS enviado para ${phone}. Introduza o código de 6 dígitos (válido ~2 min).`;
  }
  return 'Introduza o código SMS de 6 dígitos recebido no telemóvel (válido ~2 min).';
}

async function fillLoginForm(page: Page, username: string, password: string): Promise<boolean> {
  const passInput = page.locator('input[type="password"]').first();
  // OutSystems: o form pode demorar a montar após o goto
  await passInput.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => undefined);
  if (!(await passInput.isVisible().catch(() => false))) return false;

  const userInput = page
    .locator(
      [
        'input[name*="user" i]',
        'input[id*="user" i]',
        'input[placeholder*="utilizador" i]',
        'input[placeholder*="user" i]',
        'input[type="text"]',
        'input[type="tel"]',
        'input[type="email"]',
      ].join(', ')
    )
    .first();

  if (!(await userInput.isVisible().catch(() => false))) return false;

  await userInput.click({ force: true }).catch(() => undefined);
  await userInput.fill('');
  await userInput.fill(username, { force: true });
  await passInput.click({ force: true }).catch(() => undefined);
  await passInput.fill('');
  await passInput.fill(password, { force: true });

  const submit = page
    .getByRole('button', { name: /iniciar sess[aã]o|login|entrar|continuar/i })
    .or(page.locator('button[type="submit"]'))
    .first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click({ force: true });
  } else {
    await passInput.press('Enter');
  }
  return true;
}

async function waitAfterLogin(page: Page) {
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null),
    page.waitForTimeout(4500),
  ]);
  await page.waitForTimeout(800);
}

function formatPrioDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Painel Pesquisa: datas + Pesquisar — últimos 15 dias. */
async function setTransactionsDateRange(page: Page) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 15);
  const startStr = formatPrioDate(start);
  const endStr = formatPrioDate(end);
  const short = { timeout: 1_200 } as const;

  // Preferir inputs visíveis (evitar .filter(hasText).last() no DOM OutSystems — muito lento)
  const inputs = page.locator(
    'input[type="text"]:visible, input[type="date"]:visible, input:not([type="hidden"]):visible'
  );
  const count = await inputs.count().catch(() => 0);
  if (count >= 2) {
    await inputs.nth(0).fill(startStr, { force: true, ...short }).catch(() => undefined);
    await inputs.nth(1).fill(endStr, { force: true, ...short }).catch(() => undefined);
  }

  const searchBtn = page
    .getByRole('button', { name: /pesquisar/i })
    .or(page.locator('a, button, span').filter({ hasText: /^\s*Pesquisar\s*$/i }))
    .first();
  if (await searchBtn.isVisible(short).catch(() => false)) {
    await searchBtn.click({ force: true, timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
}

/** Botão Excel: «.XLS EXPORTAR PARA EXCEL» (directo) ou menu Exportar → item Excel. */
async function clickExcelExport(page: Page): Promise<boolean> {
  const short = { timeout: 2_000 } as const;
  const excelItemRe =
    /\.XLS\s*EXPORTAR\s*PARA\s*EXCEL|\.XLSX?\s*EXPORTAR|\.XLS\s*PARA\s*EXCEL|EXPORTAR\s*PARA\s*EXCEL|PARA\s*EXCEL|\.XLSX?\b|Excel/i;

  async function clickVisibleExcelItem(): Promise<boolean> {
    const candidates = page.locator('a, button, span, div, li, label, [role="menuitem"]');
    const count = await candidates.count().catch(() => 0);
    const matched: string[] = [];
    for (let i = 0; i < Math.min(count, 80); i += 1) {
      const el = candidates.nth(i);
      if (!(await el.isVisible({ timeout: 100 }).catch(() => false))) continue;
      const text = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 80) continue;
      if (/colunas para exporta/i.test(text)) continue;
      if (!excelItemRe.test(text)) continue;
      // Preferir itens com XLS / PARA EXCEL; aceitar «Excel» curto no menu
      if (!/\.XLS|PARA\s*EXCEL|Excel/i.test(text)) continue;
      matched.push(text.slice(0, 60));
      await el.click({ force: true, timeout: 3_000 }).catch(() => undefined);
      return true;
    }
    if (matched.length) {
      console.log(`[myprio-sync] export-menu candidates seen but click miss: ${matched.join(' | ')}`);
    }
    return false;
  }

  // 1) Item Excel já visível na toolbar (comum em Electric)
  if (await clickVisibleExcelItem()) {
    console.log('[myprio-sync] export: direct excel item');
    return true;
  }

  // 2) Abrir menu «Exportar»
  const exportBtn = page
    .getByRole('button', { name: /^\s*Exportar\s*$/i })
    .or(page.locator('a, button, span, div').filter({ hasText: /^\s*Exportar\s*$/i }))
    .first();
  if (!(await exportBtn.isVisible(short).catch(() => false))) {
    console.log('[myprio-sync] export: botão Exportar não visível');
    return false;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await exportBtn.click({ force: true, timeout: 2_500 }).catch(() => undefined);
    await page.waitForTimeout(400 + attempt * 300);
    if (await clickVisibleExcelItem()) {
      console.log(`[myprio-sync] export: menu excel (attempt ${attempt + 1})`);
      return true;
    }
  }

  // 3) Diagnóstico: textos próximos de «export»
  const near = await page
    .evaluate(`(() => {
      const nodes = [...document.querySelectorAll('a,button,span,div,li')];
      return nodes
        .map((n) => (n.innerText || '').replace(/\\s+/g, ' ').trim())
        .filter((t) => t && t.length < 70 && /export|xls|excel/i.test(t))
        .slice(0, 12);
    })()`)
    .catch(() => []);
  console.log(`[myprio-sync] export-click-failed near=[${(near as string[]).join(' | ')}]`);
  return false;
}

async function readDownload(
  download: import('playwright').Download,
  fallbackName: string
): Promise<{ filename: string; buffer: Buffer } | null> {
  const filename = download.suggestedFilename() || fallbackName;
  let tempPath: string | null = null;
  try {
    tempPath = await download.path();
    if (tempPath) {
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(tempPath);
      await fs.unlink(tempPath).catch(() => undefined);
      return { filename, buffer };
    }
  } catch {
    /* stream */
  }
  const stream = await download.createReadStream();
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return { filename, buffer: Buffer.concat(chunks) };
}

async function pageTransactionsTitle(page: Page): Promise<string> {
  // timeouts curtos — innerText() default=30s e era o hang após tx-opened
  const locators = [
    page.locator('h1').first(),
    page.locator('h2').first(),
    page.getByText(/transa[cç][oõ]es\s+(frota|electr|eletric|prio)/i).first(),
  ];
  for (const loc of locators) {
    const t = (await loc.innerText({ timeout: 600 }).catch(() => '')).trim();
    if (/transa/i.test(t)) return t.replace(/\s+/g, ' ');
  }
  return '';
}

async function isOnElectricTransactions(page: Page): Promise<boolean> {
  if (await isChromeErrorPage(page)) return false;
  const url = page.url();
  if (/TradIsElectric=True|isElectric=True/i.test(url)) return true;
  const title = await pageTransactionsTitle(page);
  if (/electr|eletric/i.test(title)) return true;
  if (/frota/i.test(title)) return false;
  return false;
}

async function isOnFleetTransactions(page: Page): Promise<boolean> {
  if (await isChromeErrorPage(page)) return false;
  const url = page.url();
  if (/TradIsElectric=True|isElectric=True/i.test(url)) return false;
  const title = await pageTransactionsTitle(page);
  if (/frota/i.test(title)) return true;
  if (/electr|eletric/i.test(title)) return false;
  return /\/Transactions\/Transactions/i.test(url);
}

/** Confirma modo; se a URL já for a certa, não toca no menu nem no título. */
async function switchTransactionsModeIfNeeded(
  page: Page,
  mode: 'electric' | 'fleet'
): Promise<boolean> {
  // URL primeiro (sem DOM lento)
  if (mode === 'electric' && /TradIsElectric=True|isElectric=True/i.test(page.url())) {
    return true;
  }
  if (
    mode === 'fleet' &&
    /\/Transactions\/Transactions/i.test(page.url()) &&
    !/TradIsElectric=True|isElectric=True/i.test(page.url())
  ) {
    return true;
  }

  const ok =
    mode === 'electric'
      ? await isOnElectricTransactions(page)
      : await isOnFleetTransactions(page);
  if (ok) return true;

  const clickOpts = { force: true as const, timeout: 2_000 };

  const parent = page
    .locator('a, span, div, button')
    .filter({ hasText: /transa[cç][oõ]es\s+de\s+cart/i })
    .first();
  if (await parent.isVisible({ timeout: 500 }).catch(() => false)) {
    await parent.click(clickOpts).catch(() => undefined);
    await page.waitForTimeout(250);
  }

  const linkText =
    mode === 'electric' ? /^\s*Prio\s*Electr?ic\s*$/i : /^\s*Prio\s*Frota\s*$/i;
  const link = page.locator('a, span, div, button').filter({ hasText: linkText }).first();
  if (await link.isVisible({ timeout: 500 }).catch(() => false)) {
    await link.click(clickOpts).catch(() => undefined);
    await page.waitForTimeout(600);
  } else {
    const tabText =
      mode === 'electric'
        ? /cart[aã]o\s+prio\s+electr?ic/i
        : /cart[aã]o\s+prio\s+frota/i;
    const tab = page.locator('a, span, div, button, li').filter({ hasText: tabText }).first();
    if (await tab.isVisible({ timeout: 500 }).catch(() => false)) {
      await tab.click(clickOpts).catch(() => undefined);
      await page.waitForTimeout(600);
    }
  }

  if (mode === 'electric') {
    return /TradIsElectric=True|isElectric=True/i.test(page.url()) || (await isOnElectricTransactions(page));
  }
  return (
    (/\/Transactions\/Transactions/i.test(page.url()) &&
      !/TradIsElectric=True|isElectric=True/i.test(page.url())) ||
    (await isOnFleetTransactions(page))
  );
}

type SyncDownloadResult =
  | { status: 'ok'; file: { filename: string; buffer: Buffer } }
  | { status: 'expired' }
  | { status: 'failed' };

function syncLog(scope: string, step: string, startedAt: number) {
  // console.log (não info) — aparece no terminal do npm run dev
  console.log(`[myprio-sync] ${scope} ${step} ${Date.now() - startedAt}ms`);
}

/**
 * Home → menu ou URL → só continua se Exportar estiver visível → datas → Excel.
 */
async function downloadExportFromTransactionsPage(
  page: Page,
  urls: string[],
  fallbackName: string,
  mode: 'electric' | 'fleet'
): Promise<SyncDownloadResult> {
  const t0 = Date.now();
  const exportLocator = () =>
    page
      .locator('a, button, span, div')
      .filter({
        hasText: /\.XLS\s*EXPORTAR\s*PARA\s*EXCEL|EXPORTAR\s*PARA\s*EXCEL|^\s*Exportar\s*$/i,
      })
      .first();

  /** URL sozinha engana (OutSystems) — só ok com Exportar visível. */
  async function waitForExportUi(label: string): Promise<'ok' | 'expired' | 'failed'> {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (await isSessionExpiredUi(page)) {
        syncLog(mode, `${label}:expired`, t0);
        return 'expired';
      }
      if (await exportLocator().isVisible({ timeout: 400 }).catch(() => false)) {
        syncLog(mode, `${label}:export-visible`, t0);
        return 'ok';
      }
      await page.waitForTimeout(350);
    }
    if (await isSessionExpiredUi(page)) {
      syncLog(mode, `${label}:expired-after-wait`, t0);
      return 'expired';
    }
    syncLog(mode, `${label}:no-export`, t0);
    return 'failed';
  }

  // 1) Home
  const home = HOME_URLS[0]!;
  syncLog(mode, 'goto-home', t0);
  const homeOk = await gotoSync(page, home);
  if (!homeOk || (await isChromeErrorPage(page))) {
    syncLog(mode, 'home-chrome-error', t0);
    return { status: 'failed' };
  }
  await dismissCookies(page);
  if (await isSessionExpiredUi(page)) {
    syncLog(mode, 'expired-on-home', t0);
    return { status: 'expired' };
  }
  syncLog(mode, 'home-ok', t0);

  // 2) Menu a partir da Home (fluxo GIF)
  let ui: 'ok' | 'expired' | 'failed' = 'failed';
  syncLog(mode, 'try-menu', t0);
  await switchTransactionsModeIfNeeded(page, mode);
  if (!(await isSessionExpiredUi(page))) {
    ui = await waitForExportUi('menu');
  } else {
    ui = 'expired';
  }

  // 3) Fallback URL
  if (ui === 'failed') {
    for (const url of urls) {
      const kind =
        /TradIsElectric|isElectric/i.test(url) ? 'electric' : 'fleet';
      syncLog(mode, `goto-tx:${kind}:${url.includes('www.') ? 'www' : 'apex'}`, t0);
      const ok = await gotoSync(page, url);
      if (!ok || (await isChromeErrorPage(page))) continue;
      await dismissCookies(page);
      if (await isSessionExpiredUi(page)) {
        syncLog(mode, 'expired-on-tx', t0);
        return { status: 'expired' };
      }
      syncLog(mode, 'tx-opened', t0);
      ui = await waitForExportUi('url');
      if (ui !== 'failed') break;
    }
  }

  if (ui === 'expired') return { status: 'expired' };
  if (ui !== 'ok') {
    syncLog(mode, 'open-failed', t0);
    return { status: 'failed' };
  }
  syncLog(mode, 'mode-ok', t0);

  await setTransactionsDateRange(page);
  syncLog(mode, 'dates-ok', t0);
  if (await isSessionExpiredUi(page)) {
    syncLog(mode, 'expired-after-dates', t0);
    return { status: 'expired' };
  }

  await exportLocator().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => undefined);
  if (!(await exportLocator().isVisible({ timeout: 500 }).catch(() => false))) {
    if (await isSessionExpiredUi(page)) {
      syncLog(mode, 'expired-before-export', t0);
      return { status: 'expired' };
    }
    syncLog(mode, 'export-btn-missing', t0);
    const scraped = await scrapeTransactionsToXlsx(page, mode, t0);
    if (scraped) return scraped;
    return { status: 'failed' };
  }

  // Preferir scrape da grelha HTML (Exportar .XLS muitas vezes inacessível ao RPA)
  const scraped = await scrapeTransactionsToXlsx(page, mode, t0);
  if (scraped) return scraped;
  syncLog(mode, 'dom-scrape-failed-try-excel', t0);

  const downloadPromise = page.waitForEvent('download', { timeout: 18_000 }).catch(() => null);
  if (!(await clickExcelExport(page))) {
    syncLog(mode, 'export-click-failed', t0);
    return { status: 'failed' };
  }

  const download = await downloadPromise;
  if (!download) {
    syncLog(mode, 'download-timeout', t0);
    return { status: 'failed' };
  }

  const file = await readDownload(download, fallbackName);
  if (!file) {
    syncLog(mode, 'download-read-failed', t0);
    return { status: 'failed' };
  }
  syncLog(mode, `ok bytes=${file.buffer.length}`, t0);
  return { status: 'ok', file: { filename: fallbackName, buffer: file.buffer } };
}

/**
 * Lê a grelha HTML Transações (Frota ou Electric), com paginação.
 * Mais fiável que o menu Exportar (.XLS) no Playwright.
 */
async function scrapeTransactionsToXlsx(
  page: Page,
  mode: 'electric' | 'fleet',
  t0: number
): Promise<SyncDownloadResult | null> {
  const header =
    mode === 'electric'
      ? [
          'DATA',
          'Nº. CARTÃO',
          'NOME',
          'ID CARREGAMENTO',
          'POSTO',
          'ENERGIA',
          'DURAÇÃO',
          'TOTAL c/ IVA',
        ]
      : [
          'POSTO',
          'DATA',
          'HORA',
          'CARTÃO',
          'DESC. CARTÃO',
          'LITROS',
          'COMBUSTÍVEL',
          'RECIBO',
          'TOTAL',
        ];

  const allRows: string[][] = [];
  const seen = new Set<string>();

  for (let pageIdx = 0; pageIdx < 20; pageIdx += 1) {
    const pageData = await extractTransactionsTablePage(page, mode);
    if (!pageData.rows.length && pageIdx === 0) {
      syncLog(mode, 'dom-scrape:empty-table', t0);
      return null;
    }

    for (const row of pageData.rows) {
      const key = row.join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      allRows.push(row);
    }

    syncLog(
      mode,
      `dom-scrape:page=${pageIdx + 1} rows=${pageData.rows.length} total=${allRows.length}`,
      t0
    );

    if (!pageData.hasNext) break;

    const nextOk = await goToTransactionsTablePage(page, pageIdx + 2);
    if (!nextOk) break;
    await page.waitForTimeout(700);
  }

  if (!allRows.length) return null;

  const aoa = [header, ...allRows];
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, mode === 'electric' ? 'Electric' : 'Frota');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer);

  syncLog(mode, `dom-scrape:ok rows=${allRows.length} bytes=${buffer.length}`, t0);
  return {
    status: 'ok',
    file: {
      filename: mode === 'electric' ? 'Transacoes_Eletrico_DOM.xlsx' : 'Transacoes_Frota_DOM.xlsx',
      buffer,
    },
  };
}

async function extractTransactionsTablePage(
  page: Page,
  mode: 'electric' | 'fleet'
): Promise<{ rows: string[][]; hasNext: boolean }> {
  return page.evaluate(
    `(() => {
    const mode = ${JSON.stringify(mode)};
    function norm(s) {
      return String(s || '').replace(/\\s+/g, ' ').trim();
    }
    function stripAccents(s) {
      return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    }
    function headerKey(s) {
      return stripAccents(norm(s)).replace(/[./]+/g, ' ').replace(/\\s+/g, ' ').trim();
    }
    function parsePtDateTime(dataRaw) {
      const dataMatch = dataRaw.match(/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})/);
      const timeMatch = dataRaw.match(/(\\d{1,2}):(\\d{2})(?::(\\d{2}))?/);
      let dataIso = '';
      let hora = '';
      if (dataMatch) {
        let d = parseInt(dataMatch[1], 10);
        let m = parseInt(dataMatch[2], 10);
        let y = parseInt(dataMatch[3], 10);
        if (y < 100) y += 2000;
        dataIso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
      if (timeMatch) {
        hora =
          String(timeMatch[1]).padStart(2, '0') +
          ':' +
          timeMatch[2] +
          (timeMatch[3] ? ':' + timeMatch[3] : ':00');
      }
      return { dataIso, hora };
    }

    const tables = [...document.querySelectorAll('table')];
    let best = null;
    for (const table of tables) {
      const headerCells = [...table.querySelectorAll('thead th, tr th')];
      const labels = headerCells.map((c) => headerKey(c.innerText));
      const isFleet =
        labels.some((l) => l === 'posto') &&
        (labels.some((l) => l.includes('litro')) || labels.some((l) => l.startsWith('comb')));
      const isElectric =
        labels.some((l) => l.includes('energia')) ||
        labels.some((l) => l.includes('carregamento')) ||
        (labels.some((l) => l.includes('duracao')) && labels.some((l) => l.includes('total')));
      if (mode === 'fleet' && isFleet) {
        best = { table, labels };
        break;
      }
      if (mode === 'electric' && isElectric) {
        best = { table, labels };
        break;
      }
    }
    if (!best) {
      for (const table of tables) {
        const headerCells = [...table.querySelectorAll('thead th, tr th')];
        if (headerCells.length >= 6) {
          best = { table, labels: headerCells.map((c) => headerKey(c.innerText)) };
          break;
        }
      }
    }
    if (!best) return { rows: [], hasNext: false };

    const labels = best.labels;
    const findIdx = (preds) => {
      for (const pred of preds) {
        const i = labels.findIndex(pred);
        if (i >= 0) return i;
      }
      return -1;
    };

    const idx = {
      // Electric UI: «P. CARREGAMENTO» (= posto); Frota: «POSTO»
      posto: findIdx([
        (l) => l === 'posto',
        (l) => l === 'p carregamento',
        (l) => /^p\\s*carregamento$/.test(l),
        (l) => l.includes('carregamento') && !l.includes('id'),
      ]),
      data: findIdx([(l) => l === 'data']),
      cartao: findIdx([(l) => l.includes('cartao') || l.includes('n cartao')]),
      nome: findIdx([(l) => l === 'nome']),
      litros: findIdx([(l) => l.includes('litro')]),
      comb: findIdx([(l) => l.startsWith('comb') || l.includes('combustivel')]),
      recibo: findIdx([(l) => l.includes('recibo')]),
      energia: findIdx([(l) => l.includes('energia')]),
      duracao: findIdx([(l) => l.includes('duracao')]),
      chargeId: findIdx([
        (l) => l.includes('id carregamento'),
        (l) => l === 'id carregamento',
        (l) => l.startsWith('id ') && l.includes('carreg'),
      ]),
      totalIva: findIdx([
        (l) => l.includes('total c') && l.includes('iva'),
        (l) => l.includes('total') && l.includes('iva'),
      ]),
      total: findIdx([(l) => l === 'total']),
    };

    const bodyRows = [...best.table.querySelectorAll('tbody tr')];
    const rows = [];
    for (const tr of bodyRows) {
      const cells = [...tr.querySelectorAll('td')].map((td) => norm(td.innerText));
      if (cells.length < 4) continue;
      const get = (i) => (i >= 0 && i < cells.length ? cells[i] : '');

      const dataRaw = get(idx.data);
      const { dataIso, hora } = parsePtDateTime(dataRaw);
      const cartaoCell = get(idx.cartao);
      const cardNumMatch = cartaoCell.match(/(PTPRIO\\d+|\\d{10,})/i);
      const cardNumber = cardNumMatch ? cardNumMatch[1] : (cartaoCell.split(/\\s+/)[0] || '');
      const cardDesc = cardNumMatch
        ? cartaoCell.replace(cardNumMatch[1], '').trim()
        : cartaoCell.replace(cardNumber, '').trim();
      const nome = get(idx.nome) || cardDesc;
      const posto = get(idx.posto);
      const totalRaw = (get(idx.totalIva) || get(idx.total)).replace(/€/g, '').trim();

      if (mode === 'fleet') {
        const litros = get(idx.litros).replace(/\\s*L\\s*$/i, '').replace(',', '.');
        const comb = get(idx.comb);
        const recibo = get(idx.recibo);
        if (!posto && !dataIso && !totalRaw) continue;
        rows.push([posto, dataIso, hora, cardNumber, cardDesc || nome, litros, comb, recibo, totalRaw]);
      } else {
        const energia = get(idx.energia).replace(/\\s*kWh\\s*$/i, '').replace(',', '.');
        const duracao = get(idx.duracao).replace(/\\s*min\\.?\\s*$/i, '').trim();
        const chargeId = get(idx.chargeId);
        const dataOut = dataIso ? (hora ? dataIso + ' ' + hora : dataIso) : dataRaw;
        if (!dataOut && !totalRaw) continue;
        rows.push([dataOut, cardNumber, nome, chargeId, posto, energia, duracao, totalRaw]);
      }
    }

    const bodyText = document.body.innerText || '';
    const range = bodyText.match(/(\\d+)\\s*a\\s*(\\d+)\\s*de\\s*(\\d+)\\s*registos/i);
    let hasNext = false;
    if (range) {
      hasNext = parseInt(range[2], 10) < parseInt(range[3], 10);
    } else {
      const active = document.querySelector(
        '[aria-current="page"], .pagination .active, .Pagination .active'
      );
      const activeNum = active ? parseInt(norm(active.textContent), 10) : NaN;
      if (Number.isFinite(activeNum)) {
        hasNext = [...document.querySelectorAll('a, button, span, li')].some(
          (el) => norm(el.textContent) === String(activeNum + 1)
        );
      }
    }

    return { rows, hasNext };
  })()`
  ) as Promise<{ rows: string[][]; hasNext: boolean }>;
}

async function goToTransactionsTablePage(page: Page, pageNumber: number): Promise<boolean> {
  const label = String(pageNumber);
  const candidates = page
    .locator('a, button, span, li')
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 8); i += 1) {
    const el = candidates.nth(i);
    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
    await el.click({ force: true, timeout: 2_000 }).catch(() => undefined);
    return true;
  }
  const next = page
    .locator('a, button, span')
    .filter({ hasText: /^\s*(›|»|>|seguinte|next)\s*$/i })
    .first();
  if (await next.isVisible({ timeout: 400 }).catch(() => false)) {
    await next.click({ force: true, timeout: 2_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

/** goto curto para sync (sem 2ª tentativa longa). */
async function gotoSync(page: Page, url: string): Promise<boolean> {
  if (await isChromeErrorPage(page)) {
    await page.goto('about:blank', { timeout: 5_000 }).catch(() => undefined);
  }
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null);
  if (await isChromeErrorPage(page)) return false;
  if (res && res.status() >= 500) return false;
  return true;
}
async function isAuthenticatedArea(page: Page): Promise<boolean> {
  if (await isChromeErrorPage(page)) return false;
  if (await isSmsOtpVisible(page)) return false;
  if (await hasLoginPasswordField(page)) return false;
  const url = page.url().toLowerCase();
  if (isLoginUrl(url)) return false;
  if (/homepage\.aspx|\/transactions\/|\/myprio\//i.test(url)) return true;

  const hasNav = await page
    .locator('a, button, nav, span')
    .filter({ hasText: /transa[cç][oõ]es|prio frota|prio electric|home|in[ií]cio|exportar/i })
    .first()
    .isVisible()
    .catch(() => false);
  return hasNav;
}

/** Só marcar expirado se estamos claramente no login/OTP. */
async function isSessionExpiredUi(page: Page): Promise<boolean> {
  if (isLoginUrl(page.url())) return true;
  if (await isSmsOtpVisible(page)) return true;
  if (await hasLoginPasswordField(page)) return true;
  return false;
}

async function gotoWithRetry(page: Page, url: string, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await isChromeErrorPage(page)) {
      await page.goto('about:blank', { timeout: 5_000 }).catch(() => undefined);
    }
    const res = await page
      .goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      .catch(() => null);
    await page.waitForTimeout(i === 0 ? 600 : 1_200);
    if (await isChromeErrorPage(page)) {
      if (i < attempts - 1) continue;
      return false;
    }
    if (res && res.status() >= 500) {
      if (i < attempts - 1) continue;
      return false;
    }
    return true;
  }
  return false;
}

export const myprioAdapter: PortalAdapter = {
  portal: 'myprio',

  async login(page, username, password): Promise<PortalLoginPhase> {
    try {
      let filled = false;
      for (const url of LOGIN_URLS) {
        const ok = await gotoWithRetry(page, url);
        if (!ok) continue;
        await dismissCookies(page);

        // Se já estiver no modal OTP (sessão a meio), devolver awaiting_otp
        if (await isSmsOtpVisible(page)) {
          return {
            status: 'awaiting_otp',
            otpHint: await extractOtpHint(page),
            storageState: await captureStorageState(page.context()),
          };
        }

        filled = await fillLoginForm(page, username, password);
        if (filled) break;
      }

      if (!filled) {
        if (await isChromeErrorPage(page)) {
          return {
            status: 'failed',
            message:
              'MyPRIO inacessível (chrome-error / DNS/rede). Confirme que https://www.myprio.com abre no browser deste Mac e tente «Ligar conta» outra vez.',
          };
        }
        return {
          status: 'failed',
          message: `Formulário de login MyPRIO não encontrado. ${await pageDebug(page)}`,
        };
      }

      await waitAfterLogin(page);
      await dismissCookies(page);

      // Esperar o modal SMS (pode demorar 1–3s)
      for (let i = 0; i < 8; i += 1) {
        if (await isSmsOtpVisible(page)) break;
        await page.waitForTimeout(500);
      }

      if (await isSmsOtpVisible(page)) {
        return {
          status: 'awaiting_otp',
          otpHint: await extractOtpHint(page),
          storageState: await captureStorageState(page.context()),
        };
      }

      if (await stillOnLogin(page)) {
        return {
          status: 'failed',
          message: `Login MyPRIO falhou — verifique utilizador/password. ${await pageDebug(page)}`,
        };
      }

      // Contas sem OTP (raro) ou já autenticadas
      return { status: 'connected', storageState: await captureStorageState(page.context()) };
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Falha no login MyPRIO';
      return { status: 'failed', message: raw.split('\n')[0]?.slice(0, 280) || raw };
    }
  },

  async submitOtp(page, code): Promise<PortalLoginPhase> {
    try {
      const digits = code.replace(/\D/g, '').slice(0, 6);
      if (digits.length !== 6) {
        return { status: 'failed', message: 'O código SMS MyPRIO tem de ter exactamente 6 dígitos.' };
      }

      // Garantir que o modal SMS está visível
      for (let i = 0; i < 6; i += 1) {
        if (await isSmsOtpVisible(page)) break;
        await page.waitForTimeout(400);
      }

      if (!(await isSmsOtpVisible(page))) {
        // Já autenticado?
        if (!(await stillOnLogin(page))) {
          return { status: 'connected', storageState: await captureStorageState(page.context()) };
        }
        return {
          status: 'failed',
          message: `Modal SMS OTP não está visível. ${await pageDebug(page)}`,
        };
      }

      const filled = await fillSmsOtp(page, digits);
      console.log(`[myprio-otp] fillSmsOtp ok=${filled.ok} detail=${filled.detail}`);
      if (!filled.ok) {
        return {
          status: 'failed',
          message: `Não consegui preencher o código SMS. ${filled.detail} · ${await pageDebug(page)}`,
        };
      }

      // Sucesso real: toast, Home/Transactions, ou modal fechou SEM voltar ao form de login.
      // «Modal sumiu» com password ainda visível = OTP incompleto / inválido, não autenticado.
      let otpAccepted = false;
      for (let i = 0; i < 35; i += 1) {
        if (await sawOtpSuccessToast(page)) {
          otpAccepted = true;
          console.log('[myprio-otp] saw success toast');
          break;
        }
        if (/HomePage\.aspx|\/MyPrio\/|\/Transactions\//i.test(page.url()) && !isLoginUrl(page.url())) {
          otpAccepted = true;
          console.log(`[myprio-otp] navigated ${page.url().slice(0, 90)}`);
          break;
        }
        if (await otpModalShowsInvalid(page)) {
          return {
            status: 'failed',
            message:
              'OTP inválido ou expirado (o SMS MyPRIO expira em ~2 minutos). Peça novo código: Desligar → Ligar conta.',
          };
        }
        const smsOpen = await isSmsOtpVisible(page);
        if (!smsOpen) {
          if (await hasLoginPasswordField(page)) {
            // Ficou no login — OTP não autenticou
            return {
              status: 'failed',
              message:
                `OTP não autenticou (modal fechou mas continua no Login). fill=${filled.detail}. ` +
                `Código errado/expirado ou preenchimento incompleto — Desligar → Ligar para SMS novo. ` +
                (await pageDebug(page)),
            };
          }
          otpAccepted = true;
          console.log('[myprio-otp] modal closed, left login form');
          break;
        }
        await page.waitForTimeout(400);
      }

      if (!otpAccepted && (await isSmsOtpVisible(page))) {
        return {
          status: 'failed',
          message:
            `OTP não aceite pelo MyPRIO (modal SMS ainda aberto). fill=${filled.detail} · ` +
            `${await diagnoseOtpInputs(page)} · ${await pageDebug(page)}`,
        };
      }

      const landed = await waitForPostOtpLanding(page);
      if (!landed) {
        const stillLogin = await hasLoginPasswordField(page);
        return {
          status: 'failed',
          message: stillLogin
            ? `OTP não criou sessão MyPRIO (continua no Login). fill=${filled.detail}. Desligar → Ligar para SMS novo. ${await pageDebug(page)}`
            : `OTP aceite mas a sessão autenticada MyPRIO não ficou pronta (Home/nav/SESSION_USER_ID). fill=${filled.detail}. ${await pageDebug(page)}`,
        };
      }

      // Capturar cookies/LS só com sessão autenticada
      let storageState = await captureStorageState(page.context());
      if (!storageStateLooksAuthenticated(storageState)) {
        // Mais uma passagem pela Home e re-captura
        await gotoWithRetry(page, 'https://www.myprio.com/MyPrio/HomePage.aspx');
        await page.waitForTimeout(2000);
        storageState = await captureStorageState(page.context());
      }

      if (!storageStateLooksAuthenticated(storageState)) {
        return {
          status: 'failed',
          message:
            'OTP OK mas a sessão gravada ficou incompleta (SESSION_USER_ID=0). ' +
            'Desligar → Ligar conta outra vez e aguarde o loader até ao fim. ' +
            (await pageDebug(page)),
        };
      }

      if (await isSessionExpiredUi(page)) {
        return {
          status: 'failed',
          message: `OTP aceite mas voltei ao login MyPRIO. ${await pageDebug(page)}`,
        };
      }

      return { status: 'connected', storageState };
    } catch (err) {
      return {
        status: 'failed',
        message: err instanceof Error ? err.message : 'Falha ao submeter OTP MyPRIO',
      };
    }
  },

  async sync(_context, page, options?: PortalSyncOptions): Promise<PortalSyncPhase> {
    const scope: MyPrioSyncScope = options?.syncScope ?? 'fleet';
    const scopeLabel = scope === 'electric' ? 'Electric' : 'Combustível (Frota)';
    const t0 = Date.now();

    try {
      // Ir directo às Transações (sem Home / sem waitUntilAuthenticated — isso engolia 30–90s)
      const result =
        scope === 'electric'
          ? await downloadExportFromTransactionsPage(
              page,
              TRANSACTIONS_ELECTRIC_URLS,
              'Transacoes_Eletrico.xlsx',
              'electric'
            )
          : await downloadExportFromTransactionsPage(
              page,
              TRANSACTIONS_FLEET_URLS,
              'Transacoes_Frota.xlsx',
              'fleet'
            );

      syncLog(scope, `sync-done:${result.status}`, t0);

      if (result.status === 'expired') {
        return {
          status: 'expired',
          message:
            `Sessão MyPRIO inválida para Transações (caiu no Login). ` +
            `Desligar → Ligar conta (SMS) e volte a Sincronizar ${scopeLabel}. ` +
            (await pageDebug(page)),
        };
      }

      if (result.status === 'failed') {
        return {
          status: 'failed',
          message:
            `Sync ${scopeLabel}: não li a grelha HTML nem o Excel. ` +
            (scope === 'electric'
              ? 'Use import XLSX na página Eletricidade. '
              : 'Use import XLSX na página Combustível. ') +
            (await pageDebug(page)),
        };
      }

      return { status: 'ok', files: [result.file] };
    } catch (err) {
      syncLog(scope, 'sync-exception', t0);
      return {
        status: 'failed',
        message: err instanceof Error ? err.message : `Sync MyPRIO ${scopeLabel} falhou`,
      };
    }
  },

  async refresh(_context, page): Promise<'ok' | 'expired'> {
    for (const url of HOME_URLS) {
      const ok = await gotoWithRetry(page, url);
      await dismissCookies(page);
      if (!ok || (await isChromeErrorPage(page))) continue;
      if (await isSessionExpiredUi(page)) return 'expired';
      if (await isAuthenticatedArea(page)) return 'ok';
    }
    return 'expired';
  },
};
