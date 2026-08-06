import { syncWhmcsPaidInvoices } from '../services/whmcs/whmcs-sync.service';

const INTERVAL_MS = 60_000;

/** Poll WHMCS Paid → Moloni a cada 60s (claim por WhmcsInvoiceMap evita duplicados). */
export function startWhmcsPaidInvoiceWorker() {
  const tick = async () => {
    try {
      const result = await syncWhmcsPaidInvoices({ limitPerWorkspace: 25 });
      if (result.issued > 0 || result.failed > 0) {
        console.log('[whmcs-worker] sync paid:', result);
      }
    } catch (err) {
      console.error('[whmcs-worker] failed:', err instanceof Error ? err.message : err);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);

  console.log('[whmcs-worker] WHMCS→Moloni activo (cada 60s)');
}
