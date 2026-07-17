import { refreshAllPortalSessions, clearStalePortalJobs } from '../services/portal-rpa/portal-connection.service';
import { prisma } from '@tvde/database';
import { env } from '../config/env';

export function startPortalSessionRefreshWorker() {
  void clearStalePortalJobs(prisma).catch(() => undefined);

  const intervalMs = env.portalRpaRefreshIntervalHours * 60 * 60 * 1000;

  const tick = async () => {
    try {
      await clearStalePortalJobs(prisma);
      const results = await refreshAllPortalSessions(prisma);
      if (results.length) {
        console.log('[portal-rpa] session refresh:', results);
      }
    } catch (err) {
      console.error('[portal-rpa] refresh failed:', err instanceof Error ? err.message : err);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, intervalMs);

  console.log(
    `[portal-rpa] refresh de sessões activo (a cada ${env.portalRpaRefreshIntervalHours}h)`
  );
}
