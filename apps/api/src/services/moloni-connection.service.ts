import { prisma } from '@tvde/database';
import { MoloniClient, refreshAccessToken } from '@tvde/billing';
import { canDecrypt, decrypt, encrypt, isCryptoAuthFailure } from '../lib/crypto';

/** Mensagem PT quando ENCRYPTION_KEY mudou ou ciphertext Moloni está corrompido. */
export const MOLONI_CRYPTO_REAUTH_MESSAGE =
  'Credenciais Moloni ilegíveis (ENCRYPTION_KEY alterada ou dados corrompidos). ' +
  'Guarde novamente o Client Secret e volte a ligar a conta Moloni (OAuth).';

export async function getBillingConnection(workspaceId: string) {
  return prisma.billingConnection.findUnique({ where: { workspaceId } });
}

/** Remove tokens OAuth (mantém clientId / secret / company se ainda legíveis). */
export async function clearMoloniOAuthTokens(workspaceId: string) {
  await prisma.billingConnection.update({
    where: { workspaceId },
    data: {
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      connectedAt: null,
    },
  });
}

export function assertMoloniClientSecretReadable(encryptedClientSecret: string): string {
  try {
    return decrypt(encryptedClientSecret);
  } catch (err) {
    if (isCryptoAuthFailure(err)) {
      throw new Error(MOLONI_CRYPTO_REAUTH_MESSAGE);
    }
    throw err;
  }
}

export function moloniSecretNeedsResave(encryptedClientSecret: string | null | undefined): boolean {
  return !canDecrypt(encryptedClientSecret);
}

export async function ensureMoloniAccessToken(workspaceId: string) {
  const row = await getBillingConnection(workspaceId);
  if (!row?.encryptedAccessToken || !row.encryptedRefreshToken) {
    throw new Error('Moloni não ligado — configure credenciais e autorize OAuth');
  }

  let accessToken: string;
  let refreshToken: string;
  let clientSecret: string;

  try {
    accessToken = decrypt(row.encryptedAccessToken);
    refreshToken = decrypt(row.encryptedRefreshToken);
    clientSecret = decrypt(row.encryptedClientSecret);
  } catch (err) {
    if (isCryptoAuthFailure(err)) {
      await clearMoloniOAuthTokens(workspaceId);
      throw new Error(MOLONI_CRYPTO_REAUTH_MESSAGE);
    }
    throw err;
  }

  const expiresSoon =
    row.tokenExpiresAt && row.tokenExpiresAt.getTime() - Date.now() < 5 * 60_000;

  if (expiresSoon) {
    const tokens = await refreshAccessToken(row.clientId, clientSecret, refreshToken);
    accessToken = tokens.accessToken;
    await prisma.billingConnection.update({
      where: { workspaceId },
      data: {
        encryptedAccessToken: encrypt(tokens.accessToken),
        encryptedRefreshToken: encrypt(tokens.refreshToken),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      },
    });
  }

  return {
    row,
    accessToken,
    clientSecret,
    refreshToken,
    moloniClient: new MoloniClient(accessToken),
  };
}
