import type { PortalAdapter, PortalLoginPhase, PortalSyncPhase } from './types';
import { captureStorageState } from './types';

/**
 * Uber — telefone/email → continuar → OTP SMS/WhatsApp.
 * Não automatiza Google/Apple.
 */
export const uberAdapter: PortalAdapter = {
  portal: 'uber',

  async login(page, username, password): Promise<PortalLoginPhase> {
    try {
      // Password é ignorada no 1º passo Uber; username = telefone ou email
      void password;
      await page.goto('https://auth.uber.com/v2/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(1500);

      const identity = page
        .locator(
          'input[name="email"], input[type="email"], input[type="tel"], input[placeholder*="telefone" i], input[placeholder*="e-mail" i], input[placeholder*="email" i]'
        )
        .first();
      await identity.waitFor({ state: 'visible', timeout: 20_000 });
      await identity.fill(username);

      await page.getByRole('button', { name: /continuar/i }).first().click();
      await page.waitForTimeout(2500);

      // Pode pedir password OU OTP
      const pass = page.locator('input[type="password"]').first();
      if (await pass.isVisible().catch(() => false) && password) {
        await pass.fill(password);
        await page.getByRole('button', { name: /continuar|seguinte|next|entrar/i }).first().click();
        await page.waitForTimeout(2500);
      }

      const otpVisible = await page
        .locator(
          'input[name*="otp" i], input[name*="code" i], input[autocomplete="one-time-code"], input[placeholder*="código" i], input[placeholder*="code" i]'
        )
        .first()
        .isVisible()
        .catch(() => false);

      if (otpVisible) {
        return {
          status: 'awaiting_otp',
          otpHint: 'Introduza o código SMS/WhatsApp da Uber',
          storageState: await captureStorageState(page.context()),
        };
      }

      // Se já entrou (sessão rara)
      if (!(await identity.isVisible().catch(() => false))) {
        return { status: 'connected', storageState: await captureStorageState(page.context()) };
      }

      return {
        status: 'awaiting_otp',
        otpHint: 'Se recebeu OTP Uber, introduza-o agora',
        storageState: await captureStorageState(page.context()),
      };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : 'Falha no login Uber' };
    }
  },

  async submitOtp(page, code): Promise<PortalLoginPhase> {
    try {
      const otp = page
        .locator(
          'input[name*="otp" i], input[name*="code" i], input[autocomplete="one-time-code"], input[placeholder*="código" i], input[placeholder*="code" i]'
        )
        .first();
      await otp.waitFor({ state: 'visible', timeout: 15_000 });
      await otp.fill(code);
      await page.getByRole('button', { name: /continuar|verificar|confirmar|seguinte|next/i }).first().click();
      await page.waitForTimeout(3500);

      if (await otp.isVisible().catch(() => false)) {
        return { status: 'failed', message: 'OTP Uber inválido ou expirado' };
      }

      return { status: 'connected', storageState: await captureStorageState(page.context()) };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : 'Falha ao submeter OTP Uber' };
    }
  },

  async sync(_context, page): Promise<PortalSyncPhase> {
    try {
      await page.goto('https://suppliers.uber.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(2500);

      if (page.url().includes('auth.uber.com')) {
        return { status: 'expired', message: 'Sessão Uber expirada — volte a ligar a conta' };
      }

      const downloadPromise = page.waitForEvent('download', { timeout: 25_000 }).catch(() => null);
      const exportBtn = page
        .getByRole('button', { name: /export|csv|download|descarregar|pagamentos/i })
        .or(page.getByRole('link', { name: /export|csv|download|descarregar/i }))
        .first();

      if (await exportBtn.isVisible().catch(() => false)) {
        await exportBtn.click();
        const download = await downloadPromise;
        if (download) {
          const filename = download.suggestedFilename() || 'uber.csv';
          const stream = await download.createReadStream();
          if (stream) {
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            return { status: 'ok', files: [{ filename, buffer: Buffer.concat(chunks) }] };
          }
        }
      }

      return {
        status: 'failed',
        message:
          'Conta Uber ligada, mas o export CSV automático não foi encontrado. Use o importador CSV manualmente enquanto os selectores são refinados.',
      };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : 'Sync Uber falhou' };
    }
  },

  async refresh(_context, page): Promise<'ok' | 'expired'> {
    await page.goto('https://suppliers.uber.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1500);
    if (page.url().includes('auth.uber.com')) return 'expired';
    return 'ok';
  },
};
