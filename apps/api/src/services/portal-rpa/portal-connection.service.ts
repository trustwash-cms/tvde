import type { PrismaClient, PortalKind as DbPortalKind, Prisma } from '@tvde/database';
import {
  MYPRIO_SYNC_SCOPE_LABELS,
  type MyPrioSyncScope,
  type PortalConnectionPublic,
  type PortalKind,
  type UberReportListItem,
  type UberSyncOptions,
  PORTAL_KINDS,
} from '@tvde/shared';
import { env } from '../../config/env';
import { decrypt, encrypt } from '../../lib/crypto';
import { getPortalAdapter } from './adapters';
import {
  captureStorageState,
  disposeLiveOtpSession,
  getLiveOtpSession,
  humanizePlaywrightError,
  isMissingBrowserError,
  probePlaywrightBrowser,
  registerLiveOtpSession,
  withPlaywrightPage,
  type PortalAdapter,
} from './types';
import { ingestPortalDownloadedFiles } from './ingest.service';
import { inspectUberLiveAuth, listUberReportsFromSession, preferPasswordLogin } from './uber.adapter';

type JobMeta = { syncScope?: MyPrioSyncScope; uberSync?: UberSyncOptions };

function isTransientPortalNetworkError(message: string): boolean {
  return /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ECONNRESET|ENOTFOUND|net::ERR|EAI_AGAIN|ETIMEDOUT/i.test(
    message
  );
}

/** Portais sem OTP — tentar login silencioso quando o refresh detecta sessão expirada. */
const SILENT_RELOGIN_PORTALS = new Set<PortalKind>(['via_verde']);

async function attemptSilentPortalRelogin(
  db: PrismaClient,
  connection: {
    id: string;
    usernameEncrypted: string | null;
    passwordEncrypted: string | null;
  },
  adapter: PortalAdapter
): Promise<{ ok: true; storageState: string } | { ok: false; reason: 'no_credentials' | 'needs_otp' | 'failed'; message?: string }> {
  if (!connection.usernameEncrypted || !connection.passwordEncrypted) {
    return { ok: false, reason: 'no_credentials' };
  }
  const username = decrypt(connection.usernameEncrypted);
  const password = decrypt(connection.passwordEncrypted);

  const result = await withPlaywrightPage(
    { headless: env.portalRpaHeadless, timeoutMs: 90_000 },
    async (_browser, _context, page) => adapter.login(page, username, password)
  );

  if (result.status === 'awaiting_otp') {
    return { ok: false, reason: 'needs_otp' };
  }
  if (result.status === 'failed') {
    return { ok: false, reason: 'failed', message: result.message };
  }
  if (result.status === 'connected' && result.storageState) {
    await db.portalConnection.update({
      where: { id: connection.id },
      data: {
        sessionStateEncrypted: encrypt(result.storageState),
        status: 'connected',
        lastLoginAt: new Date(),
        lastError: null,
      },
    });
    return { ok: true, storageState: result.storageState };
  }
  return { ok: false, reason: 'failed', message: 'Login não devolveu sessão' };
}

async function completeRefreshJob(
  db: PrismaClient,
  connectionId: string,
  jobId: string,
  message: string,
  storageState?: string
) {
  await db.portalSyncJob.update({
    where: { id: jobId },
    data: { status: 'completed', completedAt: new Date(), message },
  });
  await db.portalConnection.update({
    where: { id: connectionId },
    data: {
      activeJobId: null,
      status: 'connected',
      lastError: null,
      ...(storageState ? { sessionStateEncrypted: encrypt(storageState) } : {}),
    },
  });
}

async function failRefreshJobTransient(
  db: PrismaClient,
  connectionId: string,
  jobId: string,
  message: string
) {
  await db.portalSyncJob.update({
    where: { id: jobId },
    data: { status: 'failed', completedAt: new Date(), message },
  });
  await db.portalConnection.update({
    where: { id: connectionId },
    data: { activeJobId: null },
  });
}

function readJobMeta(resultJson: unknown): JobMeta {
  if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) return {};
  const raw = resultJson as { syncScope?: unknown; uberSync?: unknown };
  const meta: JobMeta = {};
  if (raw.syncScope === 'electric' || raw.syncScope === 'fleet') {
    meta.syncScope = raw.syncScope;
  }
  if (raw.uberSync && typeof raw.uberSync === 'object' && !Array.isArray(raw.uberSync)) {
    const u = raw.uberSync as Record<string, unknown>;
    if (u.mode === 'existing' || u.mode === 'generate') {
      meta.uberSync = {
        mode: u.mode,
        ...(typeof u.reportName === 'string' ? { reportName: u.reportName } : {}),
        ...(typeof u.rangeStart === 'string' ? { rangeStart: u.rangeStart } : {}),
        ...(typeof u.rangeEnd === 'string' ? { rangeEnd: u.rangeEnd } : {}),
        ...(typeof u.organizationName === 'string'
          ? { organizationName: u.organizationName }
          : {}),
      };
    }
  }
  return meta;
}

function maskUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.includes('@')) {
    const [user, domain] = raw.split('@');
    if (!user || !domain) return '***';
    return `${user.slice(0, 2)}***@${domain}`;
  }
  if (raw.length <= 3) return '***';
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

function assertRpaEnabled() {
  if (!env.portalRpaEnabled) {
    throw new Error('Portal RPA desactivado (PORTAL_RPA_ENABLED=false)');
  }
}

function toDbPortal(portal: PortalKind): DbPortalKind {
  return portal as DbPortalKind;
}

export async function listPortalConnections(
  db: PrismaClient,
  tenantId: string
): Promise<PortalConnectionPublic[]> {
  const rows = await db.portalConnection.findMany({ where: { tenantId } });
  const byPortal = new Map(rows.map((row) => [row.portal, row]));

  return Promise.all(
    PORTAL_KINDS.map((portal) => getPortalConnectionDetail(db, tenantId, portal).catch(async () => {
      return mapPublic(byPortal.get(portal) ?? null, portal);
    }))
  );
}

export async function getPortalConnectionPublic(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind
): Promise<PortalConnectionPublic> {
  return getPortalConnectionDetail(db, tenantId, portal);
}

async function mapPublic(
  row: {
    id?: string;
    portal: string;
    status: string;
    usernameEncrypted: string | null;
    sessionStateEncrypted: string | null;
    lastLoginAt: Date | null;
    lastSyncAt: Date | null;
    lastError: string | null;
    isEnabled: boolean;
    activeJobId: string | null;
  } | null,
  portal: PortalKind
): Promise<PortalConnectionPublic> {
  let usernameMasked: string | null = null;
  if (row?.usernameEncrypted) {
    try {
      usernameMasked = maskUsername(decrypt(row.usernameEncrypted));
    } catch {
      usernameMasked = '***';
    }
  }

  const browser = env.portalRpaMock
    ? { ready: true, detail: 'mock' }
    : probePlaywrightBrowser();

  return {
    portal,
    status: (row?.status as PortalConnectionPublic['status']) ?? 'disconnected',
    usernameMasked,
    hasSession: Boolean(row?.sessionStateEncrypted),
    lastLoginAt: row?.lastLoginAt?.toISOString() ?? null,
    lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    isEnabled: row?.isEnabled ?? true,
    activeJobId: row?.activeJobId ?? null,
    activeJobStatus: null,
    otpHint: null,
    authChallenge: null,
    challengeImageBase64: null,
    rpaEnabled: env.portalRpaEnabled,
    browserReady: browser.ready,
    mockMode: env.portalRpaMock,
    lastJobMessage: null,
  };
}

export async function getPortalConnectionDetail(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind
): Promise<PortalConnectionPublic> {
  let row = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });

  // Auto-heal: só browser em falta → disconnected.
  // NÃO promover error→connected só porque há sessionState (pode ser mid-OTP sem lastLoginAt).
  if (row && row.status === 'error') {
    if (
      isMissingBrowserError(row.lastError) &&
      (env.portalRpaMock || probePlaywrightBrowser().ready)
    ) {
      row = await db.portalConnection.update({
        where: { id: row.id },
        data: { status: 'disconnected', lastError: null, activeJobId: null },
      });
    }
  }

  const base = await mapPublic(row, portal);
  if (row?.activeJobId) {
    const job = await db.portalSyncJob.findUnique({ where: { id: row.activeJobId } });
    const meta =
      job?.resultJson && typeof job.resultJson === 'object' && !Array.isArray(job.resultJson)
        ? (job.resultJson as Record<string, unknown>)
        : {};
    const challengeImageBase64 =
      typeof meta.challengeImageBase64 === 'string' ? meta.challengeImageBase64 : null;
    const authChallenge =
      meta.authChallenge === 'passkey' || meta.authChallenge === 'otp'
        ? meta.authChallenge
        : challengeImageBase64
          ? 'passkey'
          : job?.status === 'awaiting_otp'
            ? 'otp'
            : null;
    return {
      ...base,
      activeJobStatus: job?.status ?? null,
      otpHint: job?.otpHint ?? null,
      lastJobMessage: job?.message ?? null,
      authChallenge,
      challengeImageBase64,
    };
  }
  return base;
}

export async function startPortalConnect(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  username: string,
  password: string,
  actorUserId: string
) {
  assertRpaEnabled();
  const connection = await db.portalConnection.upsert({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
    create: {
      tenantId,
      portal: toDbPortal(portal),
      usernameEncrypted: encrypt(username.trim()),
      passwordEncrypted: encrypt(password),
      status: 'disconnected',
    },
    update: {
      usernameEncrypted: encrypt(username.trim()),
      passwordEncrypted: encrypt(password),
      lastError: null,
    },
  });

  const job = await db.portalSyncJob.create({
    data: {
      tenantId,
      connectionId: connection.id,
      portal: toDbPortal(portal),
      type: 'connect',
      status: 'pending',
    },
  });

  await db.portalConnection.update({
    where: { id: connection.id },
    data: { activeJobId: job.id },
  });

  void runPortalJob(db, job.id, actorUserId);
  return { jobId: job.id, connection: await getPortalConnectionDetail(db, tenantId, portal) };
}

export async function submitPortalOtp(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  code: string,
  actorUserId: string
) {
  assertRpaEnabled();
  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!connection?.activeJobId) throw new Error('Nenhum desafio OTP activo');

  const job = await db.portalSyncJob.findUnique({ where: { id: connection.activeJobId } });
  if (!job || job.status !== 'awaiting_otp') throw new Error('Job não está à espera de OTP');

  await db.portalSyncJob.update({
    where: { id: job.id },
    data: { message: 'OTP recebido — a continuar…', status: 'running' },
  });

  void continueOtpJob(db, job.id, code, actorUserId);
  return getPortalConnectionDetail(db, tenantId, portal);
}

export async function startPortalSync(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  actorUserId: string,
  options?: { syncScope?: MyPrioSyncScope; uberSync?: UberSyncOptions }
) {
  assertRpaEnabled();
  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!connection) throw new Error('Conta não ligada');
  if (
    connection.status !== 'connected' &&
    connection.status !== 'error' &&
    connection.status !== 'expired'
  ) {
    throw new Error('Ligue a conta antes de sincronizar');
  }
  if (!connection.sessionStateEncrypted) throw new Error('Sem sessão guardada — volte a ligar');

  if (portal === 'myprio' && !options?.syncScope) {
    throw new Error(
      'MyPRIO exige sync separado: syncScope=electric (Eletricidade) ou syncScope=fleet (Combustível)'
    );
  }

  if (portal === 'uber' && options?.uberSync) {
    const u = options.uberSync;
    if (u.mode === 'existing' && !u.reportName?.trim()) {
      throw new Error('Uber sync: indique o relatório a descarregar (reportName)');
    }
    if (u.mode === 'generate' && (!u.rangeStart || !u.rangeEnd)) {
      throw new Error('Uber sync: rangeStart e rangeEnd são obrigatórios para gerar');
    }
    if (u.mode === 'generate' && !u.organizationName?.trim()) {
      throw new Error('Uber sync: indique a organização (organizationName) para gerar');
    }
  }

  // Jobs Playwright presos em `running` bloqueiam tsx e a UI — limpar stale
  await clearStalePortalJobs(db, connection.id);

  const fresh = await db.portalConnection.findUnique({
    where: { id: connection.id },
    select: { activeJobId: true },
  });
  if (fresh?.activeJobId) {
    const active = await db.portalSyncJob.findUnique({ where: { id: fresh.activeJobId } });
    if (active && active.status === 'awaiting_otp') {
      throw new Error(
        'Portal à espera de OTP — introduza o código SMS no login (não inicie outro sync).'
      );
    }
    if (active && (active.status === 'running' || active.status === 'pending')) {
      throw new Error(
        'Já existe um job MyPRIO em curso. Aguarde ou Desligar/Ligar se ficou preso.'
      );
    }
  }

  const syncScope = portal === 'myprio' ? options?.syncScope : undefined;
  const uberSync = portal === 'uber' ? options?.uberSync : undefined;
  const scopeLabel = syncScope ? MYPRIO_SYNC_SCOPE_LABELS[syncScope] : null;
  const uberMsg =
    uberSync?.mode === 'generate'
      ? 'A gerar relatório Uber…'
      : uberSync?.mode === 'existing'
        ? `A descarregar ${uberSync.reportName?.slice(0, 40) ?? 'relatório'}…`
        : null;

  const resultJson: Prisma.InputJsonValue | undefined =
    syncScope || uberSync
      ? ({
          ...(syncScope ? { syncScope } : {}),
          ...(uberSync ? { uberSync } : {}),
        } as Prisma.InputJsonValue)
      : undefined;

  const job = await db.portalSyncJob.create({
    data: {
      tenantId,
      connectionId: connection.id,
      portal: toDbPortal(portal),
      type: 'sync',
      status: 'pending',
      message: scopeLabel ? `A sincronizar ${scopeLabel}…` : uberMsg,
      resultJson,
    },
  });

  await db.portalConnection.update({
    where: { id: connection.id },
    data: { activeJobId: job.id, lastError: null },
  });

  void runPortalJob(db, job.id, actorUserId);
  return { jobId: job.id, connection: await getPortalConnectionDetail(db, tenantId, portal) };
}

/** Lista relatórios Uber no Supplier (sessão guardada, Playwright curto). */
export async function listUberPortalReports(
  db: PrismaClient,
  tenantId: string
): Promise<UberReportListItem[]> {
  assertRpaEnabled();
  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: 'uber' } },
  });
  if (!connection) throw new Error('Conta Uber não ligada');
  if (!connection.sessionStateEncrypted) throw new Error('Sem sessão guardada — volte a ligar');
  if (
    connection.status !== 'connected' &&
    connection.status !== 'error' &&
    connection.status !== 'expired'
  ) {
    throw new Error('Ligue a conta Uber antes de listar relatórios');
  }

  const storageState = decrypt(connection.sessionStateEncrypted);
  const uberInteractive = env.portalRpaUberInteractive;
  return withPlaywrightPage(
    {
      headless: uberInteractive ? false : env.portalRpaHeadless,
      storageStateJson: storageState,
      timeoutMs: uberInteractive ? 180_000 : 60_000,
    },
    async (_b, _context, page) => listUberReportsFromSession(page)
  );
}

const STALE_JOB_MS = 90_000;

/** Marca jobs `running`/`pending` antigos como falhados (Playwright hung). */
export async function clearStalePortalJobs(db: PrismaClient, connectionId?: string) {
  const cutoff = new Date(Date.now() - STALE_JOB_MS);
  const where = {
    status: { in: ['running', 'pending'] as Array<'running' | 'pending'> },
    OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }],
    ...(connectionId ? { connectionId } : {}),
  };
  const stale = await db.portalSyncJob.findMany({ where, select: { id: true, connectionId: true } });
  if (!stale.length) return 0;

  await db.portalSyncJob.updateMany({
    where: { id: { in: stale.map((j) => j.id) } },
    data: {
      status: 'failed',
      completedAt: new Date(),
      message: 'Job abortado (timeout / processo reiniciado). Tente Sincronizar outra vez.',
    },
  });

  const connectionIds = [...new Set(stale.map((j) => j.connectionId))];
  for (const id of connectionIds) {
    await db.portalConnection.updateMany({
      where: {
        id,
        activeJobId: { in: stale.map((j) => j.id) },
      },
      data: { activeJobId: null },
    });
  }
  console.log(`[portal-rpa] limpos ${stale.length} job(s) stale`);
  return stale.length;
}

export async function disconnectPortal(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind
) {
  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!connection) return getPortalConnectionDetail(db, tenantId, portal);

  if (connection.activeJobId) {
    await disposeLiveOtpSession(connection.activeJobId);
  }

  await db.portalConnection.update({
    where: { id: connection.id },
    data: {
      // Password + sessão Playwright removidas — próximo Ligar faz login+SMS de novo.
      // (Reutilizar cookies após «expired» fingia Home OK mas Transações caía no Login.)
      passwordEncrypted: null,
      sessionStateEncrypted: null,
      status: 'disconnected',
      lastError: null,
      activeJobId: null,
    },
  });

  return getPortalConnectionDetail(db, tenantId, portal);
}

/**
 * Limpa mensagens de erro / último sync falhado sem desligar a conta.
 * Se o job activo já terminou (failed/completed), remove a referência para não persistir o aviso.
 */
export async function clearPortalMessages(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind
) {
  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!connection) return getPortalConnectionDetail(db, tenantId, portal);

  let clearActiveJob = !connection.activeJobId;
  if (connection.activeJobId) {
    const job = await db.portalSyncJob.findUnique({
      where: { id: connection.activeJobId },
    });
    const done =
      !job || job.status === 'failed' || job.status === 'completed';
    clearActiveJob = done;
    // Não limpar se ainda há job a correr / OTP
    if (!done) {
      throw new Error('Há uma operação em curso — aguarde ou cancele antes de limpar');
    }
  }

  await db.portalConnection.update({
    where: { id: connection.id },
    data: {
      lastError: null,
      ...(clearActiveJob ? { activeJobId: null } : {}),
    },
  });

  return getPortalConnectionDetail(db, tenantId, portal);
}

export async function getPortalJob(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  jobId: string
) {
  const job = await db.portalSyncJob.findFirst({
    where: { id: jobId, tenantId, portal: toDbPortal(portal) },
  });
  if (!job) throw new Error('Job não encontrado');
  return job;
}

async function runPortalJob(db: PrismaClient, jobId: string, actorUserId: string) {
  const job = await db.portalSyncJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  await db.portalSyncJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt: new Date() },
  });

  const connection = await db.portalConnection.findUnique({ where: { id: job.connectionId } });
  if (!connection) return;

  const portal = job.portal as PortalKind;
  const adapter = getPortalAdapter(portal, env.portalRpaMock);

  try {
    if (job.type === 'connect') {
      if (!connection.usernameEncrypted || !connection.passwordEncrypted) {
        throw new Error('Credenciais em falta');
      }
      const username = decrypt(connection.usernameEncrypted);
      const password = decrypt(connection.passwordEncrypted);

      if (env.portalRpaMock) {
        const phase = await adapter.login(null as never, username, password);
        if (phase.status === 'awaiting_otp') {
          await db.portalConnection.update({
            where: { id: connection.id },
            data: {
              sessionStateEncrypted: phase.storageState ? encrypt(phase.storageState) : null,
              status: 'awaiting_otp',
            },
          });
          await db.portalSyncJob.update({
            where: { id: jobId },
            data: {
              status: 'awaiting_otp',
              otpHint: phase.otpHint ?? 'Introduza o OTP recebido',
              message: phase.otpHint ?? 'À espera de OTP',
            },
          });
          return;
        }
        if (phase.status === 'failed') {
          await failJob(db, connection.id, jobId, phase.message);
          return;
        }
        if (!phase.storageState) {
          await failJob(db, connection.id, jobId, 'Login mock sem storageState');
          return;
        }
        await db.portalConnection.update({
          where: { id: connection.id },
          data: {
            sessionStateEncrypted: encrypt(phase.storageState),
            status: 'connected',
            lastLoginAt: new Date(),
            lastError: null,
            activeJobId: null,
          },
        });
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: { status: 'completed', completedAt: new Date(), message: 'Conta ligada (mock)' },
        });
        return;
      }

      // Reutilizar sessão Playwright guardada (evita SMS se cookies ainda forem válidos)
      if (connection.sessionStateEncrypted) {
        try {
          const existingSession = decrypt(connection.sessionStateEncrypted);
          const resumed = await withPlaywrightPage(
            { headless: env.portalRpaHeadless, storageStateJson: existingSession },
            async (_browser, context, page) => {
              const status = await adapter.refresh(context, page);
              if (status !== 'ok') return { ok: false as const };
              return {
                ok: true as const,
                storageState: await captureStorageState(context),
              };
            }
          );
          if (resumed.ok) {
            await db.portalConnection.update({
              where: { id: connection.id },
              data: {
                sessionStateEncrypted: encrypt(resumed.storageState),
                status: 'connected',
                lastLoginAt: new Date(),
                lastError: null,
                activeJobId: null,
              },
            });
            await db.portalSyncJob.update({
              where: { id: jobId },
              data: {
                status: 'completed',
                completedAt: new Date(),
                message: 'Sessão reutilizada (sem SMS)',
              },
            });
            return;
          }
        } catch {
          // Sessão inválida — continua para login completo
        }
      }

      const uberInteractive = portal === 'uber' && env.portalRpaUberInteractive;
      const result = await withPlaywrightPage(
        {
          // Uber: Chromium visível para o gestor completar Continuar / SMS / OTP
          headless: uberInteractive ? false : env.portalRpaHeadless,
          keepAlive: true,
          // Interactivo: até 10 min; automático: 4 min
          timeoutMs: uberInteractive ? 600_000 : 240_000,
        },
        async (browser, context, page) => {
          const phase = await adapter.login(page, username, password);
          if (phase.status === 'awaiting_otp' || phase.status === 'awaiting_passkey') {
            await registerLiveOtpSession(jobId, browser, context, page);
          }
          return { phase, browser, context };
        }
      );

      if (result.phase.status === 'awaiting_passkey') {
        if (result.phase.storageState) {
          await db.portalConnection.update({
            where: { id: connection.id },
            data: {
              sessionStateEncrypted: encrypt(result.phase.storageState),
              status: 'awaiting_otp',
              lastError: null,
            },
          });
        } else {
          await db.portalConnection.update({
            where: { id: connection.id },
            data: { status: 'awaiting_otp', lastError: null },
          });
        }
        const hint =
          result.phase.hint ??
          'Digitalize o QR passkey com o telemóvel. Depois pode ser pedido OTP SMS.';
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint: hint,
            message: hint,
            resultJson: {
              authChallenge: 'passkey',
              challengeImageBase64: result.phase.challengeImageBase64,
            },
          },
        });
        void watchLiveUberAuthChallenge(db, connection.id, jobId);
        return;
      }

      if (result.phase.status === 'awaiting_otp') {
        if (result.phase.storageState) {
          await db.portalConnection.update({
            where: { id: connection.id },
            data: {
              sessionStateEncrypted: encrypt(result.phase.storageState),
              status: 'awaiting_otp',
            },
          });
        } else {
          await db.portalConnection.update({
            where: { id: connection.id },
            data: { status: 'awaiting_otp' },
          });
        }
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint: result.phase.otpHint ?? 'Introduza o OTP recebido',
            message: result.phase.otpHint ?? 'À espera de OTP',
            resultJson: { authChallenge: 'otp' },
          },
        });
        return;
      }

      await result.browser.close().catch(() => undefined);

      if (result.phase.status === 'failed') {
        await failJob(db, connection.id, jobId, result.phase.message);
        return;
      }

      if (!result.phase.storageState) {
        await failJob(db, connection.id, jobId, 'Login Uber sem storageState');
        return;
      }

      await db.portalConnection.update({
        where: { id: connection.id },
        data: {
          sessionStateEncrypted: encrypt(result.phase.storageState),
          status: 'connected',
          lastLoginAt: new Date(),
          lastError: null,
          activeJobId: null,
        },
      });
      await db.portalSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          message: 'Conta ligada',
        },
      });
      return;
    }

    if (job.type === 'sync' || job.type === 'refresh') {
      if (job.type === 'refresh' && !connection.sessionStateEncrypted) {
        if (SILENT_RELOGIN_PORTALS.has(portal)) {
          const relogin = await attemptSilentPortalRelogin(db, connection, adapter);
          if (relogin.ok) {
            await completeRefreshJob(
              db,
              connection.id,
              jobId,
              'Sessão renovada (re-login automático)',
              relogin.storageState
            );
            return;
          }
          await db.portalConnection.update({
            where: { id: connection.id },
            data: {
              status: 'expired',
              lastError: relogin.message ?? 'Sessão expirada — volte a ligar',
              activeJobId: null,
            },
          });
          await db.portalSyncJob.update({
            where: { id: jobId },
            data: {
              status: 'failed',
              completedAt: new Date(),
              message: relogin.message ?? 'Sessão expirada',
            },
          });
          return;
        }
        throw new Error('Sem sessão');
      }

      if (!connection.sessionStateEncrypted) throw new Error('Sem sessão');
      const storageState = decrypt(connection.sessionStateEncrypted);

      if (job.type === 'refresh') {
        try {
          const refreshResult = await withPlaywrightPage(
            { headless: env.portalRpaHeadless, storageStateJson: storageState },
            async (_b, context, page) => {
              const status = await adapter.refresh(context, page);
              if (status === 'expired') return { status: 'expired' as const };
              return {
                status: 'ok' as const,
                storageState: await captureStorageState(context),
              };
            }
          );

          if (refreshResult.status === 'expired') {
            if (SILENT_RELOGIN_PORTALS.has(portal)) {
              const relogin = await attemptSilentPortalRelogin(db, connection, adapter);
              if (relogin.ok) {
                await completeRefreshJob(
                  db,
                  connection.id,
                  jobId,
                  'Sessão renovada (re-login automático)',
                  relogin.storageState
                );
                return;
              }
              if (relogin.reason === 'failed') {
                await db.portalConnection.update({
                  where: { id: connection.id },
                  data: {
                    status: 'expired',
                    lastError: relogin.message ?? 'Sessão expirada — volte a ligar',
                    activeJobId: null,
                  },
                });
                await db.portalSyncJob.update({
                  where: { id: jobId },
                  data: {
                    status: 'failed',
                    completedAt: new Date(),
                    message: relogin.message ?? 'Sessão expirada',
                  },
                });
                return;
              }
            }

            await db.portalConnection.update({
              where: { id: connection.id },
              data: { status: 'expired', lastError: 'Sessão expirada', activeJobId: null },
            });
            await db.portalSyncJob.update({
              where: { id: jobId },
              data: { status: 'failed', completedAt: new Date(), message: 'Sessão expirada' },
            });
            return;
          }

          await completeRefreshJob(
            db,
            connection.id,
            jobId,
            'Sessão renovada',
            refreshResult.storageState
          );
        } catch (err) {
          const message = humanizePlaywrightError(err);
          if (isTransientPortalNetworkError(message)) {
            await failRefreshJobTransient(db, connection.id, jobId, message);
            return;
          }
          throw err;
        }
        return;
      }

      const jobMeta = readJobMeta(job.resultJson);
      const uberInteractive = portal === 'uber' && env.portalRpaUberInteractive;
      const syncTimeoutMs =
        portal === 'uber' ? 900_000 : portal === 'myprio' ? 55_000 : 90_000;
      console.log(
        `[portal-rpa] sync start portal=${portal} scope=${jobMeta.syncScope ?? '-'} uber=${jobMeta.uberSync?.mode ?? '-'} interactive=${uberInteractive} headless=${uberInteractive ? false : env.portalRpaHeadless} timeout=${syncTimeoutMs}ms`
      );
      const syncResult = await withPlaywrightPage(
        {
          headless: uberInteractive ? false : env.portalRpaHeadless,
          storageStateJson: storageState,
          timeoutMs: syncTimeoutMs,
        },
        async (_b, context, page) =>
          adapter.sync(context, page, {
            syncScope: jobMeta.syncScope,
            uberSync: jobMeta.uberSync,
            onProgress: async (message) => {
              await db.portalSyncJob
                .update({
                  where: { id: jobId },
                  data: { message },
                })
                .catch(() => undefined);
            },
          })
      );
      console.log(`[portal-rpa] sync end portal=${portal} status=${syncResult.status}`);

      if (syncResult.status === 'expired') {
        await db.portalConnection.update({
          where: { id: connection.id },
          data: { status: 'expired', lastError: syncResult.message, activeJobId: null },
        });
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: { status: 'failed', completedAt: new Date(), message: syncResult.message },
        });
        return;
      }

      if (syncResult.status === 'failed') {
        await db.portalConnection.update({
          where: { id: connection.id },
          data: {
            status: 'connected',
            lastError: syncResult.message,
            activeJobId: jobId,
          },
        });
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            message: syncResult.message,
          },
        });
        return;
      }

      const summary = await ingestPortalDownloadedFiles(
        db,
        connection.tenantId,
        portal,
        actorUserId,
        syncResult.files
      );

      const empty = summary.inserted === 0 && summary.skipped === 0;
      const warningSuffix =
        syncResult.status === 'ok' && syncResult.warnings?.length
          ? ` · ${syncResult.warnings.join(' ')}`
          : '';
      const scopePrefix = jobMeta.syncScope
        ? `${MYPRIO_SYNC_SCOPE_LABELS[jobMeta.syncScope]}: `
        : '';
      const message =
        scopePrefix +
        (summary.message ||
          `Sync: ${summary.inserted} inseridos, ${summary.skipped} ignorados (duplicados), ${summary.failed} falhados`) +
        warningSuffix;

      if (empty) {
        const emptyMsg =
          portal === 'myprio'
            ? summary.message ||
              `${scopePrefix}Sync sem movimentos parseáveis. O export pode ter vindo vazio (filtro INÍCIO/FIM). Tente de novo ou import manual XLSX.`
              : portal === 'via_verde'
              ? 'Sync sem movimentos (0 inseridos / 0 ignorados). Verifique filtros no portal Via Verde.'
              : portal === 'uber'
                ? `Sync Uber sem movimentos parseáveis${warningSuffix}. Confirme que o CSV é «Transação de pagamentos» (não driver_activity).`
                : 'Sync sem movimentos parseáveis. Tente de novo ou use import manual.';
        await db.portalConnection.update({
          where: { id: connection.id },
          data: {
            status: 'connected',
            lastError: emptyMsg,
            activeJobId: jobId,
          },
        });
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            message: emptyMsg,
            resultJson: { ...jobMeta, ...summary } as unknown as Prisma.InputJsonValue,
          },
        });
        return;
      }

      await db.portalConnection.update({
        where: { id: connection.id },
        data: {
          status: 'connected',
          lastSyncAt: new Date(),
          lastError: null,
          activeJobId: jobId,
        },
      });
      await db.portalSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          message,
          resultJson: { ...jobMeta, ...summary } as unknown as Prisma.InputJsonValue,
        },
      });
    }
  } catch (err) {
    await failJob(db, connection.id, jobId, humanizePlaywrightError(err));
  }
}

async function continueOtpJob(
  db: PrismaClient,
  jobId: string,
  code: string,
  _actorUserId: string
) {
  const job = await db.portalSyncJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const connection = await db.portalConnection.findUnique({ where: { id: job.connectionId } });
  if (!connection) return;

  const portal = job.portal as PortalKind;
  const adapter = getPortalAdapter(portal, env.portalRpaMock);

  try {
    if (env.portalRpaMock) {
      const adapter = getPortalAdapter(portal, true);
      const result = await adapter.submitOtp(null as never, code);
      if (result.status === 'failed') {
        await failJob(db, connection.id, jobId, result.message);
        return;
      }
      if (result.status === 'awaiting_otp') {
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint: result.otpHint ?? 'OTP adicional necessário',
          },
        });
        return;
      }
      if (!result.storageState) {
        await failJob(db, connection.id, jobId, 'OTP mock sem storageState');
        return;
      }
      await db.portalConnection.update({
        where: { id: connection.id },
        data: {
          sessionStateEncrypted: encrypt(result.storageState),
          status: 'connected',
          lastLoginAt: new Date(),
          lastError: null,
          activeJobId: null,
        },
      });
      await db.portalSyncJob.update({
        where: { id: jobId },
        data: { status: 'completed', completedAt: new Date(), message: 'Conta ligada após OTP (mock)' },
      });
      return;
    }

    const live = getLiveOtpSession(jobId);
    let result;

    if (!live) {
      // Sem browser vivo o modal SMS já não existe — cookies mid-OTP não chegam.
      await failJob(
        db,
        connection.id,
        jobId,
        'Sessão OTP no servidor já não está aberta (API reiniciou ou o job expirou). Desligar → Ligar conta para receber SMS novo.'
      );
      return;
    }

    result = await adapter.submitOtp(live.page, code);

    // Uber: após OTP → «Iniciar sessão com a palavra-passe»
    if (portal === 'uber' && result.status !== 'awaiting_otp') {
      const pwd = connection.passwordEncrypted ? decrypt(connection.passwordEncrypted) : '';
      if (pwd) {
        await preferPasswordLogin(live.page, pwd);
        const url = live.page.url();
        if (url.includes('supplier.uber.com') && !url.includes('auth.uber.com')) {
          result = {
            status: 'connected' as const,
            storageState: await captureStorageState(live.context),
          };
        }
      }
    }

    if (result.status === 'connected') {
      const storageState =
        ('storageState' in result && result.storageState) ||
        (await live.context.storageState().then(JSON.stringify));
      result = { status: 'connected' as const, storageState };
    }
    if (result.status !== 'awaiting_otp') {
      await disposeLiveOtpSession(jobId);
    }

    if (result.status === 'failed') {
      await disposeLiveOtpSession(jobId);
      await failJob(db, connection.id, jobId, result.message);
      return;
    }

    if (result.status === 'awaiting_otp') {
      await db.portalSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'awaiting_otp',
          otpHint: result.otpHint ?? 'OTP adicional necessário',
        },
      });
      return;
    }

    if (result.status !== 'connected' || !result.storageState) {
      await disposeLiveOtpSession(jobId);
      await failJob(db, connection.id, jobId, 'OTP aceite mas sem storageState');
      return;
    }

    await db.portalConnection.update({
      where: { id: connection.id },
      data: {
        sessionStateEncrypted: encrypt(result.storageState),
        status: 'connected',
        lastLoginAt: new Date(),
        lastError: null,
        activeJobId: null,
      },
    });
    await db.portalSyncJob.update({
      where: { id: jobId },
      data: { status: 'completed', completedAt: new Date(), message: 'Conta ligada após OTP' },
    });
  } catch (err) {
    await disposeLiveOtpSession(jobId);
    await failJob(db, connection.id, jobId, humanizePlaywrightError(err));
  }
}

async function failJob(
  db: PrismaClient,
  connectionId: string,
  jobId: string,
  message: string
) {
  await disposeLiveOtpSession(jobId);
  // Timeout de sync ≠ conta partida — manter "connected" para não forçar re-Ligar
  const keepConnected = /Timeout Playwright|sync abortado/i.test(message);
  // OTP/login falhou: limpar cookies mid-OTP para o próximo Ligar fazer SMS completo
  const clearSession =
    !keepConnected &&
    /OTP|SMS|Login|login|Formulário|chrome-error|Sessão OTP|não autentic|passkey/i.test(message);

  await db.portalConnection.update({
    where: { id: connectionId },
    data: {
      status: keepConnected ? 'connected' : 'error',
      lastError: message,
      activeJobId: null,
      ...(clearSession ? { sessionStateEncrypted: null } : {}),
    },
  });
  await db.portalSyncJob.update({
    where: { id: jobId },
    data: { status: 'failed', completedAt: new Date(), message },
  });
}

/**
 * Enquanto o gestor digitaliza o QR passkey no telemóvel, o browser Playwright fica aberto.
 * Quando a página avança → connected ou pede OTP SMS.
 */
async function watchLiveUberAuthChallenge(
  db: PrismaClient,
  connectionId: string,
  jobId: string
) {
  const deadline = Date.now() + 5 * 60_000;
  const connection = await db.portalConnection.findUnique({ where: { id: connectionId } });
  const password = connection?.passwordEncrypted ? decrypt(connection.passwordEncrypted) : '';

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const live = getLiveOtpSession(jobId);
    if (!live || live.page.isClosed()) {
      await failJob(db, connectionId, jobId, 'Sessão passkey Uber expirou (browser fechou). Ligar conta outra vez.');
      return;
    }

    try {
      const state = await inspectUberLiveAuth(live.page, password);
      console.log(`[uber-passkey-watch] state=${state}`);

      if (state === 'connected') {
        const storageState = await captureStorageState(live.context);
        await disposeLiveOtpSession(jobId);
        await db.portalConnection.update({
          where: { id: connectionId },
          data: {
            sessionStateEncrypted: encrypt(storageState),
            status: 'connected',
            lastLoginAt: new Date(),
            lastError: null,
            activeJobId: null,
          },
        });
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            message: 'Conta ligada (passkey)',
            resultJson: { authChallenge: null },
          },
        });
        return;
      }

      if (state === 'otp') {
        await db.portalConnection.update({
          where: { id: connectionId },
          data: { status: 'awaiting_otp', lastError: null },
        });
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint: 'Passkey OK — introduza agora o código SMS de 4 dígitos da Uber',
            message: 'À espera de OTP SMS (após passkey)',
            resultJson: { authChallenge: 'otp', challengeImageBase64: null },
          },
        });
        return;
      }

      if (state === 'password' && password) {
        const pass = live.page.locator('input[type="password"]').first();
        if (await pass.isVisible().catch(() => false)) {
          await pass.fill(password);
          const btn = live.page.getByRole('button', { name: /continuar|seguinte|next/i }).first();
          const label = ((await btn.innerText().catch(() => '')) || '').toLowerCase();
          if (!/google|apple|chave|passkey/.test(label)) {
            await btn.click({ timeout: 8000 }).catch(() => undefined);
          }
          await live.page.waitForTimeout(1500);
        }
      }
    } catch (err) {
      console.error('[uber-passkey-watch]', err instanceof Error ? err.message : err);
    }
  }

  await failJob(
    db,
    connectionId,
    jobId,
    'Timeout à espera do passkey (5 min). Digitalize o QR a tempo ou Ligar conta outra vez.'
  );
}

/** Renova sessões ligadas (cron). */
export async function refreshAllPortalSessions(db: PrismaClient) {
  if (!env.portalRpaEnabled || env.portalRpaMock) return [];

  const connections = await db.portalConnection.findMany({
    where: {
      isEnabled: true,
      activeJobId: null,
      OR: [
        {
          status: { in: ['connected', 'error'] },
          sessionStateEncrypted: { not: null },
        },
        {
          status: 'expired',
          portal: 'via_verde',
          usernameEncrypted: { not: null },
          passwordEncrypted: { not: null },
        },
      ],
    },
  });

  const results: Array<{ portal: string; tenantId: string; ok: boolean }> = [];

  for (const connection of connections) {
    const job = await db.portalSyncJob.create({
      data: {
        tenantId: connection.tenantId,
        connectionId: connection.id,
        portal: connection.portal,
        type: 'refresh',
        status: 'pending',
      },
    });
    await runPortalJob(db, job.id, '00000000-0000-0000-0000-000000000000');
    const updated = await db.portalConnection.findUnique({ where: { id: connection.id } });
    results.push({
      portal: connection.portal,
      tenantId: connection.tenantId,
      ok: updated?.status === 'connected',
    });
  }

  return results;
}
