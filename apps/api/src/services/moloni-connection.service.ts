import { prisma } from '@tvde/database';
import { MoloniClient, refreshAccessToken } from '@tvde/billing';
import { decrypt, encrypt } from '../lib/crypto';
import { env } from '../config/env';

export async function getBillingConnection(workspaceId: string) {
  return prisma.billingConnection.findUnique({ where: { workspaceId } });
}

export async function ensureMoloniAccessToken(workspaceId: string) {
  const row = await getBillingConnection(workspaceId);
  if (!row?.encryptedAccessToken || !row.encryptedRefreshToken) {
    throw new Error('Moloni não ligado — configure credenciais e autorize OAuth');
  }

  let accessToken = decrypt(row.encryptedAccessToken);
  const refreshToken = decrypt(row.encryptedRefreshToken);
  const clientSecret = decrypt(row.encryptedClientSecret);

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
