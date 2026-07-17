import type { Page } from 'playwright';
import type { PortalAdapter, PortalLoginPhase, PortalSyncPhase } from './types';
import { captureStorageState } from './types';

const AREA_URLS = [
  'https://www.viaverde.pt/empresas/minha-via-verde/extratos-movimentos',
  'https://www.viaverde.pt/empresas/minha-via-verde/movimentos-extratos',
  'https://www.viaverde.pt/particulares/minha-via-verde/movimentos-extratos',
  'https://www.viaverde.pt/particulares/minha-via-verde/extratos-movimentos',
];

const LOGIN_URLS = [
  'https://www.viaverde.pt/empresas/minha-via-verde/extratos-movimentos',
  'https://www.viaverde.pt/particulares/minha-via-verde/AMinhaViaVerde',
  'https://www.viaverde.pt/empresas/',
  'https://www.viaverde.pt/particulares/',
];

async function dismissCookies(page: Page) {
  const candidates = [
    page.locator('#onetrust-accept-btn-handler'),
    page.getByRole('button', { name: /aceitar todos|aceitar|accept all|concordar/i }),
  ];
  for (const btn of candidates) {
    if (await btn.first().isVisible().catch(() => false)) {
      await btn.first().click({ timeout: 3000, force: true }).catch(() => undefined);
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function usernameFieldReady(page: Page): Promise<boolean> {
  const box = await page.locator('#txtUsername').boundingBox().catch(() => null);
  return Boolean(box && box.width > 40 && box.height > 10);
}

async function ensureLoginModal(page: Page) {
  await dismissCookies(page);
  if (await usernameFieldReady(page)) return;

  const headerLogin = page
    .locator('span.login-label, a.login, .login-label')
    .filter({ hasText: /^Login$/i })
    .first();
  if (await headerLogin.count()) {
    await headerLogin.click({ force: true, timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  if (await usernameFieldReady(page)) return;

  await page
    .evaluate(`(() => {
      const modal = document.querySelector('#pnlLogin');
      if (!modal) return false;
      modal.classList.add('show', 'in', 'open');
      modal.style.display = 'block';
      modal.style.visibility = 'visible';
      modal.style.opacity = '1';
      modal.removeAttribute('aria-hidden');
      return true;
    })()`)
    .catch(() => false);
  await page.waitForTimeout(500);
}

async function submitLogin(page: Page) {
  const btn = page.locator('#btnLogin, button[name="dnn$UserLogin$btnLogin"]').first();
  if (await btn.count()) {
    await btn.click({ force: true, timeout: 10_000 });
    return;
  }
  await page.locator('#txtPassword').press('Enter');
}

async function pageDebug(page: Page): Promise<string> {
  const info = await page
    .evaluate(`(() => {
      const texts = [...document.querySelectorAll('a,button,span,li')]
        .map((el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter((t) => t && /export|excel|pdf|movimento|extrato|identificador|matr/i.test(t))
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 25);
      return { url: location.href, title: document.title, texts };
    })()`)
    .catch(() => ({ url: page.url(), title: '', texts: [] as string[] }));
  const texts = Array.isArray((info as { texts?: string[] }).texts)
    ? (info as { texts: string[] }).texts.join(' | ')
    : '';
  return `url=${(info as { url?: string }).url || page.url()} · UI=[${texts}]`;
}

async function openMovimentosTab(page: Page) {
  const tabCandidates = [
    page.getByRole('tab', { name: /movimentos/i }),
    page.getByRole('link', { name: /^movimentos$/i }),
    page.locator('[role="tab"], a, button, li').filter({ hasText: /^\s*Movimentos\s*$/i }),
    page.locator('text=Movimentos'),
  ];
  for (const loc of tabCandidates) {
    const el = loc.first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(1200);
      break;
    }
  }

  await page
    .getByText(/Identificador\s*\/\s*Conta Mobilidade|Identificador/i)
    .first()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);
}

/** Define filtro De/Até dos movimentos para os últimos 30 dias (datepickers MM/AAAA ou DD/MM/AAAA). */
async function applyLast30DaysFilter(page: Page) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const pad = (n: number) => String(n).padStart(2, '0');
  const startDay = `${pad(start.getDate())}/${pad(start.getMonth() + 1)}/${start.getFullYear()}`;
  const endDay = `${pad(end.getDate())}/${pad(end.getMonth() + 1)}/${end.getFullYear()}`;

  // Abrir secção filtros se existir
  const filterToggle = page.locator('text=Filtrar por').first();
  if (await filterToggle.isVisible().catch(() => false)) {
    await filterToggle.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(400);
  }

  const allPickers = page.locator('input.datepicker');
  const count = await allPickers.count();
  const dayFormatPickers: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const val = await allPickers.nth(i).inputValue().catch(() => '');
    // dd/mm/yyyy tem 2 barras; mm/yyyy tem 1
    if ((val.match(/\//g) || []).length >= 2 || val === '') {
      const box = await allPickers.nth(i).boundingBox().catch(() => null);
      if (box && box.width > 0) dayFormatPickers.push(i);
    }
  }

  const targets =
    dayFormatPickers.length >= 2
      ? [dayFormatPickers[0]!, dayFormatPickers[1]!]
      : count >= 4
        ? [2, 3]
        : [];

  if (targets.length < 2) return;

  await allPickers.nth(targets[0]!).fill(startDay, { force: true }).catch(() => undefined);
  await allPickers.nth(targets[1]!).fill(endDay, { force: true }).catch(() => undefined);
  await allPickers.nth(targets[0]!).dispatchEvent('change').catch(() => undefined);
  await allPickers.nth(targets[1]!).dispatchEvent('change').catch(() => undefined);
  await allPickers.nth(targets[1]!).press('Tab').catch(() => undefined);

  // Alguns layouts têm botão «Aplicar» / «Pesquisar»
  const apply = page
    .locator('a, button, span')
    .filter({ hasText: /^\s*(Aplicar|Pesquisar|Filtrar)\s*$/i })
    .first();
  if (await apply.isVisible().catch(() => false)) {
    await apply.click({ force: true }).catch(() => undefined);
  }
  await page.waitForTimeout(1800);
}

/** Clica «Ver mais» até carregar todos os movimentos do filtro (ex. 358). */
async function loadAllMovimentosPages(page: Page, maxClicks = 80) {
  for (let i = 0; i < maxClicks; i += 1) {
    const btn = page.locator('a, button, span').filter({ hasText: /^\s*Ver mais\s*$/i }).first();
    if (!(await btn.isVisible().catch(() => false))) break;

    const before = await page
      .evaluate(
        `(() => (document.body.innerText.match(/(\\d+)\\/(\\d+)\\s+movimentos/i) || [])[0] || '')`
      )
      .catch(() => '');

    await btn.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(900);

    const after = await page
      .evaluate(
        `(() => (document.body.innerText.match(/(\\d+)\\/(\\d+)\\s+movimentos/i) || [])[0] || '')`
      )
      .catch(() => '');

    if (after && after === before) {
      // Não avançou — parar
      break;
    }
    const m = String(after).match(/(\d+)\s*\/\s*(\d+)/);
    if (m && m[1] === m[2]) break;
  }
}

function isMovimentosListVisible(page: Page): Promise<boolean> {
  return page
    .locator('table, [class*="table"], [class*="grid"]')
    .filter({ hasText: /Identificador|Matr[íi]cula/i })
    .first()
    .isVisible()
    .catch(() => false);
}

async function gotoMovimentosPage(page: Page): Promise<{ ok: boolean; debug: string }> {
  for (const url of AREA_URLS) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await dismissCookies(page);

    if (await usernameFieldReady(page)) {
      return { ok: false, debug: `login_modal · ${await pageDebug(page)}` };
    }

    const side = page
      .getByRole('link', { name: /extratos e movimentos|movimentos e extratos|extratos.?movimentos/i })
      .first();
    if (await side.isVisible().catch(() => false)) {
      await side.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(1500);
    }

    await openMovimentosTab(page);
    await applyLast30DaysFilter(page);
    await openMovimentosTab(page);
    await loadAllMovimentosPages(page);

    if (await isMovimentosListVisible(page)) {
      return { ok: true, debug: await pageDebug(page) };
    }

    // Exportar visível também conta (mesmo sem table match)
    const hasExport = await page.locator('a, button, span').filter({ hasText: /exportar/i }).first().isVisible().catch(() => false);
    if (hasExport) return { ok: true, debug: await pageDebug(page) };
  }

  return { ok: false, debug: await pageDebug(page) };
}

async function clickVisibleByExactText(page: Page, exact: string): Promise<boolean> {
  const candidates = page.locator('a, button, span, div[role="button"], li');
  const count = await candidates.count();
  for (let i = 0; i < Math.min(count, 80); i += 1) {
    const el = candidates.nth(i);
    const text = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (text !== exact) continue;
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width > 8 && box.height > 8) {
      await el.click({ force: true });
      return true;
    }
  }
  return false;
}

async function downloadExcelExport(page: Page): Promise<{ filename: string; buffer: Buffer } | null> {
  const opened = await clickVisibleByExactText(page, 'Exportar');
  if (!opened) return null;
  await page.waitForTimeout(700);

  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
  const excelClicked = await clickVisibleByExactText(page, 'Excel');
  if (!excelClicked) return null;

  const download = await downloadPromise;
  if (!download) return null;

  const filename = download.suggestedFilename() || 'viaverde-movimentos.xlsx';
  try {
    const path = await download.path();
    if (path) {
      const fs = await import('fs/promises');
      return { filename, buffer: await fs.readFile(path) };
    }
  } catch {
    /* stream fallback */
  }

  const stream = await download.createReadStream();
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return { filename, buffer: Buffer.concat(chunks) };
}

function parseDescricaoRoute(desc: string): {
  entryPoint: string;
  exitPoint: string;
  entryDate: string;
  exitDate: string;
} {
  const dates = [...desc.matchAll(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/g)].map((m) => m[1]!);
  const entryDate = dates[0] ?? '';
  const exitDate = dates[1] ?? dates[0] ?? '';
  const route = desc
    .replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g, '')
    .replace(/\s*>+\s*/g, ' >> ')
    .replace(/\s+/g, ' ')
    .trim();
  if (route.includes('>>')) {
    const [a, b] = route.split('>>').map((s) => s.trim());
    return { entryPoint: a || route, exitPoint: b || a || route, entryDate, exitDate };
  }
  return { entryPoint: route || desc, exitPoint: route || desc, entryDate, exitDate };
}

/** Raspa a tabela Movimentos (Identificador repete-se → OBU sintético único por movimento). */
async function scrapeMovimentosTable(page: Page): Promise<{ filename: string; buffer: Buffer } | null> {
  const matrix = await page
    .evaluate(`(() => {
      const tables = [...document.querySelectorAll('table')];
      const table =
        tables.find((t) => /Identificador\\s*\\/\\s*Conta Mobilidade/i.test(t.innerText || '')) ||
        tables.find((t) => /Identificador/i.test(t.innerText || '') && /Matr/i.test(t.innerText || ''));
      if (!table) return null;
      return [...table.querySelectorAll('tr')]
        .map((tr) =>
          [...tr.querySelectorAll('th,td')].map((cell) =>
            (cell.innerText || '').replace(/\\s+/g, ' ').trim()
          )
        )
        .filter((r) => r.some((c) => c));
    })()`)
    .catch(() => null);

  if (!Array.isArray(matrix) || matrix.length < 2) return null;

  const header = [
    'OBU',
    'Matrícula',
    'Entry Point',
    'Exit Point',
    'Entry Date',
    'Exit Date',
    'Data da cobrança',
    'Valor',
    'Payment Method',
  ];
  const lines: string[][] = [header];

  for (let i = 1; i < matrix.length; i += 1) {
    const r = matrix[i] as string[];
    if (!r || r.length < 3) continue;
    const identifier = r[0] ?? '';
    const plate = r[1] ?? '';
    const desc = r[2] ?? '';
    const paymentMethod = r[4] ?? '';
    const valor = r[5] ?? '';
    if (!identifier || !plate || !valor) continue;

    const { entryPoint, exitPoint, entryDate, exitDate } = parseDescricaoRoute(desc);
    const valorKey = valor.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
    const obu = `${identifier}_${entryDate.replace(/\D/g, '') || 'nodate'}_${valorKey}_${i}`;
    // O portal não mostra «Data cobrança» nesta lista — usamos a data do movimento
    const cobranca = entryDate ? entryDate.slice(0, 10) : '';
    lines.push([
      obu,
      plate,
      entryPoint,
      exitPoint,
      entryDate,
      exitDate,
      cobranca,
      valor,
      paymentMethod,
    ]);
  }

  if (lines.length < 2) return null;

  const csv = lines
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return {
    filename: 'viaverde-movimentos-scrape.csv',
    buffer: Buffer.from(`\uFEFF${csv}`, 'utf-8'),
  };
}

export const viaVerdeAdapter: PortalAdapter = {
  portal: 'via_verde',

  async login(page, username, password): Promise<PortalLoginPhase> {
    try {
      let ready = false;
      for (const url of LOGIN_URLS) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForTimeout(900);
        await ensureLoginModal(page);
        ready = await usernameFieldReady(page);
        if (ready) break;
      }

      if (!ready) {
        return {
          status: 'failed',
          message: 'Modal de login Via Verde não ficou pronto. Tente de novo ou use o import XLSX.',
        };
      }

      await page.locator('#txtUsername').fill(username, { force: true });
      await page.locator('#txtPassword').fill(password, { force: true });
      await submitLogin(page);

      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => null),
        page.waitForTimeout(5000),
      ]);
      await page.waitForTimeout(1200);

      await page
        .goto(AREA_URLS[0]!, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200);
      if (await usernameFieldReady(page)) {
        await page
          .goto('https://www.viaverde.pt/particulares/minha-via-verde/movimentos-extratos', {
            waitUntil: 'domcontentloaded',
            timeout: 45_000,
          })
          .catch(() => undefined);
        await page.waitForTimeout(1200);
      }
      if (await usernameFieldReady(page)) {
        return {
          status: 'failed',
          message: 'Login Via Verde rejeitado — verifique email/password',
        };
      }

      const storageState = await captureStorageState(page.context());
      return { status: 'connected', storageState };
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Falha no login Via Verde';
      if (/Timeout .* exceeded|intercepts pointer/i.test(raw)) {
        return {
          status: 'failed',
          message: 'Timeout no login Via Verde. Tente Ligar conta outra vez.',
        };
      }
      return { status: 'failed', message: raw.split('\n')[0]?.slice(0, 280) || raw };
    }
  },

  async submitOtp(): Promise<PortalLoginPhase> {
    return { status: 'failed', message: 'Via Verde não requer OTP' };
  },

  async sync(_context, page): Promise<PortalSyncPhase> {
    try {
      const nav = await gotoMovimentosPage(page);
      if (!nav.ok) {
        if (await usernameFieldReady(page)) {
          return { status: 'expired', message: 'Sessão Via Verde expirada — volte a ligar a conta' };
        }
        return {
          status: 'failed',
          message: `Não encontrei a lista Movimentos. ${nav.debug}`,
        };
      }

      // Preferir scrape da tabela Movimentos (Excel do portal muitas vezes não dispara download)
      let file = await scrapeMovimentosTable(page);
      if (!file) {
        file = await downloadExcelExport(page);
      }
      if (!file) {
        await openMovimentosTab(page);
        file = await scrapeMovimentosTable(page);
      }

      if (!file) {
        return {
          status: 'failed',
          message: `Não consegui ler movimentos (HTML/Excel). ${await pageDebug(page)}`,
        };
      }

      return { status: 'ok', files: [file] };
    } catch (err) {
      return {
        status: 'failed',
        message: err instanceof Error ? err.message : 'Sync Via Verde falhou',
      };
    }
  },

  async refresh(_context, page): Promise<'ok' | 'expired'> {
    await page.goto(AREA_URLS[0]!, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1200);
    await dismissCookies(page);
    return (await usernameFieldReady(page)) ? 'expired' : 'ok';
  },
};
