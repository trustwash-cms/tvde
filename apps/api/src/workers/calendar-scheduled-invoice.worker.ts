import { env } from '../config/env';
import { processDueScheduledInvoices } from '../services/calendar/calendar-scheduled-invoice.service';

const INTERVAL_MS = 60_000;

export function startCalendarScheduledInvoiceWorker() {
  if (env.nodeEnv !== 'development') return;

  const tick = async () => {
    try {
      const result = await processDueScheduledInvoices({
        limit: 10,
      });
      if (result.processed > 0) {
        console.log('[calendar-worker] processed scheduled invoices:', result);
      }
    } catch (err) {
      console.error('[calendar-worker] failed:', err instanceof Error ? err.message : err);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);

  console.log('[calendar-worker] autofaturação activa (dev, cada 60s)');
}
