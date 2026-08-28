import { prisma } from '@tvde/database';
import { canDecrypt } from '../lib/crypto';
import { isTenantModuleAllowed } from './tenant-modules.service';
import {
  BOLT_CRYPTO_RESAVE_MESSAGE,
  getBoltConnection,
  testBoltCredentials,
  upsertBoltConnection,
} from './bolt-connection.service';

export async function getBoltPublicStatus(workspaceId: string, tenantId: string) {
  const [row, tenantAllowed, workspaceModule] = await Promise.all([
    getBoltConnection(workspaceId),
    isTenantModuleAllowed(tenantId, 'bolt'),
    prisma.workspaceModule.findUnique({
      where: { workspaceId_moduleKey: { workspaceId, moduleKey: 'bolt' } },
    }),
  ]);

  const configured = Boolean(row?.clientId && row.encryptedClientSecret);
  const moduleActive = workspaceModule?.enabled ?? false;
  const secretNeedsResave =
    Boolean(row?.encryptedClientSecret) && !canDecrypt(row?.encryptedClientSecret);

  return {
    configured,
    connected: configured && Boolean(row?.boltCompanyId) && !secretNeedsResave,
    healthy: configured && !row?.lastError && !secretNeedsResave,
    secretNeedsResave,
    moduleAuthorized: tenantAllowed,
    moduleActive,
    clientId: row?.clientId ?? null,
    boltCompanyId: row?.boltCompanyId ?? null,
    statusMessage: secretNeedsResave
      ? BOLT_CRYPTO_RESAVE_MESSAGE
      : (row?.lastError ?? (configured ? 'Operacional' : 'Não configurado')),
    lastSyncAtOrders: row?.lastSyncAtOrders?.toISOString() ?? null,
    lastSyncAtDrivers: row?.lastSyncAtDrivers?.toISOString() ?? null,
    lastSyncAtVehicles: row?.lastSyncAtVehicles?.toISOString() ?? null,
    autoSyncEnabled: row?.autoSyncEnabled ?? true,
  };
}

export async function saveBoltConfig(input: {
  workspaceId: string;
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  boltCompanyId?: number;
}) {
  let boltCompanyId = input.boltCompanyId;

  if (input.clientSecret?.trim()) {
    const test = await testBoltCredentials(input.clientId, input.clientSecret, boltCompanyId);
    boltCompanyId = test.companyId;
  } else {
    const existing = await getBoltConnection(input.workspaceId);
    if (!existing?.boltCompanyId && boltCompanyId == null) {
      throw new Error('Indique o Client Secret ou o ID da empresa Bolt na primeira configuração');
    }
    boltCompanyId = boltCompanyId ?? existing?.boltCompanyId ?? undefined;
  }

  if (boltCompanyId == null) {
    throw new Error('Não foi possível determinar o ID da empresa Bolt');
  }

  return upsertBoltConnection({
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    boltCompanyId,
  });
}

export async function testBoltConnection(input: {
  clientId: string;
  clientSecret: string;
  boltCompanyId?: number;
}) {
  const result = await testBoltCredentials(input.clientId, input.clientSecret, input.boltCompanyId);
  return {
    companyId: result.companyId,
    companies: result.companies,
  };
}

export async function setBoltAutoSync(workspaceId: string, enabled: boolean) {
  const existing = await getBoltConnection(workspaceId);
  if (!existing) {
    throw new Error('Configure a API Bolt antes de activar a sincronização automática');
  }
  return prisma.boltConnection.update({
    where: { workspaceId },
    data: { autoSyncEnabled: enabled },
  });
}
