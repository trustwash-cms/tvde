import { prisma } from '@tvde/database';
import { runDailyPortalAutoSyncs } from '../services/portal-rpa/portal-connection.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Evita bater no Playwright no arranque da API (refresh de sessões já corre). */
const FIRST_TICK_DELAY_MS = 2 * 60 * 1000;

export function startPortalDailySyncWorker() {
  const tick = async () => {
    try {
      const summary = await runDailyPortalAutoSyncs(prisma);
      const ran = summary.filter((row) => !row.skipped);
      if (ran.length > 0) {
        console.log('[portal-rpa] daily auto-sync:', summary);
      }
    } catch (err) {
      console.error('[portal-rpa] daily auto-sync failed:', err instanceof Error ? err.message : err);
    }
  };

  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, DAY_MS);
  }, FIRST_TICK_DELAY_MS);

  console.log('[portal-rpa] sync automático diário activo (Via Verde / MyPRIO, opt-in)');
}
