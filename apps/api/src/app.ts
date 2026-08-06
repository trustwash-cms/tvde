import { getApiPrefix, getHealthPath } from '@tvde/shared/server';
import { env } from './config/env';
import { getPlaywrightReadinessSnapshot } from './services/portal-rpa/types';
import databasePlugin from './plugins/database.plugin';
import authPlugin from './plugins/auth.plugin';
import modulePlugin from './plugins/module.plugin';
import { authRoutes } from './routes/auth.routes';
import { tenantRoutes } from './routes/tenants.routes';
import { workspaceRoutes } from './routes/workspaces.routes';
import { workspaceRequestRoutes } from './routes/workspace-requests.routes';
import { searchRoutes } from './routes/search.routes';
import { smtpRoutes } from './routes/smtp.routes';
import { tenantBrandingRoutes } from './routes/tenant-branding.routes';
import { tenantBrandingPublicRoutes } from './routes/tenant-branding-public.routes';
import { platformRoutes } from './routes/platform.routes';
import { billingRoutes, billingMoloniCallbackRoutes } from './routes/billing.routes';
import { billingPublicRoutes } from './routes/billing-public.routes';
import { billingSyncCronRoutes } from './routes/billing-sync-cron.routes';
import { calendarSyncCronRoutes } from './routes/calendar-cron.routes';
import { whmcsRoutes, whmcsSyncCronRoutes } from './routes/whmcs.routes';
import {
  moduleRoutes,
  clientRoutes,
  userRoutes,
  auditRoutes,
} from './routes/business.routes';
import { calendarPublicRoutes, calendarRoutes } from './routes/calendar.routes';
import { adminMgmtRoutes } from './routes/admin-mgmt.routes';
import { boltRoutes } from './routes/bolt.routes';
import { boltSyncCronRoutes } from './routes/bolt-sync-cron.routes';
import { userProfileRoutes } from './routes/user-profile.routes';
import { userVehicleRoutes } from './routes/user-vehicle.routes';
import { tvdeSettingsRoutes } from './routes/tvde-settings.routes';
import { viaVerdeRoutes } from './routes/via-verde.routes';
import { electricityRoutes } from './routes/electricity.routes';
import { combustivelRoutes } from './routes/combustivel.routes';
import { uberRoutes } from './routes/uber.routes';
import { paymentRoutes } from './routes/payment.routes';
import { portalConnectionRoutes } from './routes/portal-connection.routes';
import { driverDashboardRoutes } from './routes/driver-dashboard.routes';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { formatFastifyValidation, formatZodError } from './lib/validation-errors';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

export async function buildApp() {
  const fastify = Fastify({
    logger: env.nodeEnv === 'development',
    trustProxy: true,
  });

  await fastify.register(import('@fastify/sensible'));
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await fastify.register(rateLimit, {
    max: env.rateLimitMax,
    timeWindow: env.rateLimitWindow,
    allowList: (request) => {
      if (env.nodeEnv === 'production') return false;
      const ip = request.ip ?? '';
      return (
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip.endsWith('127.0.0.1')
      );
    },
  });

  await fastify.register(databasePlugin);

  const corsOrigins = [
    ...env.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean),
    ...(env.nodeEnv !== 'production' ? ['http://localhost', 'http://127.0.0.1'] : []),
  ];

  await fastify.register(cors, {
    origin: corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await fastify.register(authPlugin);
  await fastify.register(modulePlugin);

  fastify.get(getHealthPath(), async () => {
    const playwright = env.portalRpaMock
      ? { ready: true, detail: 'mock', launchVerified: true }
      : getPlaywrightReadinessSnapshot();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      playwright: {
        ready: playwright.ready,
        detail: playwright.detail,
        launchVerified: playwright.launchVerified,
        mock: env.portalRpaMock,
      },
    };
  });

  await fastify.register(async (api) => {
    await api.register(authRoutes);
    await api.register(tenantRoutes);
    await api.register(workspaceRoutes);
    await api.register(workspaceRequestRoutes);
    await api.register(moduleRoutes);
    await api.register(clientRoutes);
    await api.register(userRoutes);
    await api.register(userProfileRoutes);
    await api.register(userVehicleRoutes);
    await api.register(tvdeSettingsRoutes);
    await api.register(auditRoutes);
    await api.register(searchRoutes);
    await api.register(smtpRoutes);
    await api.register(tenantBrandingRoutes);
    await api.register(tenantBrandingPublicRoutes);
    await api.register(platformRoutes);
    await api.register(billingRoutes);
    await api.register(billingPublicRoutes);
    await api.register(billingMoloniCallbackRoutes);
    await api.register(billingSyncCronRoutes);
    await api.register(boltSyncCronRoutes);
    await api.register(calendarSyncCronRoutes);
    await api.register(whmcsSyncCronRoutes);
    await api.register(whmcsRoutes);
    await api.register(calendarPublicRoutes);
    await api.register(calendarRoutes);
    await api.register(boltRoutes);
    await api.register(viaVerdeRoutes);
    await api.register(electricityRoutes);
    await api.register(combustivelRoutes);
    await api.register(uberRoutes);
    await api.register(paymentRoutes);
    await api.register(portalConnectionRoutes);
    await api.register(driverDashboardRoutes);
    await api.register(adminMgmtRoutes);
  }, { prefix: getApiPrefix() });

  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ success: false, error: formatZodError(error) });
    }
    if (error.validation) {
      const message = formatFastifyValidation(error.validation) ?? 'Validação falhou';
      return reply.status(400).send({ success: false, error: message, details: error.validation });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ success: false, error: error.message });
    }
    fastify.log.error(error);
    return reply.status(500).send({ success: false, error: 'Erro interno do servidor' });
  });

  return fastify;
}
