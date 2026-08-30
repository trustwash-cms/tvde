import { prisma } from '@tvde/database';
import { envOr } from '@tvde/shared/server';
import { runDailyPortalAutoSyncs } from '../services/portal-rpa/portal-connection.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const LISBON_TZ = 'Europe/Lisbon';

/** Hora local (Lisboa) do sync automático diário — default 06:00. */
function dailySyncHour(): number {
  const raw = parseInt(envOr('PORTAL_DAILY_SYNC_HOUR', '6'), 10);
  if (!Number.isFinite(raw)) return 6;
  return Math.min(23, Math.max(0, raw));
}

/** Milissegundos até a próxima ocorrência da hora configurada em Europe/Lisbon. */
export function msUntilNextDailySyncRun(now = new Date(), hour = dailySyncHour()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LISBON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(
    parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)])
  );
  const secondsSinceMidnight = map.hour * 3600 + map.minute * 60 + map.second;
  const targetSeconds = hour * 3600;
  let diff = targetSeconds - secondsSinceMidnight;
  if (diff <= 0) diff += 24 * 3600;
  return diff * 1000;
}

export function startPortalDailySyncWorker() {
  const hour = dailySyncHour();

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

  const firstDelay = msUntilNextDailySyncRun();
  console.log(
    `[portal-rpa] sync automático diário activo (Via Verde / MyPRIO / Uber, opt-in) — próxima corrida ~${hour.toString().padStart(2, '0')}:00 ${LISBON_TZ} (em ${Math.round(firstDelay / 60_000)} min)`
  );

  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, DAY_MS);
  }, firstDelay);
}
