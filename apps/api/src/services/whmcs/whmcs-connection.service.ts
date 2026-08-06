import { prisma } from '@tvde/database';
import { canDecrypt, decrypt, encrypt, isCryptoAuthFailure } from '../../lib/crypto';
import { getEgressPublicIp } from '../../lib/egress-ip';
import { normalizeWhmcsApiUrl, WhmcsApiClient } from './whmcs-api.client';
import {
  formatWhmcsErrorForStorage,
  parseWhmcsAuthFailedError,
  parseWhmcsInvalidIpError,
} from './whmcs-ip-access';

export const WHMCS_CRYPTO_RESAVE_MESSAGE =
  'API Secret WHMCS ilegível (ENCRYPTION_KEY alterada ou dados corrompidos). ' +
  'Cole novamente o Secret e guarde.';

export type WhmcsTestConnectionResult = {
  ok: boolean;
  egressIp: string | null;
  sampleCount?: number;
  whmcsIpBlocked?: boolean;
  whmcsAuthFailed?: boolean;
  blockedIp?: string | null;
  hint?: string;
  error?: string;
};

export async function getWhmcsConnection(workspaceId: string) {
  return prisma.whmcsConnection.findUnique({ where: { workspaceId } });
}

export async function getWhmcsPublicStatus(workspaceId: string, tenantId: string) {
  const egressIp = await getEgressPublicIp();
  const row = await prisma.whmcsConnection.findFirst({
    where: { workspaceId, tenantId },
  });
  if (!row) {
    return {
      configured: false,
      connected: false,
      isActive: false,
      emitOnPaid: true,
      sendEmailOnIssue: true,
      documentType: 'invoice_receipt',
      apiUrl: '',
      apiIdentifier: '',
      hasSecret: false,
      secretNeedsResave: false,
      pollLookbackDays: 30,
      lastPolledAt: null as string | null,
      lastError: null as string | null,
      connectedAt: null as string | null,
      egressIp,
    };
  }

  const secretNeedsResave = Boolean(
    row.encryptedApiSecret && !canDecrypt(row.encryptedApiSecret)
  );

  const rawLastError = secretNeedsResave
    ? WHMCS_CRYPTO_RESAVE_MESSAGE
    : row.lastError;
  const ipBlocked = rawLastError
    ? parseWhmcsInvalidIpError(rawLastError, egressIp)
    : null;
  const authFailed =
    !ipBlocked && rawLastError ? parseWhmcsAuthFailedError(rawLastError) : null;
  const actionableHint = ipBlocked?.hint ?? authFailed?.hint ?? null;

  return {
    configured: true,
    connected: Boolean(row.connectedAt) && row.isActive && !secretNeedsResave,
    isActive: row.isActive,
    emitOnPaid: row.emitOnPaid,
    sendEmailOnIssue: row.sendEmailOnIssue,
    documentType: row.documentType,
    documentSetId: row.documentSetId,
    apiUrl: row.apiUrl,
    apiIdentifier: row.apiIdentifier,
    hasSecret: Boolean(row.encryptedApiSecret),
    secretNeedsResave,
    pollLookbackDays: row.pollLookbackDays,
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    lastError: actionableHint ?? rawLastError,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    egressIp,
    ...(ipBlocked
      ? {
          whmcsIpBlocked: true as const,
          blockedIp: ipBlocked.blockedIp,
          hint: ipBlocked.hint,
        }
      : {}),
    ...(authFailed
      ? {
          whmcsAuthFailed: true as const,
          hint: authFailed.hint,
        }
      : {}),
  };
}

export async function upsertWhmcsConnection(input: {
  workspaceId: string;
  tenantId: string;
  apiUrl: string;
  apiIdentifier: string;
  apiSecret?: string;
  isActive?: boolean;
  emitOnPaid?: boolean;
  sendEmailOnIssue?: boolean;
  documentType?: string;
  documentSetId?: number | null;
  pollLookbackDays?: number;
}) {
  const existing = await getWhmcsConnection(input.workspaceId);
  const encryptedApiSecret = input.apiSecret?.trim()
    ? encrypt(input.apiSecret.trim())
    : existing?.encryptedApiSecret;

  if (!encryptedApiSecret) {
    throw new Error('API Secret é obrigatório na primeira configuração');
  }

  const apiUrl = normalizeWhmcsApiUrl(input.apiUrl);
  const apiIdentifier = input.apiIdentifier.trim();
  if (!apiIdentifier) throw new Error('API Identifier obrigatório');

  return prisma.whmcsConnection.upsert({
    where: { workspaceId: input.workspaceId },
    update: {
      apiUrl,
      apiIdentifier,
      encryptedApiSecret,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.emitOnPaid !== undefined ? { emitOnPaid: input.emitOnPaid } : {}),
      ...(input.sendEmailOnIssue !== undefined
        ? { sendEmailOnIssue: input.sendEmailOnIssue }
        : {}),
      ...(input.documentType ? { documentType: input.documentType } : {}),
      ...(input.documentSetId !== undefined ? { documentSetId: input.documentSetId } : {}),
      ...(input.pollLookbackDays !== undefined
        ? { pollLookbackDays: Math.max(1, Math.min(365, input.pollLookbackDays)) }
        : {}),
      lastError: null,
      connectedAt: existing?.connectedAt ?? new Date(),
    },
    create: {
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      apiUrl,
      apiIdentifier,
      encryptedApiSecret,
      isActive: input.isActive ?? true,
      emitOnPaid: input.emitOnPaid ?? true,
      sendEmailOnIssue: input.sendEmailOnIssue ?? true,
      documentType: input.documentType ?? 'invoice_receipt',
      documentSetId: input.documentSetId ?? null,
      pollLookbackDays: input.pollLookbackDays ?? 30,
      connectedAt: new Date(),
    },
  });
}

export async function createWhmcsClientFromStored(workspaceId: string) {
  const row = await getWhmcsConnection(workspaceId);
  if (!row) throw new Error('WHMCS não configurado');
  if (!row.isActive) throw new Error('Integração WHMCS desactivada');

  let secret: string;
  try {
    secret = decrypt(row.encryptedApiSecret);
  } catch (err) {
    if (isCryptoAuthFailure(err)) throw new Error(WHMCS_CRYPTO_RESAVE_MESSAGE);
    throw err;
  }

  return {
    row,
    client: new WhmcsApiClient({
      apiUrl: row.apiUrl,
      identifier: row.apiIdentifier,
      secret,
    }),
  };
}

export async function resolveWhmcsApiSecret(input: {
  workspaceId?: string;
  apiSecret?: string;
}): Promise<string> {
  const pasted = input.apiSecret?.trim();
  if (pasted) return pasted;

  if (!input.workspaceId) {
    throw new Error('API Secret obrigatório (ou workspace com secret já guardado)');
  }

  const row = await getWhmcsConnection(input.workspaceId);
  if (!row?.encryptedApiSecret) {
    throw new Error('API Secret obrigatório na primeira configuração');
  }

  try {
    return decrypt(row.encryptedApiSecret);
  } catch (err) {
    if (isCryptoAuthFailure(err)) throw new Error(WHMCS_CRYPTO_RESAVE_MESSAGE);
    throw err;
  }
}

export async function testWhmcsCredentials(input: {
  apiUrl: string;
  apiIdentifier: string;
  apiSecret?: string;
  workspaceId?: string;
}): Promise<WhmcsTestConnectionResult> {
  const egressIp = await getEgressPublicIp();

  let secret: string;
  try {
    secret = await resolveWhmcsApiSecret({
      workspaceId: input.workspaceId,
      apiSecret: input.apiSecret,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha no teste';
    return { ok: false, egressIp, error: message };
  }

  const client = new WhmcsApiClient({
    apiUrl: normalizeWhmcsApiUrl(input.apiUrl),
    identifier: input.apiIdentifier.trim(),
    secret,
  });

  try {
    const result = await client.testConnection();
    return {
      ok: true,
      egressIp,
      sampleCount: result.sampleCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha no teste';
    const ipBlocked = parseWhmcsInvalidIpError(message, egressIp);
    if (ipBlocked) {
      return {
        ok: false,
        egressIp,
        whmcsIpBlocked: true,
        blockedIp: ipBlocked.blockedIp,
        hint: ipBlocked.hint,
        error: message,
      };
    }
    const authFailed = parseWhmcsAuthFailedError(message);
    if (authFailed) {
      return {
        ok: false,
        egressIp,
        whmcsAuthFailed: true,
        hint: authFailed.hint,
        error: message,
      };
    }
    return {
      ok: false,
      egressIp,
      error: message,
    };
  }
}

export { formatWhmcsErrorForStorage };
