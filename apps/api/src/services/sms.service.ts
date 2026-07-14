import { prisma } from '@tvde/database';
import { envOr } from '@tvde/shared/server';
import { getServerConfig } from '@tvde/shared/server';
import { decrypt, encrypt } from '../lib/crypto';
import { readFetchBody, pickErrorMessage } from '../lib/fetch-json';
import { getPlatformFeatures } from './platform-features.service';

export type SmsProvider = 'twilio' | 'sinch';
export type SmsPurpose = 'test' | 'otp' | 'manual';
export type SmsLogStatus = 'sent' | 'failed' | 'mocked';

export class SmsNotConfiguredError extends Error {
  constructor(message = 'SMS não configurado') {
    super(message);
    this.name = 'SmsNotConfiguredError';
  }
}

interface SmsConnection {
  provider: SmsProvider;
  authToken: string;
  fromNumber: string;
  accountSid?: string;
  servicePlanId?: string;
  apiBaseUrl?: string;
  source: 'db' | 'env';
}

interface SendSmsInput {
  to: string;
  body: string;
}

export interface SendSmsOptions {
  purpose?: SmsPurpose;
  userId?: string;
}

function maskSmsBodyPreview(body: string, purpose: SmsPurpose): string {
  const masked =
    purpose === 'otp' ? body.replace(/\b\d{4,8}\b/g, '******') : body;
  if (masked.length <= 160) return masked;
  return `${masked.slice(0, 157)}...`;
}

async function writeSmsLog(input: {
  toPhone: string;
  body: string;
  purpose: SmsPurpose;
  provider: string;
  status: SmsLogStatus;
  externalId?: string;
  errorMessage?: string;
  mocked?: boolean;
  userId?: string;
}) {
  await prisma.smsLog.create({
    data: {
      toPhone: input.toPhone,
      bodyPreview: maskSmsBodyPreview(input.body, input.purpose),
      provider: input.provider,
      purpose: input.purpose,
      status: input.status,
      externalId: input.externalId ?? null,
      errorMessage: input.errorMessage ?? null,
      mocked: input.mocked ?? false,
      userId: input.userId ?? null,
    },
  });
}

function normalizeE164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) {
    throw new Error('Telefone deve estar em formato internacional (ex: +351912345678)');
  }
  return digits;
}

/** Sender ID alfanumérico Sinch (ex: TVDE.one, MinhaEmpresa) — comum em PT. */
export function isSinchAlphanumericSender(value: string): boolean {
  const v = value.trim();
  // Sinch: até 11 caracteres; letras, números, ponto, hífen ou espaço interno.
  return /^[A-Za-z][A-Za-z0-9.\- ]{2,10}$/.test(v) && v.length <= 11;
}

/** Remetente Sinch: número +351... ou Sender ID (TVDE.one, MinhaEmpresa). */
export function normalizeSinchFrom(value: string): string {
  const trimmed = value.trim();
  if (isSinchAlphanumericSender(trimmed)) {
    return trimmed;
  }
  if (/^\+/.test(trimmed) || /^[\d\s().-]+$/.test(trimmed)) {
    return normalizeE164(trimmed);
  }
  throw new Error(
    'Remetente Sinch inválido. Use Sender ID aprovado (ex: TVDE.one) ou número internacional (+351912345678).'
  );
}

/** Sinch `from`: MSISDN sem + ou Sender ID textual. */
function formatSinchFromForApi(from: string): string {
  if (isSinchAlphanumericSender(from)) {
    return from.trim();
  }
  return toSinchMsisdn(from);
}

/** Destino Sinch: MSISDN sem + */
function toSinchMsisdn(phone: string): string {
  return normalizeE164(phone).replace(/^\+/, '');
}

async function resolveStoredSms(): Promise<SmsConnection | null> {
  const row = await prisma.smsConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;

  const provider = (row.provider === 'sinch' ? 'sinch' : 'twilio') as SmsProvider;

  return {
    provider,
    authToken: decrypt(row.encryptedAuthToken),
    fromNumber: row.fromNumber,
    accountSid: row.accountSid ?? undefined,
    servicePlanId: row.servicePlanId ?? undefined,
    apiBaseUrl: row.apiBaseUrl ?? undefined,
    source: 'db',
  };
}

function resolveEnvSms(): SmsConnection | null {
  const sinchPlan = envOr('SINCH_SERVICE_PLAN_ID', '');
  const sinchToken = envOr('SINCH_API_TOKEN', '');
  const sinchFrom = envOr('SINCH_FROM_NUMBER', '');
  if (sinchPlan && sinchToken && sinchFrom) {
    return {
      provider: 'sinch',
      authToken: sinchToken,
      fromNumber: sinchFrom,
      servicePlanId: sinchPlan,
      apiBaseUrl: envOr('SINCH_API_BASE_URL', 'https://eu.sms.api.sinch.com/xms/v1'),
      source: 'env',
    };
  }

  const accountSid = envOr('TWILIO_ACCOUNT_SID', '');
  const authToken = envOr('TWILIO_AUTH_TOKEN', '');
  const fromNumber = envOr('TWILIO_FROM_NUMBER', '');
  if (accountSid && authToken && fromNumber) {
    return {
      provider: 'twilio',
      accountSid,
      authToken,
      fromNumber,
      source: 'env',
    };
  }

  return null;
}

export async function resolveSmsConnection(): Promise<SmsConnection> {
  const stored = await resolveStoredSms();
  if (stored) {
    if (stored.provider === 'twilio' && !stored.accountSid) {
      throw new SmsNotConfiguredError('Account SID Twilio em falta');
    }
    if (stored.provider === 'sinch' && !stored.servicePlanId) {
      throw new SmsNotConfiguredError('Service Plan ID Sinch em falta');
    }
    return stored;
  }

  const fromEnv = resolveEnvSms();
  if (fromEnv) return fromEnv;

  throw new SmsNotConfiguredError();
}

/** @deprecated */
export const resolveTwilioConnection = resolveSmsConnection;

export async function isSmsConfigured(): Promise<boolean> {
  try {
    await resolveSmsConnection();
    return true;
  } catch {
    return false;
  }
}

export async function getSmsPublicInfo() {
  const row = await prisma.smsConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      accountSid: true,
      servicePlanId: true,
      apiBaseUrl: true,
      fromNumber: true,
      isActive: true,
      createdAt: true,
    },
  });

  const envConfig = resolveEnvSms();
  const features = await getPlatformFeatures();
  const { smsDevMock, nodeEnv } = getServerConfig();

  return {
    features,
    configured: Boolean(row || envConfig),
    smsConfig: row
      ? {
          ...row,
          accountSid: row.accountSid ? maskSecret(row.accountSid) : null,
          servicePlanId: row.servicePlanId ? maskSecret(row.servicePlanId) : null,
        }
      : null,
    usingEnvFallback: !row && Boolean(envConfig),
    envProvider: envConfig?.provider ?? null,
    devMockActive: smsDevMock && nodeEnv !== 'production',
  };
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function upsertSmsConfig(input: {
  provider: SmsProvider;
  accountSid?: string;
  servicePlanId?: string;
  apiBaseUrl?: string;
  authToken?: string;
  fromNumber: string;
}) {
  const existing = await prisma.smsConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  let encryptedAuthToken = existing?.encryptedAuthToken;
  if (input.authToken) {
    encryptedAuthToken = encrypt(input.authToken);
  }
  if (!encryptedAuthToken) {
    throw new Error('API Token / Auth Token obrigatório');
  }

  const fromNumber =
    input.provider === 'sinch'
      ? normalizeSinchFrom(input.fromNumber)
      : normalizeE164(input.fromNumber);

  if (input.provider === 'twilio' && !input.accountSid?.trim()) {
    throw new Error('Account SID Twilio obrigatório');
  }
  if (input.provider === 'sinch' && !input.servicePlanId?.trim()) {
    throw new Error('Service Plan ID Sinch obrigatório');
  }

  await prisma.smsConfig.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });

  return prisma.smsConfig.create({
    data: {
      provider: input.provider,
      accountSid: input.provider === 'twilio' ? input.accountSid!.trim() : null,
      servicePlanId: input.provider === 'sinch' ? input.servicePlanId!.trim() : null,
      apiBaseUrl:
        input.provider === 'sinch'
          ? (input.apiBaseUrl?.trim() || 'https://eu.sms.api.sinch.com/xms/v1')
          : null,
      encryptedAuthToken,
      fromNumber,
      isActive: true,
    },
    select: {
      id: true,
      provider: true,
      accountSid: true,
      servicePlanId: true,
      apiBaseUrl: true,
      fromNumber: true,
      isActive: true,
      createdAt: true,
    },
  });
}

async function sendViaProvider(config: SmsConnection, input: SendSmsInput) {
  const { smsDevMock, nodeEnv } = getServerConfig();
  const to = normalizeE164(input.to);

  if (smsDevMock && nodeEnv !== 'production') {
    console.info(`[SMS DEV MOCK ${config.provider}] to=${to} body=${input.body}`);
    return {
      id: `dev-mock-${Date.now()}`,
      provider: config.provider,
      source: config.source,
      mocked: true,
    };
  }

  if (config.provider === 'sinch') {
    return sendViaSinch(config, to, input.body);
  }
  return sendViaTwilio(config, to, input.body);
}

async function sendViaTwilio(config: SmsConnection, to: string, body: string) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
  const params = new URLSearchParams({
    To: to,
    From: config.fromNumber,
    Body: body,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const { json, text } = await readFetchBody(res);
  const data = (json ?? {}) as { sid?: string; message?: string };
  if (!res.ok) {
    throw new Error(
      pickErrorMessage(json, text, `Falha Twilio (HTTP ${res.status})`) ||
        data.message ||
        'Falha ao enviar SMS via Twilio'
    );
  }

  return {
    id: data.sid ?? 'unknown',
    provider: 'twilio' as const,
    source: config.source,
    mocked: false,
  };
}

async function sendViaSinch(config: SmsConnection, to: string, body: string) {
  const base = (config.apiBaseUrl ?? 'https://eu.sms.api.sinch.com/xms/v1').replace(/\/$/, '');
  const url = `${base}/${config.servicePlanId}/batches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: formatSinchFromForApi(config.fromNumber),
      to: [toSinchMsisdn(to)],
      body,
    }),
  });

  const { json, text } = await readFetchBody(res);
  const data = (json ?? {}) as { id?: string; text?: string; message?: string; code?: string };

  if (!res.ok) {
    const detail = pickErrorMessage(json, text, `Falha Sinch (HTTP ${res.status})`);
    let hint = '';
    if (res.status === 401) {
      hint =
        ' Copie de novo o API Token em Sinch Dashboard → APIs → REST configuration (não use chaves de Verification/Conversation). Confirme o Service Plan ID e use a URL EU: https://eu.sms.api.sinch.com/xms/v1';
    } else if (/from|source|sender/i.test(detail)) {
      hint = isSinchAlphanumericSender(config.fromNumber)
        ? ' O Sender ID deve estar aprovado no dashboard Sinch (SMS → Sender IDs).'
        : ' Use um número Sinch ou Sender ID alfanumérico aprovado (ex: NomeEmpresa), não o seu telemóvel pessoal.';
    }
    throw new Error(`${detail}${hint}`);
  }

  return {
    id: data.id ?? 'unknown',
    provider: 'sinch' as const,
    source: config.source,
    mocked: false,
  };
}

export async function sendSms(input: SendSmsInput, options: SendSmsOptions = {}) {
  const purpose = options.purpose ?? 'manual';
  let config: SmsConnection;
  let to: string;

  try {
    config = await resolveSmsConnection();
    to = normalizeE164(input.to);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SMS não configurado';
    const stored = await resolveStoredSms();
    const envFallback = resolveEnvSms();
    await writeSmsLog({
      toPhone: input.to,
      body: input.body,
      purpose,
      provider: stored?.provider ?? envFallback?.provider ?? 'unknown',
      status: 'failed',
      errorMessage: message,
      userId: options.userId,
    }).catch(() => undefined);
    throw err;
  }

  try {
    const result = await sendViaProvider(config, input);
    await writeSmsLog({
      toPhone: to,
      body: input.body,
      purpose,
      provider: result.provider,
      status: result.mocked ? 'mocked' : 'sent',
      externalId: result.id,
      mocked: result.mocked,
      userId: options.userId,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao enviar SMS';
    await writeSmsLog({
      toPhone: to,
      body: input.body,
      purpose,
      provider: config.provider,
      status: 'failed',
      errorMessage: message,
      userId: options.userId,
    }).catch(() => undefined);
    throw err;
  }
}

export async function listSmsLogs(page = 0, limit = 50) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const safePage = Math.max(page, 0);

  const [items, total] = await Promise.all([
    prisma.smsLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: safePage * safeLimit,
      take: safeLimit,
      include: {
        user: { select: { email: true } },
      },
    }),
    prisma.smsLog.count(),
  ]);

  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
  };
}

export async function sendOtpSms(to: string, code: string, userId?: string) {
  const { appName } = getServerConfig();
  return sendSms(
    {
      to,
      body: `${appName}: o seu código de verificação é ${code}. Expira em 5 minutos.`,
    },
    { purpose: 'otp', userId }
  );
}

export function maskPhone(phone: string): string {
  const normalized = phone.replace(/\s/g, '');
  if (normalized.length < 6) return '***';
  return `${normalized.slice(0, 4)} *** *** ${normalized.slice(-3)}`;
}
