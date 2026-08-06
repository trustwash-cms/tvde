/**
 * Smoke: supplier → auth identity → fill email → Continuar should leave identity.
 * Usage: node scripts/smoke-uber-identity.mjs [email]
 * Does not complete OTP/password.
 */
import { chromium } from '../node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const email = process.argv[2] || 'admin@macbusinesss.com';
const outDir = resolve(process.cwd(), '.tmp-uber-identity-stuck');
mkdirSync(outDir, { recursive: true });

async function setIdentityValue(page, username) {
  await page.evaluate((value) => {
    const el = document.querySelector('#PHONE_NUMBER_or_EMAIL_ADDRESS');
    if (!el) return;
    el.removeAttribute('disabled');
    el.removeAttribute('readonly');
    el.disabled = false;
    el.readOnly = false;
    el.focus();
    const proto = window.HTMLInputElement.prototype;
    const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (protoSetter) protoSetter.call(el, value);
    else el.value = value;
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(value === '' ? ' ' : '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: value ? 'insertText' : 'deleteContentBackward',
      })
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, username);
}

async function diag(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#PHONE_NUMBER_or_EMAIL_ADDRESS');
    const buttons = [...document.querySelectorAll('button')].map((b) => ({
      text: (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 48),
      disabled: b.disabled,
      ariaDisabled: b.getAttribute('aria-disabled'),
      type: b.getAttribute('type'),
    }));
    const continuar = buttons.find((b) => /^(continuar|seguinte|next)$/i.test(b.text));
    return {
      url: location.href.slice(0, 140),
      value: el?.value ?? null,
      disabled: el?.disabled ?? null,
      continuar,
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    };
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  locale: 'pt-PT',
  viewport: { width: 1280, height: 900 },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
});
await context.addInitScript(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch {
    /* ignore */
  }
});
const page = await context.newPage();

try {
  console.log('[smoke] goto supplier.uber.com');
  await page.goto('https://supplier.uber.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForURL(/auth\.uber\.com/, { timeout: 45_000 }).catch(() => undefined);
  console.log('[smoke] url', page.url().slice(0, 140));

  const identity = page.locator('#PHONE_NUMBER_or_EMAIL_ADDRESS').or(
    page.getByPlaceholder(/telefone|e-?mail|phone|email/i)
  ).first();

  await identity.waitFor({ state: 'visible', timeout: 45_000 });
  console.log('[smoke] identity visible', await diag(page));

  await identity.click();
  await page.keyboard.press('Meta+a').catch(() => undefined);
  await page.keyboard.press('Backspace').catch(() => undefined);
  await setIdentityValue(page, '');
  await identity.pressSequentially(email, { delay: 25 }).catch(async () => {
    await setIdentityValue(page, email);
  });
  await setIdentityValue(page, email);
  await identity.blur().catch(() => undefined);
  await page.waitForTimeout(500);

  const before = await diag(page);
  console.log('[smoke] after fill', before);

  const continuar = page.getByRole('button', { name: /^(continuar|seguinte|next)$/i }).first();
  for (let i = 0; i < 15; i += 1) {
    if (!(await continuar.isDisabled().catch(() => true))) break;
    await page.waitForTimeout(300);
  }
  const disabled = await continuar.isDisabled().catch(() => true);
  console.log('[smoke] continuar disabled=', disabled);

  if (!disabled) await continuar.click({ timeout: 10_000 });
  else {
    await setIdentityValue(page, email);
    await continuar.click({ force: true, timeout: 10_000 }).catch(() => undefined);
    await page.keyboard.press('Enter').catch(() => undefined);
  }

  const leaveDeadline = Date.now() + 20_000;
  let left = false;
  let reason = 'timeout';
  while (Date.now() < leaveDeadline) {
    const bot = await page.getByText(/proteger a sua conta|iniciar desafio|resolva este desafio/i).first().isVisible().catch(() => false);
    if (bot) {
      left = true;
      reason = 'bot_challenge';
      break;
    }
    for (const f of page.frames()) {
      try {
        const url = f.url();
        if (/ec-game-core|funcaptcha|arkoselabs|ak0[a-z0-9]*\.uber\.com/i.test(url)) {
          left = true;
          reason = 'bot_iframe';
          break;
        }
        if (await f.getByText(/proteger a sua conta|iniciar desafio/i).first().isVisible().catch(() => false)) {
          left = true;
          reason = 'bot_frame_text';
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (left) break;

    const prompt = page.getByText(/número de telefone ou e-?mail|qual é o seu/i).first();
    const still = await prompt.isVisible().catch(() => false);
    const hasIdentity = await identity.isVisible().catch(() => false);
    const idDisabled = await identity.isDisabled().catch(() => false);
    if (idDisabled) {
      await page.waitForTimeout(1000);
      const bot2 = await page.getByText(/proteger a sua conta|iniciar desafio/i).first().isVisible().catch(() => false);
      if (bot2) {
        left = true;
        reason = 'bot_after_disabled';
        break;
      }
    }
    if (!still || !hasIdentity) {
      left = true;
      reason = 'prompt_gone';
      break;
    }
    // password / otp / chooser
    if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
      left = true;
      reason = 'password';
      break;
    }
    if (await page.locator('#PHONE_SMS_OTP-0').first().isVisible().catch(() => false)) {
      left = true;
      reason = 'otp';
      break;
    }
    if (await page.getByText(/chave de acesso|enviar código por sms/i).first().isVisible().catch(() => false)) {
      left = true;
      reason = 'chooser';
      break;
    }
    await page.waitForTimeout(700);
  }

  const after = await diag(page);
  const shot = resolve(outDir, `smoke-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  writeFileSync(resolve(outDir, 'smoke-last.json'), JSON.stringify({ left, reason, before, after, shot }, null, 2));
  console.log('[smoke] leftIdentity=', left, 'reason=', reason);
  console.log('[smoke] after', after);
  console.log('[smoke] screenshot', shot);
  if (!left) {
    console.error('[smoke] FAIL: still on identity');
    process.exitCode = 2;
  } else {
    console.log('[smoke] OK: advanced past identity (' + reason + ')');
  }
} catch (err) {
  console.error('[smoke] error', err);
  process.exitCode = 1;
  try {
    await page.screenshot({ path: resolve(outDir, `smoke-error-${Date.now()}.png`), fullPage: false });
  } catch {
    /* ignore */
  }
} finally {
  await browser.close().catch(() => undefined);
}
