import { syncAllBoltWorkspaces } from '../services/bolt-sync.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export function startBoltDailySyncWorker() {
  const tick = async () => {
    try {
      const summary = await syncAllBoltWorkspaces('all');
      if (summary.length > 0) {
        console.log('[bolt-worker] daily sync:', summary);
      }
    } catch (err) {
      console.error('[bolt-worker] failed:', err instanceof Error ? err.message : err);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, DAY_MS);

  console.log('[bolt-worker] sync automática activa (1x por dia)');
}
