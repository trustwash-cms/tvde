import type { Frame, Locator, Page } from 'playwright';
import { PORTAL_DAS_FINANCAS_EMITIR_URL } from '@tvde/shared';
import type { PortalAdapter, PortalLoginPhase, PortalSyncPhase } from './types';
import { captureStorageState } from './types';

const EMITIR_URL = PORTAL_DAS_FINANCAS_EMITIR_URL;
const EMITIR_FATURA_URL =
  'https://irs.portaldasfinancas.gov.pt/recibos/portal/emitir/emitirfaturaV2';

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
  const frames = page.frames().filter((f) => f !== page.mainFrame());
  return [page, ...frames];
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
    s.getByRole('link', { name: /fatura ou fatura-recibo/i }).or(
      s.locator('a').filter({ hasText: /fatura ou fatura-recibo/i })
    )
  );
  if (onRecibos && (sair || emitirMenu || faturaOpt)) return true;
  if (
    sair &&
    (await pageHasText(page, /fatura ou fatura-recibo|bom dia,|boa tarde,|boa noite,/i))
  ) {
    return true;
  }
  return false;
}

async function isLoginCardVisible(page: Page): Promise<boolean> {
  if (await findInScopes(page, (s) => s.getByText(/escolha a opção de autenticação/i))) {
    return true;
  }
  if (await findInScopes(page, (s) => s.getByRole('button', { name: /autentica(ç|c)ão\.gov/i }))) {
    return true;
  }
  if (await findInScopes(page, (s) => s.getByRole('button', { name: /^\s*autenticar\s*$/i }))) {
    return true;
  }
  return Boolean(
    await findInScopes(page, (s) =>
      s.locator('a,button,li,div,span,[role="tab"]').filter({ hasText: /^\s*NIF\s*$/ })
    )
  );
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

async function passwordInput(page: Page): Promise<Locator | null> {
  for (const scope of scopes(page)) {
    const inputs = scope.locator('input[type="password"]');
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const el = inputs.nth(i);
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 40 && box.height > 8) return el;
    }
  }
  return null;
}

async function autenticarButton(page: Page): Promise<Locator | null> {
  return findInScopes(page, (s) =>
    s
      .getByRole('button', { name: /^\s*autenticar\s*$/i })
      .or(s.locator('button, input[type="submit"]').filter({ hasText: /^\s*Autenticar\s*$/i }))
  );
}

async function stillOnCcCmdTab(page: Page): Promise<boolean> {
  return Boolean(
    await findInScopes(page, (s) =>
      s.getByRole('button', { name: /autentica(ç|c)ão\.gov/i }).or(
        s.locator('button, a').filter({ hasText: /AUTENTICAÇÃO\.GOV/i })
      )
    )
  );
}

/**
 * O ecrã Autenticar abre em «CC / CMD» (só AUTENTICAÇÃO.GOV).
 * É obrigatório clicar no separador «NIF» para aparecerem utilizador + password.
 * Preferir o «NIF» irmão de «CC / CMD» (evita clicar noutros NIF da página).
 */
async function clickNifTabEverywhere(page: Page): Promise<boolean> {
  const clickScript = `(() => {
    const norm = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const isNif = (t) => t === 'NIF' || t === 'N.I.F.';
    const isCc = (t) => /^CC\\s*\\/\\s*CMD$/i.test(t);
    const clickable = (el) => {
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      if (typeof el.click === 'function') el.click();
      return true;
    };

    const nodes = Array.from(
      document.querySelectorAll(
        'a,button,li,div,span,label,[role="tab"],[role="button"],.nav-link,.mat-tab-label,.md-nav-bar md-nav-item'
      )
    );

    // 1) NIF no mesmo contentor que «CC / CMD»
    const cc = nodes.find((el) => isCc(norm(el)));
    if (cc) {
      let root = cc.parentElement;
      for (let i = 0; i < 5 && root; i += 1) {
        const nif = Array.from(root.querySelectorAll('a,button,li,div,span,label,[role="tab"]')).find(
          (el) => isNif(norm(el))
        );
        if (nif) return clickable(nif) ? 'near-cc' : false;
        root = root.parentElement;
      }
      // Irmão seguinte
      let sib = cc.nextElementSibling;
      while (sib) {
        if (isNif(norm(sib)) || Array.from(sib.querySelectorAll('*')).some((el) => isNif(norm(el)))) {
          const target =
            isNif(norm(sib))
              ? sib
              : Array.from(sib.querySelectorAll('a,button,span,div')).find((el) => isNif(norm(el)));
          if (target) return clickable(target) ? 'cc-sibling' : false;
        }
        sib = sib.nextElementSibling;
      }
    }

    // 2) Qualquer nó com texto exacto NIF (mais pequeno primeiro = tab, não bloco)
    const exact = nodes
      .filter((el) => isNif(norm(el)))
      .sort((a, b) => norm(a).length - norm(b).length || a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    if (exact[0]) return clickable(exact[0]) ? 'exact-nif' : false;
    return false;
  })()`;

  for (const frame of [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())]) {
    const result = await frame.evaluate(clickScript).catch(() => false);
    if (result) {
      await page.waitForTimeout(800);
      if ((await passwordInput(page)) || (await autenticarButton(page))) return true;
    }
  }

  const locators = [
    page.getByRole('tab', { name: /^\s*NIF\s*$/ }),
    page.locator('[role="tab"]').filter({ hasText: /^\s*NIF\s*$/ }),
    page.getByText(/^\s*NIF\s*$/, { exact: true }),
    page.locator('a.nav-link, .mat-tab-label, button, li, span').filter({ hasText: /^\s*NIF\s*$/ }),
  ];
  for (const loc of locators) {
    const el = loc.first();
    if (!(await isVisible(el))) continue;
    await el.click({ timeout: 5_000, force: true }).catch(() => undefined);
    await page.waitForTimeout(700);
    if ((await passwordInput(page)) || (await autenticarButton(page))) return true;
  }

  return Boolean((await passwordInput(page)) || (await autenticarButton(page)));
}

async function ensureNifPasswordForm(page: Page): Promise<boolean> {
  if ((await passwordInput(page)) && (await autenticarButton(page))) return true;
  if (await passwordInput(page)) return true;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await clickNifTabEverywhere(page);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const pass = await passwordInput(page);
      const auth = await autenticarButton(page);
      if (pass && auth) return true;
      if (pass) return true;
      if (await stillOnCcCmdTab(page)) {
        await clickNifTabEverywhere(page);
      }
      await page.waitForTimeout(350);
    }
  }
  return Boolean(await passwordInput(page));
}

async function nifInput(page: Page): Promise<Locator | null> {
  const named = await findInScopes(page, (s) =>
    s.locator(
      'input[name*="nif" i], input[name*="user" i], input[id*="nif" i], input[id*="user" i], input[autocomplete="username"]'
    )
  );
  if (named) {
    const box = await named.first().boundingBox().catch(() => null);
    if (box && box.width > 40) return named;
  }

  const pass = await passwordInput(page);
  if (pass) {
    // O NIF é tipicamente o input de texto imediatamente antes da password
    for (const scope of scopes(page)) {
      const pair = scope.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
      const count = await pair.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const el = pair.nth(i);
        const type = ((await el.getAttribute('type')) || 'text').toLowerCase();
        if (type === 'password') {
          if (i === 0) break;
          const prev = pair.nth(i - 1);
          const box = await prev.boundingBox().catch(() => null);
          if (box && box.width > 40) return prev;
          break;
        }
      }
    }
  }

  for (const scope of scopes(page)) {
    const inputs = scope.locator(
      'input:not([type="password"]):not([type="hidden"]):not([type="search"]):not([type="checkbox"]):not([type="radio"])'
    );
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 12); i += 1) {
      const el = inputs.nth(i);
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < 80) continue;
      const type = ((await el.getAttribute('type')) || 'text').toLowerCase();
      if (['submit', 'button', 'reset', 'file'].includes(type)) continue;
      return el;
    }
  }
  return null;
}

/** Preenche inputs Angular/React (setter nativo + eventos). */
async function fillAngularInput(locator: Locator, value: string): Promise<void> {
  const el = locator.first();
  await el.click({ force: true }).catch(() => undefined);
  await el.fill('', { force: true }).catch(() => undefined);
  await el.fill(value, { force: true }).catch(() => undefined);
  await el
    .evaluate(
      `(el, val) => {
        const input = el;
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, val);
        else input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      }`,
      value
    )
    .catch(async () => {
      await el.fill(value, { force: true }).catch(() => undefined);
    });
}

async function fillCredentials(page: Page, nif: string, password: string): Promise<boolean> {
  if (!(await ensureNifPasswordForm(page))) return false;

  let user = await nifInput(page);
  let pass = await passwordInput(page);

  if ((!user || !pass) && page.frames().length) {
    for (const frame of page.frames()) {
      const filled = await frame
        .evaluate(
          `(() => {
            const nif = ${JSON.stringify(nif)};
            const password = ${JSON.stringify(password)};
            const pass = document.querySelector('input[type="password"]');
            if (!pass) return false;
            const inputs = Array.from(document.querySelectorAll('input')).filter(
              (el) =>
                el.type !== 'password' &&
                el.type !== 'hidden' &&
                el.offsetParent !== null
            );
            const user = inputs[0];
            if (!user) return false;
            const setVal = (el, val) => {
              const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (desc && desc.set) desc.set.call(el, val);
              else el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            setVal(user, nif);
            setVal(pass, password);
            return true;
          })()`
        )
        .catch(() => false);
      if (filled) return true;
    }
  }

  user = await nifInput(page);
  pass = await passwordInput(page);
  if (!user || !pass) return false;

  await fillAngularInput(user, nif);
  await fillAngularInput(pass, password);
  return true;
}

async function clickAutenticar(page: Page): Promise<boolean> {
  const loc = await autenticarButton(page);
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

/**
 * Abre «Fatura ou Fatura-Recibo» (emitirfaturaV2).
 * Ordem do formulário AT:
 * Emissão → Transmitente → Adquirente → Motivo de Emissão →
 * Produtos, Serviços ou Outros → Observações → Desconto Financeiro → Totais da Fatura
 */
async function openEmitirFaturaForm(page: Page): Promise<boolean> {
  if (/emitirfatura/i.test(page.url()) && (await pageHasText(page, /data da transa(ç|c)ão/i))) {
    return true;
  }

  const link = await findInScopes(page, (s) =>
    s
      .getByRole('link', { name: /fatura ou fatura-recibo/i })
      .or(s.locator('a').filter({ hasText: /fatura ou fatura-recibo/i }))
  );
  if (link) {
    await Promise.all([
      page.waitForURL(/emitirfatura/i, { timeout: 20_000 }).catch(() => null),
      link.first().click({ force: true, timeout: 10_000 }),
    ]);
    await page.waitForTimeout(1200);
  } else {
    await page.goto(EMITIR_FATURA_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
  }

  await dismissCookies(page);
  return pageHasText(page, /data da transa(ç|c)ão|emitir faturas/i);
}

/** Secção Emissão: 1º data da transação, 2º tipo (Fatura). */
async function fillEmissaoDateThenTipo(
  page: Page,
  options?: { dateIso?: string; tipo?: 'Fatura' | 'Fatura-Recibo' }
): Promise<boolean> {
  const dateIso =
    options?.dateIso ??
    (() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })();
  const tipo = options?.tipo ?? 'Fatura';

  // 1) Data da transação — primeiro campo da secção Emissão
  let filledDate = false;
  const dateByEvaluate = await page
    .evaluate(
      `(iso) => {
        const labels = Array.from(document.querySelectorAll('label, span, div, th, td, p'));
        const label = labels.find((el) =>
          /data da transa(ç|c)ão/i.test((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim())
        );
        let input = null;
        if (label) {
          const root = label.closest('div, section, fieldset, form') || label.parentElement;
          input =
            (root && root.querySelector('input')) ||
            label.parentElement?.querySelector('input') ||
            null;
        }
        if (!input) {
          input = document.querySelector('input[type="date"]');
        }
        if (!input) return false;
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, iso);
        else input.value = iso;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
        return true;
      }`,
      dateIso
    )
    .catch(() => false);
  filledDate = Boolean(dateByEvaluate);

  if (!filledDate) {
    const anyDate = page.locator('input[type="date"]').first();
    if (await isVisible(anyDate)) {
      await fillAngularInput(anyDate, dateIso);
      filledDate = true;
    }
  }

  await page.waitForTimeout(500);

  // 2) Tipo = Fatura (só depois da data)
  const tipoOk = await page
    .evaluate(
      `(tipoLabel) => {
        const labels = Array.from(document.querySelectorAll('label, span, div, p'));
        const label = labels.find((el) => {
          const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
          return t === 'Tipo';
        });
        const root = label
          ? label.closest('div, section, fieldset') || label.parentElement
          : null;
        const select =
          (root && root.querySelector('select')) ||
          Array.from(document.querySelectorAll('select')).find((s) =>
            /fatura/i.test(s.innerText || '')
          ) ||
          null;
        if (select) {
          const opts = Array.from(select.options);
          const match =
            opts.find((o) => (o.textContent || '').trim() === tipoLabel) ||
            opts.find((o) => new RegExp('^\\\\s*' + tipoLabel + '\\\\s*$', 'i').test(o.textContent || ''));
          if (match) {
            select.value = match.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return 'select';
          }
        }
        // Combobox / mat-select
        const triggers = Array.from(
          document.querySelectorAll('[role="combobox"], .mat-select, button, div')
        );
        const trigger = triggers.find((el) => {
          const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
          return t === 'Tipo' || t === tipoLabel || /^Fatura(-Recibo)?$/i.test(t);
        });
        if (trigger && typeof trigger.click === 'function') {
          trigger.click();
          return 'opened';
        }
        return false;
      }`,
      tipo
    )
    .catch(() => false);

  if (tipoOk === 'opened') {
    await page.waitForTimeout(400);
    await page
      .getByRole('option', { name: new RegExp(`^\\s*${tipo}\\s*$`, 'i') })
      .or(page.locator('mat-option, li, div, span, option').filter({ hasText: new RegExp(`^\\s*${tipo}\\s*$`, 'i') }))
      .first()
      .click({ force: true })
      .catch(() => undefined);
  }

  await page.waitForTimeout(400);
  return filledDate;
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
        return /NIF/.test(t) && (/opção de autenticação|AUTENTICAÇÃO\\.GOV|CC\\s*\\/\\s*CMD|Autenticar/i.test(t));
      })()`,
      { timeout: 25_000 }
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

  // Obrigatório: sair de CC/CMD → NIF (campos utilizador/password)
  const nifFormOk = await ensureNifPasswordForm(page);
  if (!nifFormOk) {
    return {
      status: 'failed',
      message:
        'Não consegui abrir o separador NIF (o ecrã ficou em CC/CMD). Tente Ligar conta outra vez.',
    };
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
      message:
        'Campos NIF/password não encontrados após clicar no separador NIF. Tente Ligar conta outra vez.',
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
      if (!(await isLoggedInEmitir(page))) {
        if (await isLoginCardVisible(page) || (await isHomepageLoginVisible(page))) {
          return { status: 'expired', message: 'Sessão AT expirada — volte a ligar a conta' };
        }
        return {
          status: 'expired',
          message: `Sessão AT não reconhecida (${page.url()})`,
        };
      }

      const opened = await openEmitirFaturaForm(page);
      if (!opened) {
        return {
          status: 'ok',
          files: [],
          warnings: [
            'Sessão AT válida, mas não abri «Fatura ou Fatura-Recibo». Use Abrir no browser.',
          ],
        };
      }

      const emissaoOk = await fillEmissaoDateThenTipo(page, { tipo: 'Fatura' });
      return {
        status: 'ok',
        files: [],
        warnings: [
          emissaoOk
            ? 'Sessão OK · Fatura ou Fatura-Recibo aberto · Emissão: data + tipo Fatura. Segue: Adquirente → Motivo → Produtos → Observações → Desconto → Totais (ainda manual / próximo passo).'
            : 'Sessão OK · formulário Emitir Faturas aberto. Confirme data (1º) e tipo Fatura (2º) no browser se necessário.',
        ],
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
