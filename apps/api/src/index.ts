import './load-env';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { env } from './config/env';
import { disconnectRedis, getRedis } from './lib/redis';
import { startCalendarScheduledInvoiceWorker } from './workers/calendar-scheduled-invoice.worker';
import { startBoltDailySyncWorker } from './workers/bolt-daily-sync.worker';
import { startPortalSessionRefreshWorker } from './workers/portal-session-refresh.worker';
import { disposeAllLiveOtpSessions } from './services/portal-rpa/types';

let shuttingDown = false;

async function shutdown(app: FastifyInstance, signal: string, redisConnected: boolean) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    await disposeAllLiveOtpSessions();
    await app.close();
    if (redisConnected) await disconnectRedis();
  } catch (err) {
    console.error('Erro ao encerrar API:', err);
    process.exit(1);
  }

  process.exit(0);
}

async function main() {
  const app = await buildApp();
  let redisConnected = false;

  try {
    await getRedis().connect();
    redisConnected = true;
  } catch {
    console.warn('Redis não disponível — fail2ban e cache desactivados');
  }

  await app.listen({ port: env.port, host: env.host });
  console.log(`TVDE API running at http://${env.host}:${env.port}`);
  startCalendarScheduledInvoiceWorker();
  startBoltDailySyncWorker();
  startPortalSessionRefreshWorker();

  const stop = (signal: string) => {
    void shutdown(app, signal, redisConnected);
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
