import type { Frame, Locator, Page } from 'playwright';
import { PORTAL_DAS_FINANCAS_EMITIR_URL } from '@tvde/shared';
import type { PortalAdapter, PortalLoginPhase, PortalSyncPhase } from './types';
import { captureStorageState } from './types';

const EMITIR_URL = PORTAL_DAS_FINANCAS_EMITIR_URL;

type Scope = Page | Frame;

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.first().isVisible().catch(() => false);
}

async function clickFirst(locator: Locator, timeout = 8_000): Promise<boolean> {
  const el = locator.first();
  if (!(await isVisible(el))) return false;
  await el.click({ timeout, force: true }).catch(() => undefined);
  return true;
}

async function dismissCookies(page: Page) {
  const candidates = [
    page.locator('#onetrust-accept-btn-handler'),
    page.getByRole('button', { name: /aceitar todos|aceitar cookies|aceito|concordar|autorizar/i }),
    page.locator('button, a').filter({ hasText: /^\s*Aceitar(\s+todos)?\s*$/i }),
  ];
  for (const btn of candidates) {
    if (await clickFirst(btn, 2500)) {
      await page.waitForTimeout(400);
      return;
    }
  }
}

function scopes(page: Page): Scope[] {
  return [page, ...page.frames().filter((f) => f !== page.mainFrame())];
}

async function findInScopes(
  page: Page,
  pick: (scope: Scope) => Locator
): Promise<Locator | null> {
  for (const scope of scopes(page)) {
    const loc = pick(scope);
    if (await isVisible(loc)) return loc;
  }
  return null;
}

async function pageHasText(page: Page, pattern: RegExp): Promise<boolean> {
  const body = await page.locator('body').innerText().catch(() => '');
  return pattern.test(body);
}

async function isLoggedInEmitir(page: Page): Promise<boolean> {
  const url = page.url();
  const onRecibos = /irs\.portaldasfinancas\.gov\.pt\/recibos/i.test(url);
  const sair = await findInScopes(page, (s) =>
    s.getByRole('link', { name: /^\s*sair\s*$/i }).or(s.getByRole('button', { name: /^\s*sair\s*$/i }))
  );
  const emitirMenu = await findInScopes(page, (s) =>
    s.getByRole('heading', { name: /^\s*emitir\s*$/i })
  );
  const faturaOpt = await findInScopes(page, (s) =>
    s.getByRole('link', { name: /fatura ou fatura-recibo/i })
  );
  if (onRecibos && (sair || emitirMenu || faturaOpt)) return true;
  if (sair && (await pageHasText(page, /fatura ou fatura-recibo|bom dia,/i))) return true;
  return false;
}

async function isLoginCardVisible(page: Page): Promise<boolean> {
  const nifTab = await findInScopes(page, (s) =>
    s.getByRole('tab', { name: /^\s*NIF\s*$/i }).or(s.locator('[role="tab"]').filter({ hasText: /^\s*NIF\s*$/ }))
  );
  const autenticar = await findInScopes(page, (s) =>
    s.getByRole('button', { name: /^\s*autenticar\s*$/i })
  );
  const escolher = await findInScopes(page, (s) =>
    s.getByText(/escolha a opção de autenticação/i)
  );
  return Boolean(nifTab || autenticar || escolher);
}

async function isHomepageLoginVisible(page: Page): Promise<boolean> {
  if (await isLoginCardVisible(page)) return false;
  const iniciar = await findInScopes(page, (s) =>
    s.getByRole('button', { name: /iniciar sessão/i }).or(s.getByRole('link', { name: /iniciar sessão/i }))
  );
  return Boolean(iniciar);
}

async function clickIniciarSessao(page: Page): Promise<boolean> {
  const loc = await findInScopes(page, (s) =>
    s
      .getByRole('button', { name: /iniciar sessão/i })
      .or(s.getByRole('link', { name: /iniciar sessão/i }))
      .or(s.locator('a, button').filter({ hasText: /^\s*Iniciar Sessão\s*$/i }))
  );
  if (!loc) return false;
  await loc.first().click({ timeout: 8_000, force: true }).catch(() => undefined);
  await page.waitForTimeout(1200);
  return true;
}

async function clickNifTab(page: Page): Promise<boolean> {
  const loc = await findInScopes(page, (s) =>
    s
      .getByRole('tab', { name: /^\s*NIF\s*$/i })
      .or(s.locator('[role="tab"]').filter({ hasText: /^\s*NIF\s*$/ }))
      .or(s.getByRole('button', { name: /^\s*NIF\s*$/i }))
      .or(s.locator('a, button, li, span').filter({ hasText: /^\s*NIF\s*$/ }))
  );
  if (!loc) return false;
  await loc.first().click({ timeout: 8_000, force: true }).catch(() => undefined);
  await page.waitForTimeout(600);
  return true;
}

async function passwordInput(page: Page): Promise<Locator | null> {
  return findInScopes(page, (s) => s.locator('input[type="password"]'));
}

async function nifInput(page: Page): Promise<Locator | null> {
  const named = await findInScopes(page, (s) =>
    s.locator(
      'input[name*="nif" i], input[name*="user" i], input[id*="nif" i], input[id*="user" i], input[autocomplete="username"]'
    )
  );
  if (named) return named;

  for (const scope of scopes(page)) {
    const inputs = scope.locator(
      'input:not([type="password"]):not([type="hidden"]):not([type="search"]):not([type="checkbox"]):not([type="radio"])'
    );
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 12); i += 1) {
      const el = inputs.nth(i);
      if (!(await isVisible(el))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < 80) continue;
      const type = ((await el.getAttribute('type')) || 'text').toLowerCase();
      if (['submit', 'button', 'reset', 'file'].includes(type)) continue;
      return el;
    }
  }
  return null;
}

async function fillCredentials(page: Page, nif: string, password: string): Promise<boolean> {
  const user = await nifInput(page);
  const pass = await passwordInput(page);
  if (!user || !pass) return false;

  await user.click({ force: true }).catch(() => undefined);
  await user.fill('', { force: true }).catch(() => undefined);
  await user.fill(nif, { force: true });
  await user.dispatchEvent('input').catch(() => undefined);
  await user.dispatchEvent('change').catch(() => undefined);

  await pass.click({ force: true }).catch(() => undefined);
  await pass.fill('', { force: true }).catch(() => undefined);
  await pass.fill(password, { force: true });
  await pass.dispatchEvent('input').catch(() => undefined);
  await pass.dispatchEvent('change').catch(() => undefined);
  return true;
}

async function clickAutenticar(page: Page): Promise<boolean> {
  const loc = await findInScopes(page, (s) =>
    s
      .getByRole('button', { name: /^\s*autenticar\s*$/i })
      .or(s.locator('button, input[type="submit"]').filter({ hasText: /^\s*Autenticar\s*$/i }))
  );
  if (loc) {
    await loc.first().click({ timeout: 10_000, force: true }).catch(() => undefined);
    return true;
  }
  const pass = await passwordInput(page);
  if (pass) {
    await pass.first().press('Enter').catch(() => undefined);
    return true;
  }
  return false;
}

async function loginErrorMessage(page: Page): Promise<string | null> {
  const loc = await findInScopes(page, (s) =>
    s.locator('[role="alert"], .error, .alert, .mensagemErro, .validation-error').filter({
      hasText: /nif|senha|password|inválid|incorrect|autentica|credencia/i,
    })
  );
  if (loc) {
    const text = ((await loc.first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 220);
  }
  if (await pageHasText(page, /nif ou senha|dados de autenticação|credenciais (inválid|incorrect)/i)) {
    return 'NIF ou senha rejeitados pela AT';
  }
  return null;
}

async function hasCaptcha(page: Page): Promise<boolean> {
  const frame = page
    .locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i]')
    .first();
  return isVisible(frame);
}

async function gotoEmitir(page: Page) {
  await page.goto(EMITIR_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(900);
  await dismissCookies(page);
}

async function waitForLoggedIn(page: Page, timeoutMs = 35_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedInEmitir(page)) return true;
    await page.waitForTimeout(700);
  }
  return isLoggedInEmitir(page);
}

async function ensureEmitirWhenLoggedIn(page: Page): Promise<boolean> {
  if (await isLoggedInEmitir(page)) {
    if (!/\/recibos\/portal/i.test(page.url())) {
      await gotoEmitir(page);
    }
    return isLoggedInEmitir(page);
  }
  return false;
}

async function completeLogin(page: Page, username: string, password: string): Promise<PortalLoginPhase> {
  const nif = username.replace(/\s+/g, '').trim();
  if (!nif || !password) {
    return { status: 'failed', message: 'NIF e password são obrigatórios' };
  }

  await gotoEmitir(page);

  if (await ensureEmitirWhenLoggedIn(page)) {
    const storageState = await captureStorageState(page.context());
    return { status: 'connected', storageState };
  }

  if (await isHomepageLoginVisible(page)) {
    await clickIniciarSessao(page);
    await page.waitForTimeout(1500);
    await dismissCookies(page);
  }

  const cardReady = await page
    .waitForFunction(
      `(() => {
        const t = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\\s+/g, ' ');
        return /NIF/.test(t) && (/Autenticar|opção de autenticação|AUTENTICAÇÃO\\.GOV/i.test(t) || /CC\\s*\\/\\s*CMD/.test(t));
      })()`,
      { timeout: 20_000 }
    )
    .then(() => true)
    .catch(() => isLoginCardVisible(page));

  if (!cardReady && !(await isLoginCardVisible(page))) {
    if (await isHomepageLoginVisible(page)) {
      await clickIniciarSessao(page);
      await page.waitForTimeout(2000);
    }
    if (!(await isLoginCardVisible(page))) {
      return {
        status: 'failed',
        message: `Ecrã de login AT não ficou pronto (${page.url()}). Tente Ligar conta outra vez.`,
      };
    }
  }

  await clickNifTab(page);

  let pwdReady = false;
  try {
    await page.waitForSelector('input[type="password"]', { timeout: 12_000 });
    pwdReady = true;
  } catch {
    pwdReady = Boolean(await passwordInput(page));
  }

  if (!pwdReady) {
    await clickNifTab(page);
    await page.waitForTimeout(800);
  }

  if (await hasCaptcha(page)) {
    return {
      status: 'failed',
      message: 'A AT pediu CAPTCHA — não é possível ligar automaticamente. Tente mais tarde.',
    };
  }

  const filled = await fillCredentials(page, nif, password);
  if (!filled) {
    return {
      status: 'failed',
      message: 'Campos NIF/password não encontrados no ecrã Autenticar. Clique no separador NIF e tente de novo.',
    };
  }

  await clickAutenticar(page);
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => null),
    page.waitForTimeout(4000),
  ]);
  await page.waitForTimeout(1200);
  await dismissCookies(page);

  if (await waitForLoggedIn(page, 28_000)) {
    if (!/\/recibos\/portal/i.test(page.url())) {
      await gotoEmitir(page);
    }
    if (await isLoggedInEmitir(page)) {
      const storageState = await captureStorageState(page.context());
      return { status: 'connected', storageState };
    }
  }

  const err = await loginErrorMessage(page);
  if (err) return { status: 'failed', message: err };

  if (await isLoginCardVisible(page)) {
    return {
      status: 'failed',
      message: 'Login AT rejeitado — verifique NIF e senha de acesso.',
    };
  }

  await gotoEmitir(page);
  if (await isLoggedInEmitir(page)) {
    const storageState = await captureStorageState(page.context());
    return { status: 'connected', storageState };
  }

  return {
    status: 'failed',
    message: `Login AT não chegou à página Emitir (${page.url()}).`,
  };
}

export const recibosVerdesAdapter: PortalAdapter = {
  portal: 'recibos_verdes',

  async login(page, username, password): Promise<PortalLoginPhase> {
    try {
      const first = await completeLogin(page, username, password);
      if (first.status === 'connected') return first;
      await page.waitForTimeout(800);
      return await completeLogin(page, username, password);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Falha no login AT Recibos Verdes';
      if (/Timeout .* exceeded|net::ERR/i.test(raw)) {
        return {
          status: 'failed',
          message: 'Timeout no login Portal das Finanças. Tente Ligar conta outra vez.',
        };
      }
      return { status: 'failed', message: raw.split('\n')[0]?.slice(0, 280) || raw };
    }
  },

  async submitOtp(): Promise<PortalLoginPhase> {
    return { status: 'failed', message: 'O login NIF da AT não usa OTP neste fluxo' };
  },

  async sync(_context, page): Promise<PortalSyncPhase> {
    try {
      await gotoEmitir(page);
      if (await isLoggedInEmitir(page)) {
        return {
          status: 'ok',
          files: [],
          warnings: ['Sessão AT válida na página Emitir. Importação automática ainda não está disponível — use CSV.'],
        };
      }
      if (await isLoginCardVisible(page) || await isHomepageLoginVisible(page)) {
        return { status: 'expired', message: 'Sessão AT expirada — volte a ligar a conta' };
      }
      return {
        status: 'expired',
        message: `Sessão AT não reconhecida (${page.url()})`,
      };
    } catch (err) {
      return {
        status: 'failed',
        message: err instanceof Error ? err.message : 'Falha a verificar sessão AT',
      };
    }
  },

  async refresh(_context, page): Promise<'ok' | 'expired'> {
    await gotoEmitir(page);
    if (await isLoggedInEmitir(page)) return 'ok';
    return 'expired';
  },
};
