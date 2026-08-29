import { prisma } from '@tvde/database';
import { parseSshEndpoint, type VirtualizationZerotierJoinTargetPublic } from '@tvde/shared';
import { decrypt } from '../lib/crypto';
import { getWorkspaceSshCredentials } from './virtualization.service';
import { getLocalZerotierHostStatus } from './zerotier-local.service';
import {
  buildSshExecOptionsFromJoinTarget,
  buildZerotierInstallJoinScript,
  parseNodeIdFromProvisionOutput,
  sshExec,
} from './zerotier-ssh.service';
import { zerotierSetMemberAuthorized, type ZerotierClientConfig } from './zerotier.client';

function mapJoinTargetPublic(row: {
  id: string;
  accountId: string;
  networkRowId: string;
  label: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  useWorkspaceSsh: boolean;
  sshAuthMode: string;
  encryptedSshPassword: string | null;
  encryptedSshPrivateKey: string | null;
  encryptedSshPassphrase: string | null;
  targetKind: string;
  pbsServerId: string | null;
  pveServerId: string | null;
  nodeId: string | null;
  joinStatus: string;
  lastError: string | null;
  provisionLog: string | null;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  network: { networkId: string; label: string };
  account: { label: string; email: string | null };
}): VirtualizationZerotierJoinTargetPublic {
  return {
    id: row.id,
    accountId: row.accountId,
    accountLabel: row.account.label,
    accountEmail: row.account.email,
    networkRowId: row.networkRowId,
    networkId: row.network.networkId,
    networkLabel: row.network.label,
    label: row.label,
    sshHost: row.sshHost,
    sshPort: row.sshPort,
    sshUsername: row.sshUsername,
    useWorkspaceSsh: row.useWorkspaceSsh,
    sshAuthMode: row.sshAuthMode === 'private_key' ? 'private_key' : 'password',
    hasSshPassword: Boolean(row.encryptedSshPassword),
    hasSshPrivateKey: Boolean(row.encryptedSshPrivateKey),
    targetKind: row.targetKind as VirtualizationZerotierJoinTargetPublic['targetKind'],
    pbsServerId: row.pbsServerId,
    pveServerId: row.pveServerId,
    nodeId: row.nodeId,
    joinStatus: row.joinStatus as VirtualizationZerotierJoinTargetPublic['joinStatus'],
    lastError: row.lastError,
    provisionLog: row.provisionLog,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function getClientConfig(row: {
  encryptedApiToken: string;
  apiMode: string;
  orgId: string | null;
}): ZerotierClientConfig {
  return {
    apiToken: decrypt(row.encryptedApiToken),
    apiMode: row.apiMode === 'central' ? 'central' : 'legacy',
    orgId: row.orgId,
  };
}

export async function startZerotierJoinTargetProvision(
  tenantId: string,
  workspaceId: string,
  targetId: string
): Promise<VirtualizationZerotierJoinTargetPublic> {
  const target = await prisma.virtualizationZerotierJoinTarget.findFirst({
    where: { id: targetId, tenantId, workspaceId },
    include: {
      network: true,
      account: { select: { label: true, email: true } },
    },
  });
  if (!target) throw new Error('Alvo de join não encontrado');

  if (target.joinStatus === 'running') {
    return mapJoinTargetPublic(target);
  }

  const running = await prisma.virtualizationZerotierJoinTarget.update({
    where: { id: targetId },
    data: {
      joinStatus: 'running',
      lastError: null,
      lastRunAt: new Date(),
      provisionLog: '[zt] provisioning iniciado em background…',
    },
    include: {
      network: true,
      account: { select: { label: true, email: true } },
    },
  });

  void provisionZerotierJoinTarget(tenantId, workspaceId, targetId).catch((err) => {
    console.error(
      '[zerotier-provision]',
      targetId,
      err instanceof Error ? err.message : err
    );
  });

  return mapJoinTargetPublic(running);
}

export async function provisionZerotierJoinTarget(
  tenantId: string,
  workspaceId: string,
  targetId: string
): Promise<VirtualizationZerotierJoinTargetPublic> {
  const target = await prisma.virtualizationZerotierJoinTarget.findFirst({
    where: { id: targetId, tenantId, workspaceId },
    include: {
      network: true,
      account: true,
    },
  });
  if (!target) throw new Error('Alvo de join não encontrado');

  if (target.joinStatus !== 'running') {
    await prisma.virtualizationZerotierJoinTarget.update({
      where: { id: targetId },
      data: {
        joinStatus: 'running',
        lastError: null,
        lastRunAt: new Date(),
      },
    });
  }

  const logLines: string[] = [];
  const appendLog = (line: string) => {
    logLines.push(line);
  };

  try {
    const endpoint = parseSshEndpoint(target.sshHost, target.sshPort);
    const sshHost = endpoint.host;
    const sshPort = target.sshPort > 0 ? target.sshPort : endpoint.port;

    if (!sshHost) {
      throw new Error('Host SSH inválido');
    }

    if (sshHost !== target.sshHost || sshPort !== target.sshPort) {
      appendLog(
        `[ssh] host normalizado: ${target.sshHost}:${target.sshPort} → ${sshHost}:${sshPort}`
      );
      await prisma.virtualizationZerotierJoinTarget.update({
        where: { id: targetId },
        data: { sshHost, sshPort },
      });
      target.sshHost = sshHost;
      target.sshPort = sshPort;
    }

    try {
      const local = await getLocalZerotierHostStatus();
      if (!local.online) {
        appendLog(
          `[aviso] ZeroTier neste servidor (API: ${local.hostname}) não está online — hosts só na rede ZT podem falhar. Use «Instalar / join aqui» no painel.`
        );
      } else {
        appendLog(`[local] API host ZT OK · node ${local.nodeId}`);
      }
    } catch {
      /* ignore local probe errors */
    }

    appendLog(`[ssh] ${target.sshUsername}@${sshHost}:${sshPort} (${target.sshAuthMode})`);
    const script = buildZerotierInstallJoinScript(target.network.networkId);

    const workspaceSsh = target.useWorkspaceSsh
      ? await getWorkspaceSshCredentials(tenantId, workspaceId)
      : null;
    const sshAuthMode = target.useWorkspaceSsh
      ? workspaceSsh!.sshAuthMode
      : target.sshAuthMode === 'private_key'
        ? 'private_key'
        : 'password';

    const sshResult = await sshExec(
      buildSshExecOptionsFromJoinTarget({
        sshHost,
        sshPort,
        sshUsername: target.sshUsername,
        sshAuthMode,
        encryptedSshPassword: target.useWorkspaceSsh
          ? workspaceSsh!.encryptedSshPassword
          : target.encryptedSshPassword,
        encryptedSshPrivateKey: target.useWorkspaceSsh
          ? workspaceSsh!.encryptedSshPrivateKey
          : target.encryptedSshPrivateKey,
        encryptedSshPassphrase: target.useWorkspaceSsh
          ? workspaceSsh!.encryptedSshPassphrase
          : target.encryptedSshPassphrase,
        decrypt,
        command: `bash -s <<'ZT_EOF'\n${script}\nZT_EOF`,
        timeoutMs: 180_000,
      })
    );

    if (sshResult.stdout.trim()) appendLog(sshResult.stdout.trim());
    if (sshResult.stderr.trim()) appendLog(sshResult.stderr.trim());

    if (sshResult.code !== 0) {
      throw new Error(`SSH falhou (código ${sshResult.code})`);
    }

    const nodeId = parseNodeIdFromProvisionOutput(sshResult.stdout);
    if (!nodeId) {
      throw new Error('Instalação concluída mas node ID não detectado no output');
    }

    appendLog(`[api] a autorizar membro ${nodeId} como «${target.label}»…`);
    await zerotierSetMemberAuthorized(
      getClientConfig(target.account),
      target.network.networkId,
      nodeId,
      true,
      { name: target.label.trim() || `host-${nodeId.slice(0, 6)}` }
    );
    appendLog('[api] membro autorizado');

    const updated = await prisma.virtualizationZerotierJoinTarget.update({
      where: { id: targetId },
      data: {
        nodeId,
        joinStatus: 'authorized',
        lastError: null,
        provisionLog: logLines.join('\n'),
      },
      include: {
        network: true,
        account: { select: { label: true, email: true } },
      },
    });

    return mapJoinTargetPublic(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro no provisioning';
    appendLog(`[erro] ${message}`);
    const updated = await prisma.virtualizationZerotierJoinTarget.update({
      where: { id: targetId },
      data: {
        joinStatus: 'failed',
        lastError: message,
        provisionLog: logLines.join('\n'),
      },
      include: {
        network: true,
        account: { select: { label: true, email: true } },
      },
    });
    throw Object.assign(new Error(message), { target: mapJoinTargetPublic(updated) });
  }
}
