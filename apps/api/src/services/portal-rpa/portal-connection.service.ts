import type { PrismaClient, PortalKind as DbPortalKind, Prisma } from '@tvde/database';
import {
  MYPRIO_SYNC_SCOPE_LABELS,
  type MyPrioSyncScope,
  type PortalConnectionPublic,
  type PortalKind,
  type UberReportListItem,
  type UberSyncOptions,
  PORTAL_KINDS,
  PORTAL_KIND_LABELS,
} from '@tvde/shared';
import { env } from '../../config/env';
import { canDecrypt, decrypt, encrypt, isCryptoAuthFailure } from '../../lib/crypto';
import { getPortalAdapter } from './adapters';
import {
  captureStorageState,
  disposeLiveOtpSession,
  getLiveOtpSession,
  humanizePlaywrightError,
  isInfraBrowserError,
  probePlaywrightBrowser,
  registerLiveOtpSession,
  touchLiveOtpSession,
  withPlaywrightPage,
  type PortalAdapter,
} from './types';

/** Mensagem PT quando ENCRYPTION_KEY mudou ou ciphertext do portal está corrompido. */
export const PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE =
  'Password guardada ilegível (chave de encriptação mudou). ' +
  'Clique em «Esquecer password» e volte a Ligar conta com a password correcta.';

export const PORTAL_SESSION_NEEDS_RESAVE_MESSAGE =
  'Sessão guardada ilegível (chave de encriptação mudou). Volte a Ligar conta.';

function decryptPortalField(
  payload: string,
  kind: 'username' | 'password' | 'session'
): string {
  try {
    return decrypt(payload);
  } catch (err) {
    if (isCryptoAuthFailure(err)) {
      if (kind === 'session') throw new Error(PORTAL_SESSION_NEEDS_RESAVE_MESSAGE);
      if (kind === 'username') {
        throw new Error(
          'Utilizador guardado ilegível (chave de encriptação mudou). ' +
            'Introduza o utilizador de novo e volte a Ligar conta.'
        );
      }
      throw new Error(PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE);
    }
    throw err;
  }
}

function isPortalCryptoErrorMessage(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return (
    /unsupported state or unable to authenticate/i.test(msg) ||
    /unable to authenticate data/i.test(msg) ||
    /Password guardada ilegível|Sessão guardada ilegível|Utilizador guardado ilegível/i.test(msg) ||
    /chave de encriptação mudou/i.test(msg)
  );
}
import { ingestPortalDownloadedFiles } from './ingest.service';
import {
  inspectUberLiveAuth,
  isBotChallengeVisuallyReady,
  isStuckOnEmptyIdentity,
  isUberPasswordScreen,
  listUberReportsFromSession,
  nudgeBotChallengePaint,
  preferPasswordLogin,
  canHandoffBotChallenge,
  hasActiveArkoseOverlay,
} from './uber.adapter';

type JobMeta = { syncScope?: MyPrioSyncScope; uberSync?: UberSyncOptions };

function isTransientPortalNetworkError(message: string): boolean {
  return /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ECONNRESET|ENOTFOUND|net::ERR|EAI_AGAIN|ETIMEDOUT/i.test(
    message
  );
}

/** Portais onde tentamos login silencioso (email+password) quando a sessão expira. Uber pode pedir OTP SMS. */
const SILENT_RELOGIN_PORTALS = new Set<PortalKind>(['via_verde', 'uber']);

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
  let username: string;
  let password: string;
  try {
    username = decryptPortalField(connection.usernameEncrypted, 'username');
    password = decryptPortalField(connection.passwordEncrypted, 'password');
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE,
    };
  }

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
  if (raw.syncScope === 'electric' || raw.syncScope === 'fleet' || raw.syncScope === 'both') {
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
    passwordEncrypted?: string | null;
    sessionStateEncrypted: string | null;
    lastLoginAt: Date | null;
    lastSyncAt: Date | null;
    lastError: string | null;
    isEnabled: boolean;
    autoSyncEnabled: boolean;
    activeJobId: string | null;
  } | null,
  portal: PortalKind
): Promise<PortalConnectionPublic> {
  let usernameMasked: string | null = null;
  if (row?.usernameEncrypted) {
    try {
      usernameMasked = maskUsername(decryptPortalField(row.usernameEncrypted, 'username'));
    } catch {
      usernameMasked = '***';
    }
  }

  const browser = env.portalRpaMock
    ? { ready: true, detail: 'mock' }
    : probePlaywrightBrowser();

  const hasPassword = Boolean(row?.passwordEncrypted);
  const passwordNeedsResave = hasPassword && !canDecrypt(row?.passwordEncrypted);
  const sessionUnreadable =
    Boolean(row?.sessionStateEncrypted) && !canDecrypt(row?.sessionStateEncrypted);

  // Infra ≠ conta: não expor lastError de browser/libs se o Chromium já está OK
  let lastError = row?.lastError ?? null;
  if (browser.ready && isInfraBrowserError(lastError)) {
    lastError = null;
  }
  if (passwordNeedsResave) {
    lastError = PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE;
  } else if (sessionUnreadable && isPortalCryptoErrorMessage(lastError)) {
    lastError = PORTAL_SESSION_NEEDS_RESAVE_MESSAGE;
  } else if (isPortalCryptoErrorMessage(lastError)) {
    lastError = /Sessão guardada ilegível/i.test(lastError ?? '')
      ? PORTAL_SESSION_NEEDS_RESAVE_MESSAGE
      : PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE;
  }

  let status = (row?.status as PortalConnectionPublic['status']) ?? 'disconnected';
  // Crypto ilegível ≠ crash misterioso — mostrar «Sessão expirada» em vez de «Erro»
  if (passwordNeedsResave && status === 'error') {
    status = 'expired';
  }

  return {
    portal,
    status,
    usernameMasked,
    hasSession: Boolean(row?.sessionStateEncrypted) && !sessionUnreadable,
    hasPassword,
    passwordNeedsResave,
    lastLoginAt: row?.lastLoginAt?.toISOString() ?? null,
    lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    lastError,
    isEnabled: row?.isEnabled ?? true,
    autoSyncEnabled: row?.autoSyncEnabled ?? false,
    activeJobId: row?.activeJobId ?? null,
    activeJobStatus: null,
    otpHint: null,
    authChallenge: null,
    challengeImageBase64: null,
    rpaEnabled: env.portalRpaEnabled,
    browserReady: browser.ready,
    browserDetail: env.portalRpaMock ? 'mock' : browser.detail,
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

  // Auto-heal: erro de infra (browser/libs) não deve deixar a conta em «Erro» para sempre.
  // Estado da conta = credenciais/sessão; readiness do browser vem em browserReady.
  if (row && isInfraBrowserError(row.lastError)) {
    if (env.portalRpaMock || probePlaywrightBrowser().ready) {
      const nextStatus =
        row.status === 'error'
          ? row.sessionStateEncrypted
            ? 'connected'
            : 'disconnected'
          : row.status;
      row = await db.portalConnection.update({
        where: { id: row.id },
        data: {
          lastError: null,
          status: nextStatus,
          ...(row.status === 'error' ? { activeJobId: null } : {}),
        },
      });
    }
  }

  // Auto-heal: raw AES-GCM / ENCRYPTION_KEY mismatch → mensagem PT + status expirado
  if (row) {
    const passwordBad = Boolean(row.passwordEncrypted) && !canDecrypt(row.passwordEncrypted);
    const sessionBad =
      Boolean(row.sessionStateEncrypted) && !canDecrypt(row.sessionStateEncrypted);
    const rawCrypto = isPortalCryptoErrorMessage(row.lastError);
    if (passwordBad || sessionBad || rawCrypto) {
      const nextError = passwordBad
        ? PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE
        : sessionBad
          ? PORTAL_SESSION_NEEDS_RESAVE_MESSAGE
          : /Sessão guardada ilegível/i.test(row.lastError ?? '')
            ? PORTAL_SESSION_NEEDS_RESAVE_MESSAGE
            : PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE;
      const nextStatus =
        row.status === 'error' ? 'expired' : row.status;
      if (row.lastError !== nextError || row.status !== nextStatus) {
        row = await db.portalConnection.update({
          where: { id: row.id },
          data: {
            lastError: nextError,
            status: nextStatus,
            ...(sessionBad ? { sessionStateEncrypted: null } : {}),
          },
        });
      }
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
    let authChallenge: 'passkey' | 'otp' | 'bot' | 'password' | null =
      meta.authChallenge === 'passkey' ||
      meta.authChallenge === 'otp' ||
      meta.authChallenge === 'bot' ||
      meta.authChallenge === 'password'
        ? (meta.authChallenge as 'passkey' | 'otp' | 'bot' | 'password')
        : challengeImageBase64
          ? 'passkey'
          : job?.status === 'awaiting_otp'
            ? /OTP OK|password|palavra-?passe/i.test(job.otpHint ?? '')
              ? 'password'
              : /anti-bot|desafio|Arkose|Proteger a sua conta/i.test(job.otpHint ?? job.message ?? '')
                ? 'bot'
                : /preencher email|A preencher/i.test(job.message ?? '')
                  ? null
                  : 'otp'
            : null;

    if (
      portal === 'uber' &&
      row.activeJobId &&
      job &&
      (job.status === 'running' || job.status === 'awaiting_otp')
    ) {
      const live = getLiveOtpSession(row.activeJobId);
      if (live && !live.page.isClosed()) {
        const liveState = await inspectUberLiveAuth(live.page).catch(() => null);
        if (liveState === 'bot') authChallenge = 'bot';
        else if (liveState === 'otp') authChallenge = 'otp';
        else if (liveState === 'password') authChallenge = 'password';
        else if (liveState === 'passkey') authChallenge = 'passkey';
      }
    }

    return {
      ...base,
      activeJobStatus: job?.status ?? null,
      otpHint: job?.otpHint ?? null,
      lastJobMessage: job?.message ?? null,
      authChallenge,
      challengeImageBase64,
    };
  }

  // Sem activeJobId: ainda devolver a mensagem do último job falhado (recente)
  // para a UI sair do spinner — sem marcar activeJobStatus=failed (evita falso positivo
  // ao abrir «Ligar» outra vez).
  if (row) {
    const latest = await db.portalSyncJob.findFirst({
      where: { connectionId: row.id },
      orderBy: { createdAt: 'desc' },
    });
    if (latest?.status === 'failed') {
      const ageMs = Date.now() - new Date(latest.completedAt ?? latest.updatedAt).getTime();
      if (ageMs < 10 * 60 * 1000) {
        const jobMsg = isPortalCryptoErrorMessage(latest.message)
          ? /Sessão guardada ilegível/i.test(latest.message ?? '')
            ? PORTAL_SESSION_NEEDS_RESAVE_MESSAGE
            : PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE
          : latest.message ?? null;
        return {
          ...base,
          lastJobMessage: jobMsg,
          lastError: base.lastError ?? jobMsg,
        };
      }
    }
  }
  return base;
}

export async function startPortalConnect(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  username: string,
  password: string,
  actorUserId: string,
  options?: { useStoredCredentials?: boolean }
) {
  assertRpaEnabled();
  const existing = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });

  const useStored = Boolean(options?.useStoredCredentials);
  let resolvedUsername = username.trim();
  let resolvedPassword = password;

  if (useStored || (!resolvedUsername && existing?.usernameEncrypted)) {
    if (!resolvedUsername) {
      if (!existing?.usernameEncrypted) {
        throw new Error('Utilizador em falta — não há credencial guardada');
      }
      resolvedUsername = decryptPortalField(existing.usernameEncrypted, 'username');
    }
  }

  if (useStored || (!resolvedPassword && existing?.passwordEncrypted)) {
    if (!resolvedPassword) {
      if (!existing?.passwordEncrypted) {
        throw new Error('Password em falta — não há password guardada');
      }
      if (!canDecrypt(existing.passwordEncrypted)) {
        throw new Error(PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE);
      }
      resolvedPassword = decryptPortalField(existing.passwordEncrypted, 'password');
    }
  }

  if (!resolvedUsername) {
    throw new Error('Utilizador em falta');
  }
  if (portal !== 'uber' && !resolvedPassword) {
    throw new Error('Password em falta');
  }

  const connection = await db.portalConnection.upsert({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
    create: {
      tenantId,
      portal: toDbPortal(portal),
      usernameEncrypted: encrypt(resolvedUsername),
      passwordEncrypted: resolvedPassword ? encrypt(resolvedPassword) : null,
      status: 'disconnected',
    },
    update: {
      usernameEncrypted: encrypt(resolvedUsername),
      ...(resolvedPassword ? { passwordEncrypted: encrypt(resolvedPassword) } : {}),
      lastError: null,
      // Ao religar, sair do estado «expired» para o poll do login rápido não falhar já
      status: 'disconnected',
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
    data: { activeJobId: job.id, lastError: null },
  });

  void runPortalJob(db, job.id, actorUserId);
  return { jobId: job.id, connection: await getPortalConnectionDetail(db, tenantId, portal) };
}

/**
 * Remove só a password encriptada. Mantém username e sessão Playwright.
 * Distinto de disconnectPortal (password + sessão).
 */
export async function forgetPortalPassword(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind
) {
  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!connection) return getPortalConnectionDetail(db, tenantId, portal);

  await db.portalConnection.update({
    where: { id: connection.id },
    data: {
      passwordEncrypted: null,
      ...(isPortalCryptoErrorMessage(connection.lastError)
        ? {
            lastError: null,
            status: connection.status === 'error' ? 'expired' : connection.status,
          }
        : {}),
    },
  });

  return getPortalConnectionDetail(db, tenantId, portal);
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
  if (!job) throw new Error('Job não está à espera de OTP');

  if (job.status === 'running') {
    const msg = job.message ?? '';
    if (/OTP recebido/i.test(msg)) {
      return getPortalConnectionDetail(db, tenantId, portal);
    }
    const startedAt = job.startedAt?.getTime() ?? job.updatedAt?.getTime() ?? 0;
    if (startedAt > 0 && Date.now() - startedAt > 120_000) {
      await db.portalSyncJob.update({
        where: { id: job.id },
        data: { status: 'awaiting_otp', message: 'OTP expirou — introduza o código SMS outra vez' },
      });
    } else {
      throw new Error('OTP em validação no servidor — aguarde ~30s ou feche e use «Introduzir OTP»');
    }
  } else if (job.status !== 'awaiting_otp') {
    throw new Error('Job não está à espera de OTP — use Desligar e Ligar conta outra vez');
  }

  await db.portalSyncJob.update({
    where: { id: job.id },
    data: { message: 'OTP recebido — a continuar…', status: 'running' },
  });

  console.log(`[portal-otp] ${portal} job=${job.id} código recebido (${code.replace(/\d/g, '•')})`);
  void continueOtpJob(db, job.id, code, actorUserId);
  return getPortalConnectionDetail(db, tenantId, portal);
}

/**
 * Uber pós-OTP: submeter palavra-passe no browser vivo (quando não há password guardada
 * ou a auto-fill falhou).
 */
export async function submitPortalPassword(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  password: string,
  actorUserId: string
) {
  assertRpaEnabled();
  if (portal !== 'uber') throw new Error('Password pós-OTP só aplica à Uber');
  if (!password.trim()) throw new Error('Password em falta');

  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!connection?.activeJobId) throw new Error('Nenhum desafio de password activo');

  const job = await db.portalSyncJob.findUnique({ where: { id: connection.activeJobId } });
  if (!job || job.status !== 'awaiting_otp') {
    throw new Error('Job não está à espera da password Uber');
  }

  // Guardar password para próximos logins
  await db.portalConnection.update({
    where: { id: connection.id },
    data: { passwordEncrypted: encrypt(password) },
  });

  await db.portalSyncJob.update({
    where: { id: job.id },
    data: { message: 'Password recebida — a continuar…', status: 'running' },
  });

  void continuePasswordJob(db, job.id, password, actorUserId);
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
      'MyPRIO exige syncScope=electric, syncScope=fleet ou syncScope=both (frota + electricidade)'
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

  // Jobs Playwright presos bloqueiam sync — limpar stale (limiar por portal)
  await clearStalePortalJobs(db, connection.id, portal);
  await releaseStuckActiveJob(db, connection.id, portal);

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
  }

  const runningJob = await db.portalSyncJob.findFirst({
    where: {
      connectionId: connection.id,
      status: { in: ['running', 'awaiting_otp'] },
    },
    orderBy: { createdAt: 'asc' },
  });

  const syncScope = portal === 'myprio' ? options?.syncScope : undefined;
  const uberSync = portal === 'uber' ? options?.uberSync : undefined;
  const scopeLabel = syncScope ? MYPRIO_SYNC_SCOPE_LABELS[syncScope] : null;
  const uberMsg =
    uberSync?.mode === 'generate'
      ? 'A gerar relatório Uber…'
      : uberSync?.mode === 'existing'
        ? `A descarregar ${uberSync.reportName?.slice(0, 40) ?? 'relatório'}…`
        : null;
  const queueMsg = runningJob ? 'Na fila — à espera do job anterior…' : null;

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
      message: queueMsg ?? (scopeLabel ? `A sincronizar ${scopeLabel}…` : uberMsg),
      resultJson,
    },
  });

  if (!runningJob) {
    await db.portalConnection.update({
      where: { id: connection.id },
      data: { activeJobId: job.id, lastError: null },
    });
    void runPortalJob(db, job.id, actorUserId);
  } else {
    await db.portalConnection.update({
      where: { id: connection.id },
      data: { lastError: null },
    });
  }
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

  const storageState = decryptPortalField(connection.sessionStateEncrypted, 'session');
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

/** Timeout Playwright por portal (ms) — alinhar com limpeza de jobs presos. */
function portalSyncTimeoutMs(portal: PortalKind, syncScope?: MyPrioSyncScope): number {
  if (portal === 'uber') return 900_000;
  if (portal === 'via_verde') return 180_000;
  if (portal === 'myprio') return syncScope === 'both' ? 240_000 : 120_000;
  return 90_000;
}

/** Limiar stale por portal (timeout + margem). */
function portalStaleJobMs(portal: PortalKind, syncScope?: MyPrioSyncScope): number {
  return portalSyncTimeoutMs(portal, syncScope) + 60_000;
}

/** Marca jobs `running`/`pending` antigos como falhados (Playwright hung). */
export async function clearStalePortalJobs(
  db: PrismaClient,
  connectionId?: string,
  portal?: PortalKind,
  syncScope?: MyPrioSyncScope
) {
  const staleMs = portal ? portalStaleJobMs(portal, syncScope) : 20 * 60_000;
  const cutoff = new Date(Date.now() - staleMs);
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

/** Liberta activeJobId se o job activo excedeu o timeout esperado do portal. */
async function releaseStuckActiveJob(
  db: PrismaClient,
  connectionId: string,
  portal: PortalKind
) {
  const conn = await db.portalConnection.findUnique({
    where: { id: connectionId },
    select: { activeJobId: true },
  });
  if (!conn?.activeJobId) return;

  const job = await db.portalSyncJob.findUnique({ where: { id: conn.activeJobId } });
  if (!job || (job.status !== 'running' && job.status !== 'pending')) return;

  const meta = readJobMeta(job.resultJson);
  const maxMs = portalSyncTimeoutMs(portal, meta.syncScope) + 45_000;
  const started = job.startedAt ?? job.createdAt;
  if (Date.now() - started.getTime() <= maxMs) return;

  await db.portalSyncJob.update({
    where: { id: job.id },
    data: {
      status: 'failed',
      completedAt: new Date(),
      message: 'Job abortado (timeout). Tente Sincronizar outra vez.',
    },
  });
  await db.portalConnection.update({
    where: { id: connectionId },
    data: { activeJobId: null },
  });
  console.log(`[portal-rpa] libertado job preso ${job.id} (${portal})`);
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

/**
 * Após probe Chromium OK no arranque: limpa lastError de infra em todas as ligações
 * e corrige status `error` → connected (com sessão) / disconnected (sem).
 */
export async function clearStaleInfraPortalErrors(db: PrismaClient): Promise<number> {
  const rows = await db.portalConnection.findMany({
    where: { lastError: { not: null } },
    select: {
      id: true,
      status: true,
      lastError: true,
      sessionStateEncrypted: true,
    },
  });

  let cleared = 0;
  for (const row of rows) {
    if (!isInfraBrowserError(row.lastError)) continue;
    const nextStatus =
      row.status === 'error'
        ? row.sessionStateEncrypted
          ? 'connected'
          : 'disconnected'
        : row.status;
    await db.portalConnection.update({
      where: { id: row.id },
      data: {
        lastError: null,
        status: nextStatus,
        ...(row.status === 'error' ? { activeJobId: null } : {}),
      },
    });
    cleared += 1;
  }
  return cleared;
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

async function dispatchNextPortalJob(
  db: PrismaClient,
  connectionId: string,
  finishedJobId: string,
  actorUserId: string
): Promise<void> {
  const finished = await db.portalSyncJob.findUnique({
    where: { id: finishedJobId },
    select: { status: true },
  });
  if (
    !finished ||
    finished.status === 'running' ||
    finished.status === 'pending' ||
    finished.status === 'awaiting_otp'
  ) {
    return;
  }

  const busy = await db.portalSyncJob.findFirst({
    where: {
      connectionId,
      status: { in: ['running', 'awaiting_otp'] },
    },
  });
  if (busy) return;

  const next = await db.portalSyncJob.findFirst({
    where: { connectionId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
  if (!next) {
    await db.portalConnection.updateMany({
      where: { id: connectionId, activeJobId: finishedJobId },
      data: { activeJobId: null },
    });
    return;
  }

  await db.portalConnection.update({
    where: { id: connectionId },
    data: { activeJobId: next.id },
  });
  void runPortalJob(db, next.id, actorUserId);
}

async function runPortalJob(db: PrismaClient, jobId: string, actorUserId: string) {
  const job = await db.portalSyncJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  if (job.status === 'pending') {
    const claimed = await db.portalSyncJob.updateMany({
      where: { id: jobId, status: 'pending' },
      data: { status: 'running', startedAt: new Date() },
    });
    if (claimed.count === 0) return;
  } else if (job.status !== 'running' && job.status !== 'awaiting_otp') {
    return;
  }

  const connection = await db.portalConnection.findUnique({ where: { id: job.connectionId } });
  if (!connection) return;

  const portal = job.portal as PortalKind;
  const adapter = getPortalAdapter(portal, env.portalRpaMock);

  try {
    if (job.type === 'connect') {
      if (!connection.usernameEncrypted || (portal !== 'uber' && !connection.passwordEncrypted)) {
        throw new Error('Credenciais em falta');
      }
      const username = decryptPortalField(connection.usernameEncrypted, 'username');
      const password = connection.passwordEncrypted
        ? decryptPortalField(connection.passwordEncrypted, 'password')
        : '';

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
          const existingSession = decryptPortalField(connection.sessionStateEncrypted, 'session');
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
      // Arkose não pinta em headless — headed+Xvfb só no Ligar conta (stream modal), não é UBER_INTERACTIVE
      const uberHeadedConnect =
        portal === 'uber' && (uberInteractive || env.portalRpaUberHeadedConnect);
      const result = await withPlaywrightPage(
        {
          headless: uberHeadedConnect ? false : env.portalRpaHeadless,
          keepAlive: true,
          // Interactivo: até 10 min; automático: 4 min (+ margem paint Arkose)
          timeoutMs: uberInteractive ? 600_000 : 240_000,
        },
        async (browser, context, page) => {
          if (uberHeadedConnect) {
            console.log(
              `[portal-rpa] Uber connect headed DISPLAY=${process.env.DISPLAY ?? '-'} ` +
                `interactive=${uberInteractive} headedConnect=${env.portalRpaUberHeadedConnect}`
            );
          }
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
        const isBot = result.phase.kind === 'bot';
        const hint =
          result.phase.hint ??
          (isBot
            ? 'Resolva o desafio anti-bot Uber na janela Desafio Uber.'
            : 'Digitalize o QR passkey com o telemóvel. Depois pode ser pedido OTP SMS.');
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint: hint,
            message: hint,
            resultJson: {
              authChallenge: isBot ? 'bot' : 'passkey',
              challengeImageBase64: result.phase.challengeImageBase64,
            },
          },
        });
        void watchLiveUberAuthChallenge(db, connection.id, jobId, { bot: isBot });
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
      let storageState = decryptPortalField(connection.sessionStateEncrypted, 'session');

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
      const syncTimeoutMs = portalSyncTimeoutMs(portal, jobMeta.syncScope);
      console.log(
        `[portal-rpa] sync start portal=${portal} scope=${jobMeta.syncScope ?? '-'} uber=${jobMeta.uberSync?.mode ?? '-'} interactive=${uberInteractive} headless=${uberInteractive ? false : env.portalRpaHeadless} timeout=${syncTimeoutMs}ms`
      );
      let refreshedStorage: string | undefined;
      let syncResult = await withPlaywrightPage(
        {
          headless: uberInteractive ? false : env.portalRpaHeadless,
          storageStateJson: storageState,
          timeoutMs: syncTimeoutMs,
        },
        async (_b, context, page) => {
          const result = await adapter.sync(context, page, {
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
          });
          if (result.status === 'ok') {
            try {
              refreshedStorage = await captureStorageState(context);
            } catch {
              /* manter sessão anterior */
            }
          }
          return result;
        }
      );
      console.log(`[portal-rpa] sync end portal=${portal} status=${syncResult.status}`);

      if (syncResult.status === 'expired') {
        // Via Verde (sem OTP): re-login silencioso com password guardada e repetir sync 1×
        if (SILENT_RELOGIN_PORTALS.has(portal) && connection.passwordEncrypted) {
          console.log(`[portal-rpa] sync expired → silent relogin portal=${portal}`);
          await db.portalSyncJob
            .update({
              where: { id: jobId },
              data: { message: 'Sessão expirada — a renovar login automaticamente…' },
            })
            .catch(() => undefined);

          const relogin = await attemptSilentPortalRelogin(db, connection, adapter);
          if (relogin.ok) {
            storageState = relogin.storageState;
            refreshedStorage = undefined;
            const retryResult = await withPlaywrightPage(
              {
                headless: uberInteractive ? false : env.portalRpaHeadless,
                storageStateJson: storageState,
                timeoutMs: syncTimeoutMs,
              },
              async (_b, context, page) => {
                const result = await adapter.sync(context, page, {
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
                });
                if (result.status === 'ok') {
                  try {
                    refreshedStorage = await captureStorageState(context);
                  } catch {
                    /* manter */
                  }
                }
                return result;
              }
            );
            console.log(
              `[portal-rpa] sync retry after relogin portal=${portal} status=${retryResult.status}`
            );
            if (retryResult.status === 'ok') {
              syncResult = retryResult;
            } else if (retryResult.status === 'expired' || retryResult.status === 'failed') {
              await db.portalConnection.update({
                where: { id: connection.id },
                data: {
                  status: retryResult.status === 'expired' ? 'expired' : 'connected',
                  lastError: retryResult.message,
                  activeJobId: null,
                },
              });
              await db.portalSyncJob.update({
                where: { id: jobId },
                data: {
                  status: 'failed',
                  completedAt: new Date(),
                  message: retryResult.message,
                },
              });
              return;
            }
          } else {
            const otpMsg =
              relogin.reason === 'needs_otp'
                ? 'Sessão expirada — a Uber pediu código SMS. Volte a Ligar conta.'
                : relogin.reason === 'no_credentials'
                  ? 'Sessão expirada — guarde email e password em Ligar conta para re-login automático.'
                  : undefined;
            await db.portalConnection.update({
              where: { id: connection.id },
              data: {
                status: relogin.reason === 'needs_otp' ? 'expired' : 'expired',
                lastError:
                  otpMsg ||
                  relogin.message ||
                  syncResult.message ||
                  'Sessão expirada — volte a ligar a conta',
                activeJobId: null,
              },
            });
            await db.portalSyncJob.update({
              where: { id: jobId },
              data: {
                status: 'failed',
                completedAt: new Date(),
                message:
                  otpMsg ||
                  relogin.message ||
                  syncResult.message ||
                  'Sessão expirada — volte a ligar a conta',
              },
            });
            return;
          }
        } else {
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
      }

      if (syncResult.status === 'failed') {
        await db.portalConnection.update({
          where: { id: connection.id },
          data: {
            status: 'connected',
            lastError: syncResult.message,
            activeJobId: null,
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

      if (syncResult.status !== 'ok') {
        await db.portalConnection.update({
          where: { id: connection.id },
          data: {
            status: 'expired',
            lastError: syncResult.message,
            activeJobId: null,
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
            activeJobId: null,
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
          activeJobId: null,
          ...(refreshedStorage ? { sessionStateEncrypted: encrypt(refreshedStorage) } : {}),
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
  } finally {
    await dispatchNextPortalJob(db, connection.id, jobId, actorUserId);
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
      if (result.status === 'awaiting_otp' || result.status === 'awaiting_password') {
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint:
              result.status === 'awaiting_password'
                ? result.hint ?? 'OTP OK — introduza a password'
                : result.otpHint ?? 'OTP adicional necessário',
            resultJson:
              result.status === 'awaiting_password' ? { authChallenge: 'password' } : undefined,
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

    result = await withLivePageLock(jobId, async () => {
      let phase = await adapter.submitOtp(live.page, code);

      // Uber: após OTP → auto-fill password guardada
      if (portal === 'uber' && phase.status !== 'failed' && phase.status !== 'connected') {
        const pwd = connection.passwordEncrypted
          ? decryptPortalField(connection.passwordEncrypted, 'password')
          : '';
        const onPassword =
          phase.status === 'awaiting_password' ||
          (await isUberPasswordScreen(live.page).catch(() => false));

        if (onPassword && pwd) {
          console.log('[uber-otp] pós-OTP → preferPasswordLogin (password guardada)');
          await preferPasswordLogin(live.page, pwd);
          const connected = await waitUberSupplierAfterPassword(live.page);
          if (connected) {
            phase = {
              status: 'connected' as const,
              storageState: await captureStorageState(live.context),
            };
          } else if (await isUberPasswordScreen(live.page).catch(() => false)) {
            phase = {
              status: 'awaiting_password' as const,
              hint: 'OTP OK — password incorrecta ou ecrã ainda aberto. Introduza a password Uber.',
              storageState: await captureStorageState(live.context),
            };
          }
        } else if (onPassword) {
          phase = {
            status: 'awaiting_password' as const,
            hint: 'OTP OK — introduza a password Uber.',
            storageState: await captureStorageState(live.context),
          };
        }
      }

      return phase;
    });

    if (portal === 'uber' && live) {
      const pwdAfterOtp = connection.passwordEncrypted
        ? decryptPortalField(connection.passwordEncrypted, 'password')
        : '';
      const liveState = await withLivePageLock(jobId, () =>
        inspectUberLiveAuth(live.page, pwdAfterOtp)
      ).catch(() => null);
      if (liveState === 'bot') {
        await db.portalConnection.update({
          where: { id: connection.id },
          data: { status: 'awaiting_otp', lastError: null },
        });
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint:
              'Resolva o desafio anti-bot («Proteger a sua conta») na janela Desafio Uber.',
            message: 'À espera do desafio anti-bot Uber',
            resultJson: { authChallenge: 'bot' },
          },
        });
        void watchLiveUberAuthChallenge(db, connection.id, jobId, { bot: true });
        return;
      }
    }

    if (result.status === 'connected') {
      const storageState =
        ('storageState' in result && result.storageState) ||
        (await live.context.storageState().then(JSON.stringify));
      result = { status: 'connected' as const, storageState };
    }

    // Manter browser vivo para OTP adicional OU password pós-OTP
    if (result.status !== 'awaiting_otp' && result.status !== 'awaiting_password') {
      await disposeLiveOtpSession(jobId);
    }

    if (result.status === 'failed') {
      await disposeLiveOtpSession(jobId);
      await failJob(db, connection.id, jobId, result.message);
      return;
    }

    if (result.status === 'awaiting_password') {
      await db.portalConnection.update({
        where: { id: connection.id },
        data: { status: 'awaiting_otp', lastError: null },
      });
      await db.portalSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'awaiting_otp',
          otpHint: result.hint ?? 'OTP OK — introduza a password Uber.',
          message: 'OTP OK — à espera da password',
          resultJson: { authChallenge: 'password' },
        },
      });
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

async function waitUberSupplierAfterPassword(
  page: import('playwright').Page
): Promise<boolean> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (/supplier\.uber\.com/i.test(url) && !/auth\.uber\.com/i.test(url)) return true;
    const ready = page.getByText(/tudo pronto/i).first();
    if (await ready.isVisible().catch(() => false)) {
      const btn = page.getByRole('button', { name: /^(continuar|seguinte|next)$/i }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 8000 }).catch(() => undefined);
      }
      await page.waitForTimeout(1500);
      continue;
    }
    await page.waitForTimeout(800);
  }
  const url = page.url();
  return /supplier\.uber\.com/i.test(url) && !/auth\.uber\.com/i.test(url);
}

async function continuePasswordJob(
  db: PrismaClient,
  jobId: string,
  password: string,
  _actorUserId: string
) {
  const job = await db.portalSyncJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const connection = await db.portalConnection.findUnique({ where: { id: job.connectionId } });
  if (!connection) return;

  try {
    const live = getLiveOtpSession(jobId);
    if (!live) {
      await failJob(
        db,
        connection.id,
        jobId,
        'Sessão password no servidor já não está aberta. Desligar → Ligar conta para SMS novo.'
      );
      return;
    }

    console.log('[uber-otp] submitPortalPassword → preferPasswordLogin');
    await withLivePageLock(jobId, async () => {
      await preferPasswordLogin(live.page, password);
      await live.page.waitForTimeout(1500);
    });

    const liveState = await withLivePageLock(jobId, () =>
      inspectUberLiveAuth(live.page, password)
    ).catch(() => 'unknown' as const);

    if (liveState === 'bot') {
      await db.portalConnection.update({
        where: { id: connection.id },
        data: { status: 'awaiting_otp', lastError: null },
      });
      await db.portalSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'awaiting_otp',
          otpHint:
            'Resolva o desafio anti-bot («Proteger a sua conta») na janela Desafio Uber.',
          message: 'À espera do desafio anti-bot Uber',
          resultJson: { authChallenge: 'bot' },
        },
      });
      void watchLiveUberAuthChallenge(db, connection.id, jobId, { bot: true });
      return;
    }

    const connected = await withLivePageLock(jobId, () =>
      waitUberSupplierAfterPassword(live.page)
    );

    if (!connected) {
      const afterState = await withLivePageLock(jobId, () =>
        inspectUberLiveAuth(live.page, password)
      ).catch(() => 'unknown' as const);
      if (afterState === 'bot') {
        await db.portalConnection.update({
          where: { id: connection.id },
          data: { status: 'awaiting_otp', lastError: null },
        });
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint:
              'Resolva o desafio anti-bot («Proteger a sua conta») na janela Desafio Uber.',
            message: 'À espera do desafio anti-bot Uber',
            resultJson: { authChallenge: 'bot' },
          },
        });
        void watchLiveUberAuthChallenge(db, connection.id, jobId, { bot: true });
        return;
      }
      // Voltar a awaiting password (manter browser)
      await db.portalConnection.update({
        where: { id: connection.id },
        data: { status: 'awaiting_otp', lastError: null },
      });
      await db.portalSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'awaiting_otp',
          otpHint: 'Password incorrecta ou ecrã Uber ainda aberto. Tente de novo.',
          message: 'À espera da password Uber',
          resultJson: { authChallenge: 'password' },
        },
      });
      return;
    }

    const storageState = await captureStorageState(live.context);
    await disposeLiveOtpSession(jobId);
    await db.portalConnection.update({
      where: { id: connection.id },
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
        message: 'Conta ligada após password',
        resultJson: { authChallenge: null },
      },
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
  const cryptoFail = isPortalCryptoErrorMessage(message);
  // Timeout de sync ≠ conta partida — manter "connected" para não forçar re-Ligar
  const keepConnected = !cryptoFail && /Timeout Playwright|sync abortado/i.test(message);
  // OTP/login falhou: limpar cookies mid-OTP para o próximo Ligar fazer SMS completo
  const clearSession =
    !keepConnected &&
    (cryptoFail ||
      /OTP|SMS|Login|login|Formulário|chrome-error|Sessão OTP|não autentic|passkey|Sessão guardada ilegível/i.test(
        message
      ));

  await db.portalConnection.update({
    where: { id: connectionId },
    data: {
      status: keepConnected ? 'connected' : cryptoFail ? 'expired' : 'error',
      lastError: cryptoFail
        ? /Sessão guardada ilegível/i.test(message)
          ? PORTAL_SESSION_NEEDS_RESAVE_MESSAGE
          : PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE
        : message,
      ...(clearSession ? { sessionStateEncrypted: null } : {}),
    },
  });
  await db.portalSyncJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      completedAt: new Date(),
      message: cryptoFail
        ? /Sessão guardada ilegível/i.test(message)
          ? PORTAL_SESSION_NEEDS_RESAVE_MESSAGE
          : PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE
        : message,
    },
  });
}

/**
 * Enquanto o gestor digitaliza o QR passkey ou resolve Arkose no stream live,
 * o browser Playwright fica aberto. Quando a página avança → connected ou OTP SMS.
 */
async function watchLiveUberAuthChallenge(
  db: PrismaClient,
  connectionId: string,
  jobId: string,
  options?: { bot?: boolean }
) {
  const isBotStart = Boolean(options?.bot);
  const deadline = Date.now() + (isBotStart ? 10 : 5) * 60_000;
  const connection = await db.portalConnection.findUnique({ where: { id: connectionId } });
  let password = '';
  let username = '';
  try {
    password = connection?.passwordEncrypted
      ? decryptPortalField(connection.passwordEncrypted, 'password')
      : '';
    username = connection?.usernameEncrypted
      ? decryptPortalField(connection.usernameEncrypted, 'username')
      : '';
  } catch (err) {
    await failJob(
      db,
      connectionId,
      jobId,
      err instanceof Error ? err.message : PORTAL_PASSWORD_NEEDS_RESAVE_MESSAGE
    );
    return;
  }
  let sawBot = isBotStart;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const jobSnap = await db.portalSyncJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (jobSnap?.status === 'running') {
      // OTP/password a ser processado — não competir com continueOtpJob no Playwright
      continue;
    }
    const live = getLiveOtpSession(jobId);
    if (!live || live.page.isClosed()) {
      await failJob(
        db,
        connectionId,
        jobId,
        sawBot
          ? 'Sessão do desafio Uber expirou (browser fechou). Ligar conta outra vez.'
          : 'Sessão passkey Uber expirou (browser fechou). Ligar conta outra vez.'
      );
      return;
    }
    touchLiveOtpSession(jobId);

    try {
      const state = await withLivePageLock(jobId, async () =>
        inspectUberLiveAuth(live.page, password)
      );
      console.log(`[uber-passkey-watch] state=${state}`);

      // Ainda no email (vazio/erro) — re-fill; NÃO manter OTP/bot enganoso
      // MAS: texto identidade sob overlay Arkose NÃO é «preso no email» — deixar o desafio.
      if (state === 'identity') {
        const overlay = await withLivePageLock(jobId, () =>
          hasActiveArkoseOverlay(live.page).catch(() => false)
        );
        if (overlay) {
          sawBot = true;
          continue;
        }
        if (username) {
          await withLivePageLock(jobId, () =>
            nudgeBotChallengePaint(live.page, username).catch(() => undefined)
          );
        }
        const job = await db.portalSyncJob.findUnique({ where: { id: jobId } });
        const meta =
          job?.resultJson && typeof job.resultJson === 'object' && !Array.isArray(job.resultJson)
            ? (job.resultJson as Record<string, unknown>)
            : {};
        // Limpar authChallenge=bot/otp enquanto estamos na identidade (evita «OTP pendente» falso)
        if (meta.authChallenge === 'bot' || meta.authChallenge === 'otp') {
          await db.portalSyncJob.update({
            where: { id: jobId },
            data: {
              status: 'running',
              otpHint: null,
              message: 'A preencher email Uber…',
              resultJson: { ...meta, authChallenge: null, challengeImageBase64: null },
            },
          });
        }
        continue;
      }

      if (state === 'bot') {
        // Só confirmar bot se handoff seguro (evita modal com email vazio)
        const handoff = await withLivePageLock(jobId, () =>
          canHandoffBotChallenge(live.page).catch(() => false)
        );
        if (!handoff) {
          if (username) {
            await withLivePageLock(jobId, () =>
              nudgeBotChallengePaint(live.page, username).catch(() => undefined)
            );
          }
          continue;
        }
        sawBot = true;
        // Manter authChallenge=bot para o modal de stream; não sair do watcher.
        const job = await db.portalSyncJob.findUnique({ where: { id: jobId } });
        const meta =
          job?.resultJson && typeof job.resultJson === 'object' && !Array.isArray(job.resultJson)
            ? (job.resultJson as Record<string, unknown>)
            : {};
        if (meta.authChallenge !== 'bot') {
          await db.portalSyncJob.update({
            where: { id: jobId },
            data: {
              status: 'awaiting_otp',
              otpHint:
                'Resolva o desafio anti-bot («Proteger a sua conta») na janela Desafio Uber.',
              message: 'À espera do desafio anti-bot Uber',
              resultJson: { ...meta, authChallenge: 'bot' },
            },
          });
        }
        continue;
      }

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
            message: sawBot ? 'Conta ligada (após desafio anti-bot)' : 'Conta ligada (passkey)',
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
            otpHint: sawBot
              ? 'Desafio OK — introduza agora o código SMS de 4 dígitos da Uber'
              : 'Passkey OK — introduza agora o código SMS de 4 dígitos da Uber',
            message: sawBot ? 'À espera de OTP SMS (após desafio)' : 'À espera de OTP SMS (após passkey)',
            resultJson: { authChallenge: 'otp', challengeImageBase64: null },
          },
        });
        return;
      }

      if (state === 'passkey' && sawBot) {
        // Bot cleared → passkey/chooser — keep watching (SMS preference inside inspect)
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint:
              'Desafio OK. Se aparecer QR passkey, digitalize; o servidor tenta SMS automaticamente.',
            message: 'Após desafio — passkey/SMS',
            resultJson: { authChallenge: 'passkey' },
          },
        });
      }

      if (state === 'password' && password) {
        console.log('[uber-passkey-watch] password screen → preferPasswordLogin');
        await withLivePageLock(jobId, () => preferPasswordLogin(live.page, password));
        await live.page.waitForTimeout(1500);
        continue;
      }

      if (state === 'password' && !password) {
        await db.portalSyncJob.update({
          where: { id: jobId },
          data: {
            status: 'awaiting_otp',
            otpHint: 'OTP OK — introduza a password Uber.',
            message: 'À espera da password Uber',
            resultJson: { authChallenge: 'password' },
          },
        });
        await db.portalConnection.update({
          where: { id: connectionId },
          data: { status: 'awaiting_otp', lastError: null },
        });
        return;
      }
    } catch (err) {
      console.error('[uber-passkey-watch]', err instanceof Error ? err.message : err);
    }
  }

  await failJob(
    db,
    connectionId,
    jobId,
    sawBot
      ? 'Timeout à espera do desafio anti-bot (10 min). Resolva o Desafio Uber a tempo ou Ligar conta outra vez.'
      : 'Timeout à espera do passkey (5 min). Digitalize o QR a tempo ou Ligar conta outra vez.'
  );
}

async function assertTenantOwnsLiveJob(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  jobId: string
) {
  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!connection) throw new Error('Ligação não encontrada');
  if (connection.activeJobId !== jobId) {
    throw new Error('Job não activo para esta conta — sem stream disponível');
  }
  const job = await db.portalSyncJob.findUnique({ where: { id: jobId } });
  if (!job || job.tenantId !== tenantId || job.connectionId !== connection.id) {
    throw new Error('Job inválido para este tenant');
  }
  if (job.status === 'completed' || job.status === 'failed') {
    throw new Error('Job já terminou');
  }
  const live = getLiveOtpSession(jobId);
  if (!live || live.page.isClosed()) {
    throw new Error('Browser vivo indisponível (expirou ou API reiniciou)');
  }
  return { connection, job, live };
}

/** Throttle nudges Arkose por job (live-frame poll ~2 FPS). */
const liveBotNudgeAt = new Map<string, number>();

/** Serializar ops Playwright por job — evita hang do screenshot atrás de nudges/watch. */
const livePageLocks = new Map<string, Promise<unknown>>();

async function withLivePageLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = livePageLocks.get(jobId) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(
    () => done,
    () => done
  );
  livePageLocks.set(jobId, chained);
  await prev.then(
    () => undefined,
    () => undefined
  );
  try {
    return await fn();
  } finally {
    release();
  }
}

async function captureLiveJpeg(page: import('playwright').Page): Promise<Buffer> {
  // Timeout curto — se CDP/screenshot bloquear, falhar em vez de hang eterno no modal
  const shot = page.screenshot({ type: 'jpeg', quality: 52, fullPage: false });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Timeout a capturar ecrã live (8s)')), 8_000);
  });
  try {
    return await Promise.race([shot, timeout]);
  } catch (err) {
    // Fallback CDP (por vezes page.screenshot falha com iframes cross-origin)
    try {
      const cdp = await page.context().newCDPSession(page);
      const result = await Promise.race([
        cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 52, fromSurface: true }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout CDP screenshot')), 8_000);
        }),
      ]);
      await cdp.detach().catch(() => undefined);
      if (result && typeof result === 'object' && 'data' in result && typeof result.data === 'string') {
        return Buffer.from(result.data, 'base64');
      }
    } catch (cdpErr) {
      console.error(
        '[live-frame] CDP fallback falhou:',
        cdpErr instanceof Error ? cdpErr.message : cdpErr
      );
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function getPortalLiveFrame(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  jobId: string
) {
  const { live, job, connection } = await assertTenantOwnsLiveJob(db, tenantId, portal, jobId);
  // Prolongar TTL enquanto o gestor vê o stream (desafio pode durar ~10 min)
  touchLiveOtpSession(jobId);

  return withLivePageLock(jobId, async () => {
    if (live.page.isClosed()) {
      throw new Error('Browser vivo indisponível (página fechou)');
    }

    const viewport = live.page.viewportSize() ?? { width: 1440, height: 900 };

    // 1) Screenshot PRIMEIRO — o modal precisa de JPEG mesmo se a detecção demorar
    let buf: Buffer;
    try {
      buf = await captureLiveJpeg(live.page);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[live-frame] screenshot falhou job=${jobId}: ${msg}`);
      if (/Target closed|has been closed|Browser.*fechou|closed/i.test(msg)) {
        throw new Error('Browser vivo indisponível (expirou ou fechou durante o desafio)');
      }
      throw new Error(`Falha a capturar ecrã live: ${msg}`);
    }

    const meta =
      job.resultJson && typeof job.resultJson === 'object' && !Array.isArray(job.resultJson)
        ? (job.resultJson as Record<string, unknown>)
        : {};
    let authChallenge =
      meta.authChallenge === 'bot' ||
      meta.authChallenge === 'passkey' ||
      meta.authChallenge === 'otp'
        ? meta.authChallenge
        : null;

    const username = connection.usernameEncrypted
      ? (() => {
          try {
            return decryptPortalField(connection.usernameEncrypted, 'username');
          } catch {
            return '';
          }
        })()
      : '';

    // 2) Metadados leves (sem bloquear o JPEG se falharem)
    let challengeVisible: boolean | null = null;
    if (portal === 'uber') {
      try {
        const liveState = await inspectUberLiveAuth(live.page).catch(() => 'unknown' as const);
        if (liveState === 'otp') {
          authChallenge = 'otp';
          challengeVisible = false;
        } else if (liveState === 'password') {
          authChallenge = 'password';
          challengeVisible = false;
        } else if (liveState === 'connected') {
          authChallenge = null;
          challengeVisible = false;
        }
      } catch (liveStateErr) {
        console.error(
          '[live-frame] inspectUberLiveAuth falhou:',
          liveStateErr instanceof Error ? liveStateErr.message : liveStateErr
        );
      }
    }
    if (portal === 'uber' && authChallenge === 'bot') {
      try {
        const stuckIdentity = await isStuckOnEmptyIdentity(live.page);
        if (stuckIdentity) {
          authChallenge = null;
          challengeVisible = false;
          const last = liveBotNudgeAt.get(jobId) ?? 0;
          if (username && Date.now() - last > 6000) {
            liveBotNudgeAt.set(jobId, Date.now());
            await nudgeBotChallengePaint(live.page, username).catch(() => undefined);
          }
        } else {
          const overlay = await hasActiveArkoseOverlay(live.page).catch(() => false);
          const visual = await isBotChallengeVisuallyReady(live.page).catch(() => false);
          const handoff = await canHandoffBotChallenge(live.page).catch(() => false);
          challengeVisible = visual || overlay;
          if (!handoff && !overlay && !visual) {
            // Ainda a montar — nudge raro; NÃO re-click se disabled/overlay
            const last = liveBotNudgeAt.get(jobId) ?? 0;
            if (Date.now() - last > 6000) {
              liveBotNudgeAt.set(jobId, Date.now());
              await nudgeBotChallengePaint(live.page, username || undefined).catch(() => undefined);
              challengeVisible = await isBotChallengeVisuallyReady(live.page).catch(() => false);
              if (await canHandoffBotChallenge(live.page).catch(() => false)) {
                authChallenge = 'bot';
              } else if (!challengeVisible) {
                authChallenge = null;
              }
            }
          } else if (challengeVisible) {
            liveBotNudgeAt.delete(jobId);
            authChallenge = 'bot';
          } else if (handoff) {
            // Handoff sem paint textual — manter bot; iframe pode ter puzzle
            authChallenge = 'bot';
            challengeVisible = overlay;
          }
        }
      } catch (metaErr) {
        console.error(
          '[live-frame] meta falhou (JPEG ok):',
          metaErr instanceof Error ? metaErr.message : metaErr
        );
      }
    }

    return {
      imageBase64: buf.toString('base64'),
      mimeType: 'image/jpeg' as const,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      authChallenge,
      challengeVisible,
      capturedAt: new Date().toISOString(),
    };
  });
}

export async function postPortalLiveInput(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  jobId: string,
  input: {
    type: 'click' | 'mousedown' | 'mouseup' | 'mousemove' | 'drag';
    x: number;
    y: number;
    endX?: number;
    endY?: number;
    button?: 'left' | 'right' | 'middle';
    /** Largura/altura do elemento de imagem no browser do gestor (para mapear coords) */
    displayWidth: number;
    displayHeight: number;
  }
) {
  const { live } = await assertTenantOwnsLiveJob(db, tenantId, portal, jobId);
  touchLiveOtpSession(jobId);

  return withLivePageLock(jobId, async () => {
    if (live.page.isClosed()) {
      throw new Error('Browser vivo indisponível (página fechou)');
    }
    const viewport = live.page.viewportSize() ?? { width: 1440, height: 900 };
    if (!(input.displayWidth > 0) || !(input.displayHeight > 0)) {
      throw new Error('displayWidth/displayHeight inválidos');
    }

    const toPage = (dx: number, dy: number) => ({
      x: Math.max(0, Math.min(viewport.width - 1, (dx / input.displayWidth) * viewport.width)),
      y: Math.max(0, Math.min(viewport.height - 1, (dy / input.displayHeight) * viewport.height)),
    });

    const button = input.button ?? 'left';
    const start = toPage(input.x, input.y);

    if (input.type === 'click') {
      await live.page.mouse.click(start.x, start.y, { button });
      return { ok: true as const };
    }

    if (input.type === 'mousedown') {
      await live.page.mouse.move(start.x, start.y);
      await live.page.mouse.down({ button });
      return { ok: true as const };
    }

    if (input.type === 'mouseup') {
      await live.page.mouse.move(start.x, start.y);
      await live.page.mouse.up({ button });
      return { ok: true as const };
    }

    if (input.type === 'mousemove') {
      await live.page.mouse.move(start.x, start.y);
      return { ok: true as const };
    }

    // drag: from (x,y) to (endX,endY)
    const end = toPage(input.endX ?? input.x, input.endY ?? input.y);
    await live.page.mouse.move(start.x, start.y);
    await live.page.mouse.down({ button });
    await live.page.mouse.move(end.x, end.y, { steps: 12 });
    await live.page.mouse.up({ button });
    return { ok: true as const };
  });
}

export async function cancelPortalLiveJob(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  jobId: string
) {
  const connection = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!connection) throw new Error('Ligação não encontrada');
  if (connection.activeJobId !== jobId) {
    throw new Error('Job não activo');
  }
  const job = await db.portalSyncJob.findUnique({ where: { id: jobId } });
  if (!job || job.tenantId !== tenantId) throw new Error('Job inválido');

  await failJob(
    db,
    connection.id,
    jobId,
    'Desafio cancelado pelo utilizador. Ligar conta outra vez se quiser continuar.'
  );
  return getPortalConnectionDetail(db, tenantId, portal);
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
          portal: { in: ['via_verde', 'uber'] },
          usernameEncrypted: { not: null },
          passwordEncrypted: { not: null },
        },
      ],
    },
  });

  const results: Array<{ portal: string; tenantId: string; ok: boolean }> = [];

  for (const connection of connections) {
    const portal = connection.portal as PortalKind;
    await clearStalePortalJobs(db, connection.id, portal);
    const busy = await db.portalConnection.findUnique({
      where: { id: connection.id },
      select: { activeJobId: true },
    });
    if (busy?.activeJobId) {
      const active = await db.portalSyncJob.findUnique({ where: { id: busy.activeJobId } });
      if (active && (active.status === 'running' || active.status === 'pending' || active.status === 'awaiting_otp')) {
        continue;
      }
    }

    const job = await db.portalSyncJob.create({
      data: {
        tenantId: connection.tenantId,
        connectionId: connection.id,
        portal: connection.portal,
        type: 'refresh',
        status: 'pending',
      },
    });
    await db.portalConnection.update({
      where: { id: connection.id },
      data: { activeJobId: job.id },
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

const AUTO_SYNC_PORTALS: PortalKind[] = ['via_verde', 'myprio', 'uber'];
const AUTO_SYNC_SKIP_RECENT_MS = 20 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function setPortalAutoSync(
  db: PrismaClient,
  tenantId: string,
  portal: PortalKind,
  enabled: boolean
): Promise<PortalConnectionPublic> {
  if (!AUTO_SYNC_PORTALS.includes(portal)) {
    throw new Error('Sincronização automática não está disponível para este portal');
  }
  const row = await db.portalConnection.findUnique({
    where: { tenantId_portal: { tenantId, portal: toDbPortal(portal) } },
  });
  if (!row) {
    throw new Error('Ligue a conta antes de activar a sincronização automática');
  }
  await db.portalConnection.update({
    where: { id: row.id },
    data: { autoSyncEnabled: enabled },
  });
  return getPortalConnectionDetail(db, tenantId, portal);
}

async function resolvePortalActorUserId(
  db: PrismaClient,
  tenantId: string
): Promise<string | null> {
  const superadmin = await db.user.findFirst({
    where: { tenantId, role: 'superadmin', status: 'active' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (superadmin) return superadmin.id;
  const any = await db.user.findFirst({
    where: { tenantId, status: 'active' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return any?.id ?? null;
}

async function tenantHasEnabledModule(
  db: PrismaClient,
  tenantId: string,
  moduleKeys: string[]
): Promise<boolean> {
  const row = await db.workspaceModule.findFirst({
    where: {
      enabled: true,
      moduleKey: { in: moduleKeys },
      workspace: { tenantId },
    },
    select: { id: true },
  });
  return Boolean(row);
}

async function waitForPortalJobDone(
  db: PrismaClient,
  jobId: string,
  timeoutMs: number
): Promise<{ status: string; message: string | null }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await db.portalSyncJob.findUnique({
      where: { id: jobId },
      select: { status: true, message: true },
    });
    if (!job) return { status: 'missing', message: null };
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'awaiting_otp') {
      return { status: job.status, message: job.message };
    }
    await sleep(4000);
  }
  return { status: 'timeout', message: null };
}

/**
 * Sync diário opt-in (Via Verde / MyPRIO). Manual sync não muda.
 * Sequencial — um browser Playwright de cada vez.
 */
export async function runDailyPortalAutoSyncs(db: PrismaClient) {
  if (!env.portalRpaEnabled || env.portalRpaMock) return [];

  const connections = await db.portalConnection.findMany({
    where: {
      autoSyncEnabled: true,
      isEnabled: true,
      portal: { in: AUTO_SYNC_PORTALS.map(toDbPortal) },
      sessionStateEncrypted: { not: null },
      status: { in: ['connected', 'error', 'expired'] },
    },
    orderBy: { updatedAt: 'asc' },
  });

  const results: Array<{
    portal: string;
    tenantId: string;
    ok: boolean;
    skipped?: string;
    error?: string;
  }> = [];

  for (const connection of connections) {
    const portal = connection.portal as PortalKind;

    if (
      connection.lastSyncAt &&
      Date.now() - connection.lastSyncAt.getTime() < AUTO_SYNC_SKIP_RECENT_MS
    ) {
      results.push({
        portal,
        tenantId: connection.tenantId,
        ok: true,
        skipped: 'sync recente',
      });
      continue;
    }

    const moduleKeys =
      portal === 'via_verde'
        ? ['via_verde']
        : portal === 'uber'
          ? ['pagamentos', 'uber']
          : ['eletricidade', 'combustivel'];
    const moduleOn = await tenantHasEnabledModule(db, connection.tenantId, moduleKeys);
    if (!moduleOn) {
      results.push({ portal, tenantId: connection.tenantId, ok: true, skipped: 'módulo inactivo' });
      continue;
    }

    const actorUserId = await resolvePortalActorUserId(db, connection.tenantId);
    if (!actorUserId) {
      results.push({
        portal,
        tenantId: connection.tenantId,
        ok: false,
        error: 'sem utilizador activo no tenant',
      });
      continue;
    }

    let syncScope: MyPrioSyncScope | undefined;
    if (portal === 'myprio') {
      const electric = await tenantHasEnabledModule(db, connection.tenantId, ['eletricidade']);
      const fleet = await tenantHasEnabledModule(db, connection.tenantId, ['combustivel']);
      if (electric && fleet) syncScope = 'both';
      else if (electric) syncScope = 'electric';
      else if (fleet) syncScope = 'fleet';
      else {
        results.push({ portal, tenantId: connection.tenantId, ok: true, skipped: 'módulo inactivo' });
        continue;
      }
    }

    try {
      const started = await startPortalSync(db, connection.tenantId, portal, actorUserId, {
        syncScope,
      });
      const waitMs =
        portal === 'uber' ? 960_000 : portal === 'myprio' ? 300_000 : 240_000;
      const done = await waitForPortalJobDone(db, started.jobId, waitMs);
      results.push({
        portal,
        tenantId: connection.tenantId,
        ok: done.status === 'completed',
        error:
          done.status === 'completed'
            ? undefined
            : done.message || done.status,
      });
    } catch (err) {
      results.push({
        portal,
        tenantId: connection.tenantId,
        ok: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  }

  return results;
}
