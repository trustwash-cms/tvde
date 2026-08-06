import './load-env';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@tvde/database';
import { buildApp } from './app';
import { env } from './config/env';
import { disconnectRedis, getRedis } from './lib/redis';
import { startCalendarScheduledInvoiceWorker } from './workers/calendar-scheduled-invoice.worker';
import { startBoltDailySyncWorker } from './workers/bolt-daily-sync.worker';
import { startPortalSessionRefreshWorker } from './workers/portal-session-refresh.worker';
import { startWhmcsPaidInvoiceWorker } from './workers/whmcs-paid-invoice.worker';
import { clearStaleInfraPortalErrors } from './services/portal-rpa/portal-connection.service';
import {
  disposeAllLiveOtpSessions,
  ensurePlaywrightReady,
} from './services/portal-rpa/types';

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

async function bootstrapPlaywright() {
  if (env.portalRpaMock) {
    console.log('[portal-rpa] PORTAL_RPA_MOCK=true — skip Chromium probe');
    return;
  }
  if (!env.portalRpaEnabled) {
    console.log('[portal-rpa] PORTAL_RPA_ENABLED=false — skip Chromium probe');
    return;
  }
  try {
    const result = await ensurePlaywrightReady({ heal: true, force: true });
    console.log(
      `[portal-rpa] playwright ready=${result.ready} healed=${result.healed} — ${result.detail}`
    );
    if (result.ready) {
      const n = await clearStaleInfraPortalErrors(prisma);
      if (n > 0) {
        console.log(`[portal-rpa] limpos ${n} lastError(s) de infra nas portal_connections`);
      }
    } else {
      console.warn(
        '[portal-rpa] Chromium indisponível após auto-heal — Ligar conta / sync vão falhar até corrigir'
      );
    }
  } catch (err) {
    console.warn(
      '[portal-rpa] falha no bootstrap Playwright:',
      err instanceof Error ? err.message : err
    );
  }
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
  startWhmcsPaidInvoiceWorker();
  void bootstrapPlaywright();

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
