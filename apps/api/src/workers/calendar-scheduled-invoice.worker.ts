import { processDueScheduledInvoices } from '../services/calendar/calendar-scheduled-invoice.service';

const INTERVAL_MS = 60_000;

/**
 * Processa faturas agendadas do calendário a cada 60s.
 * Em produção o cron HTTP (`POST /calendar/cron/process-scheduled-invoices`)
 * continua disponível como trigger externo; o claim por status evita duplicados.
 */
export function startCalendarScheduledInvoiceWorker() {
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

  console.log('[calendar-worker] autofaturação activa (cada 60s)');
}
