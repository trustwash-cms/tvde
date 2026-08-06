import { prisma } from '@tvde/database';
import { BoltFleetClient } from '@tvde/bolt';
import { canDecrypt, decrypt, encrypt, isCryptoAuthFailure } from '../lib/crypto';

/** Mensagem PT quando ENCRYPTION_KEY mudou ou ciphertext Bolt está corrompido. */
export const BOLT_CRYPTO_RESAVE_MESSAGE =
  'Client Secret Bolt ilegível (ENCRYPTION_KEY alterada ou dados corrompidos). ' +
  'Cole novamente o Client Secret e guarde.';

export async function getBoltConnection(workspaceId: string) {
  return prisma.boltConnection.findUnique({ where: { workspaceId } });
}

export async function ensureBoltClient(workspaceId: string) {
  const row = await getBoltConnection(workspaceId);
  if (!row?.encryptedClientSecret) {
    throw new Error('Bolt API não configurada — defina credenciais em Configurações → Bolt API');
  }
  if (!row.isActive) {
    throw new Error('Integração Bolt desactivada para este workspace');
  }
  if (!row.boltCompanyId) {
    throw new Error('Bolt sem company_id — teste a ligação nas configurações');
  }

  let clientSecret: string;
  try {
    clientSecret = decrypt(row.encryptedClientSecret);
  } catch (err) {
    if (isCryptoAuthFailure(err)) {
      throw new Error(BOLT_CRYPTO_RESAVE_MESSAGE);
    }
    throw err;
  }

  const client = new BoltFleetClient({
    clientId: row.clientId,
    clientSecret,
  });

  return { row, client };
}

export async function upsertBoltConnection(input: {
  workspaceId: string;
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  boltCompanyId?: number;
}) {
  const existing = await getBoltConnection(input.workspaceId);
  const encryptedClientSecret =
    input.clientSecret?.trim()
      ? encrypt(input.clientSecret.trim())
      : existing?.encryptedClientSecret;

  if (!encryptedClientSecret) {
    throw new Error('Client Secret é obrigatório na primeira configuração');
  }

  return prisma.boltConnection.upsert({
    where: { workspaceId: input.workspaceId },
    update: {
      clientId: input.clientId.trim(),
      encryptedClientSecret,
      ...(input.boltCompanyId !== undefined ? { boltCompanyId: input.boltCompanyId } : {}),
      isActive: true,
      lastError: null,
      connectedAt: existing?.connectedAt ?? new Date(),
    },
    create: {
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      clientId: input.clientId.trim(),
      encryptedClientSecret,
      boltCompanyId: input.boltCompanyId ?? null,
      isActive: true,
      connectedAt: new Date(),
    },
  });
}

export async function testBoltCredentials(
  clientId: string,
  clientSecret: string,
  boltCompanyId?: number
) {
  const client = new BoltFleetClient({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
  return client.testConnection(
    boltCompanyId != null && Number.isFinite(boltCompanyId) ? { companyId: boltCompanyId } : undefined
  );
}
