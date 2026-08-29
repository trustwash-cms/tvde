import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { prisma } from '@tvde/database';
import type { VirtualizationZerotierLocalHostPublic } from '@tvde/shared';
import { decrypt } from '../lib/crypto';
import { getWorkspaceSshCredentials } from './virtualization.service';
import {
  buildSshExecOptionsFromJoinTarget,
  buildZerotierInstallJoinScript,
  parseNodeIdFromProvisionOutput,
  sshExec,
} from './zerotier-ssh.service';
import { zerotierSetMemberAuthorized, type ZerotierClientConfig } from './zerotier.client';

const execFileAsync = promisify(execFile);

const ZT_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin';

async function runLocal(
  command: string,
  args: string[],
  opts?: { sudo?: boolean; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string; code: number }> {
  const useSudo = Boolean(opts?.sudo) && process.getuid?.() !== 0;
  const bin = useSudo ? 'sudo' : command;
  const binArgs = useSudo ? ['-n', command, ...args] : args;
  try {
    const { stdout, stderr } = await execFileAsync(bin, binArgs, {
      timeout: opts?.timeoutMs ?? 15_000,
      env: { ...process.env, PATH: `${ZT_PATH}:${process.env.PATH ?? ''}` },
      maxBuffer: 2 * 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr), code: 0 };
  } catch (err) {
    const e = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const code = typeof e.code === 'number' ? e.code : 1;
    return {
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? e.message ?? ''),
      code,
    };
  }
}

async function resolveCliPath(): Promise<string | null> {
  const found = await runLocal('bash', [
    '-lc',
    `export PATH="${ZT_PATH}:$PATH"; command -v zerotier-cli || true`,
  ]);
  const path = found.stdout.trim().split('\n')[0]?.trim();
  return path || null;
}

async function canSudoNopass(): Promise<boolean> {
  if (process.getuid?.() === 0) return true;
  const cli = await resolveCliPath();
  if (cli) {
    const zt = await runLocal(cli, ['info'], { sudo: true });
    if (zt.code === 0) return true;
  }
  const check = await runLocal('sudo', ['-n', 'true']);
  return check.code === 0;
}

const SETUP_HINT =
  'No servidor da API corre uma vez: bash ~/tvde/scripts/setup-zerotier-api-host.sh (pede o sudo). Depois «Entrar em todas as redes». A password SSH do workspace é para PBS/PVE, não para este host.';

async function runScriptViaSudoBash(script: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn('sudo', ['-n', 'bash', '-s'], {
      env: { ...process.env, PATH: `${ZT_PATH}:${process.env.PATH ?? ''}` },
    });
    const out: string[] = [];
    const err: string[] = [];
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      resolve({ stdout: out.join(''), stderr: err.join('') || 'timeout', code: 1 });
    }, 180_000);
    child.stdout.on('data', (d) => out.push(String(d)));
    child.stderr.on('data', (d) => err.push(String(d)));
    child.on('close', (c) => {
      clearTimeout(timer);
      resolve({ stdout: out.join(''), stderr: err.join(''), code: c ?? 1 });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: e.message, code: 1 });
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

/** Join/authorize usando só `sudo -n zerotier-cli` (após setup-zerotier-api-host.sh). */
async function provisionViaSudoZerotierCli(
  networkId: string,
  append: (line: string) => void
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cli = await resolveCliPath();
  if (!cli) {
    return { stdout: '', stderr: 'zerotier-cli não encontrado', code: 1 };
  }

  append(`[local] sudo -n ${cli} …`);
  const infoBefore = await runLocal(cli, ['info'], { sudo: true });
  if (infoBefore.code !== 0) {
    return {
      stdout: infoBefore.stdout,
      stderr: infoBefore.stderr || 'sudo -n zerotier-cli info falhou',
      code: infoBefore.code,
    };
  }
  if (infoBefore.stdout.trim()) append(infoBefore.stdout.trim());

  const join = await runLocal(cli, ['join', networkId], { sudo: true, timeoutMs: 60_000 });
  if (join.stdout.trim()) append(join.stdout.trim());
  if (join.stderr.trim()) append(join.stderr.trim());
  if (join.code !== 0) {
    return { stdout: join.stdout, stderr: join.stderr, code: join.code };
  }

  await new Promise((r) => setTimeout(r, 2000));
  const infoAfter = await runLocal(cli, ['info'], { sudo: true });
  const list = await runLocal(cli, ['listnetworks'], { sudo: true });
  const nodeMatch = infoAfter.stdout.match(/\b200\s+info\s+([a-f0-9]{10})\b/i);
  if (nodeMatch?.[1]) append(`[zt] node_id=${nodeMatch[1].toLowerCase()}`);
  if (list.stdout.trim()) append(list.stdout.trim());
  return {
    stdout: [infoAfter.stdout, list.stdout, nodeMatch?.[1] ? `[zt] node_id=${nodeMatch[1].toLowerCase()}` : '']
      .filter(Boolean)
      .join('\n'),
    stderr: `${infoAfter.stderr}${list.stderr}`,
    code: infoAfter.code,
  };
}

function parseNetworks(listOutput: string): VirtualizationZerotierLocalHostPublic['networks'] {
  const lines = listOutput
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^200\s+listnetworks/i.test(l) && !/^nwid\b/i.test(l));

  const networks: VirtualizationZerotierLocalHostPublic['networks'] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    // zerotier-cli listnetworks: <nwid> <name> <mac> <status> ...
    const networkId = parts.find((p) => /^[0-9a-f]{16}$/i.test(p));
    if (!networkId) continue;
    const status =
      parts.find((p) =>
        /^(OK|ACCESS_DENIED|NOT_FOUND|REQUESTING_CONFIGURATION|PORT_ERROR|CLIENT_TOO_OLD)$/i.test(p)
      ) ?? parts[3] ?? 'unknown';
    const nameIdx = parts.indexOf(networkId);
    const name = nameIdx >= 0 && parts[nameIdx + 1] && !/^[0-9a-f:]{11,}$/i.test(parts[nameIdx + 1])
      ? parts[nameIdx + 1]
      : null;
    networks.push({
      networkId: networkId.toLowerCase(),
      status,
      name: name && name !== '-' ? name : null,
    });
  }
  return networks;
}

export async function getLocalZerotierHostStatus(): Promise<VirtualizationZerotierLocalHostPublic> {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const isRoot = process.getuid?.() === 0;
  const sudoPasswordless = await canSudoNopass();
  const cliPath = await resolveCliPath();

  if (!cliPath) {
    return {
      hostname,
      username,
      isRoot,
      sudoPasswordless,
      cliPath: null,
      installed: false,
      online: false,
      nodeId: null,
      version: null,
      networks: [],
      lastError: null,
      hint: sudoPasswordless
        ? 'ZeroTier não instalado neste servidor. Use «Instalar / join aqui» com uma rede associada.'
        : SETUP_HINT,
    };
  }

  const infoAsUser = await runLocal(cliPath, ['info']);
  let info = infoAsUser;
  let usedSudo = false;
  if (infoAsUser.code !== 0 && !isRoot) {
    const infoSudo = await runLocal(cliPath, ['info'], { sudo: true });
    if (infoSudo.code === 0) {
      info = infoSudo;
      usedSudo = true;
    }
  }

  if (info.code !== 0) {
    const needsRoot =
      /authtoken|permission|readable|try again as root/i.test(info.stderr + info.stdout) ||
      /authtoken|permission|readable|try again as root/i.test(infoAsUser.stderr + infoAsUser.stdout);
    return {
      hostname,
      username,
      isRoot,
      sudoPasswordless,
      cliPath,
      installed: true,
      online: false,
      nodeId: null,
      version: null,
      networks: [],
      lastError: (info.stderr || info.stdout || 'zerotier-cli info falhou').trim().slice(0, 500),
      hint: needsRoot
        ? sudoPasswordless
          ? 'CLI instalado mas precisa de root (sudo). Tente «Instalar / join aqui».'
          : SETUP_HINT
        : 'zerotier-cli instalado mas o serviço não responde.',
    };
  }

  const infoLine = info.stdout.trim().split('\n')[0] ?? '';
  const infoMatch = infoLine.match(/\b200\s+info\s+([a-f0-9]{10})\s+(\S+)/i);
  const nodeId = infoMatch?.[1]?.toLowerCase() ?? null;
  const version = infoMatch?.[2] ?? null;

  const list = await runLocal(cliPath, ['listnetworks'], { sudo: usedSudo || (!isRoot && sudoPasswordless) });
  const networks = list.code === 0 ? parseNetworks(list.stdout) : [];

  return {
    hostname,
    username,
    isRoot,
    sudoPasswordless,
    cliPath,
    installed: true,
    online: Boolean(nodeId),
    nodeId,
    version,
    networks,
    lastError: list.code !== 0 ? (list.stderr || list.stdout).trim().slice(0, 300) : null,
    hint: networks.length === 0
      ? 'ZeroTier online, mas ainda sem redes. Faça join a uma rede associada.'
      : null,
  };
}

function getClientConfig(row: {
  apiMode: string;
  encryptedApiToken: string;
  orgId: string | null;
}): ZerotierClientConfig {
  return {
    apiMode: row.apiMode === 'central' ? 'central' : 'legacy',
    apiToken: decrypt(row.encryptedApiToken),
    orgId: row.orgId,
  };
}

/**
 * Instala/join ZeroTier no servidor onde a API corre.
 * 1) Preferência: sudo -n zerotier-cli (após scripts/setup-zerotier-api-host.sh)
 * 2) Fallback: sudo -n bash (NOPASSWD total)
 * 3) Último recurso: SSH 127.0.0.1 com credenciais do workspace (só se forem deste host)
 */
export async function provisionLocalZerotierHost(
  tenantId: string,
  workspaceId: string,
  networkRowId: string
): Promise<{
  local: VirtualizationZerotierLocalHostPublic;
  nodeId: string | null;
  provisionLog: string;
}> {
  const network = await prisma.virtualizationZerotierNetwork.findFirst({
    where: { id: networkRowId, tenantId, workspaceId },
    include: { account: true },
  });
  if (!network) throw new Error('Rede ZeroTier não encontrada');

  const logLines: string[] = [];
  const append = (line: string) => logLines.push(line);

  const workspaceSsh = await getWorkspaceSshCredentials(tenantId, workspaceId);
  const script = buildZerotierInstallJoinScript(network.networkId);
  let stdout = '';
  let stderr = '';
  let code = 1;

  const viaCli = await provisionViaSudoZerotierCli(network.networkId, append);
  if (viaCli.code === 0) {
    stdout = viaCli.stdout;
    stderr = viaCli.stderr;
    code = 0;
  } else if (await canSudoNopass()) {
    append('[local] a provisionar com sudo -n bash');
    const viaSudo = await runScriptViaSudoBash(script);
    stdout = viaSudo.stdout;
    stderr = viaSudo.stderr;
    code = viaSudo.code;
  } else {
    const hasWorkspaceSsh =
      (workspaceSsh.sshAuthMode === 'password' && Boolean(workspaceSsh.encryptedSshPassword)) ||
      (workspaceSsh.sshAuthMode === 'private_key' && Boolean(workspaceSsh.encryptedSshPrivateKey));

    if (!hasWorkspaceSsh) {
      throw Object.assign(new Error(SETUP_HINT), { provisionLog: logLines.join('\n') });
    }

    append(
      `[local] fallback SSH ${workspaceSsh.sshDefaultUsername}@127.0.0.1:${workspaceSsh.sshDefaultPort} (só funciona se for a password/chave DESTE servidor, não a dos PBS/PVE)`
    );
    try {
      const sshResult = await sshExec(
        buildSshExecOptionsFromJoinTarget({
          sshHost: '127.0.0.1',
          sshPort: workspaceSsh.sshDefaultPort || 22,
          sshUsername: workspaceSsh.sshDefaultUsername || 'root',
          sshAuthMode: workspaceSsh.sshAuthMode,
          encryptedSshPassword: workspaceSsh.encryptedSshPassword,
          encryptedSshPrivateKey: workspaceSsh.encryptedSshPrivateKey,
          encryptedSshPassphrase: workspaceSsh.encryptedSshPassphrase,
          decrypt,
          command: `bash -s <<'ZT_EOF'\n${script}\nZT_EOF`,
          timeoutMs: 180_000,
        })
      );
      stdout = sshResult.stdout;
      stderr = sshResult.stderr;
      code = sshResult.code;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      append(`[erro] SSH local: ${msg}`);
      throw Object.assign(
        new Error(
          /authentication methods failed|All configured authentication/i.test(msg)
            ? SETUP_HINT
            : msg
        ),
        { provisionLog: logLines.join('\n') }
      );
    }
  }

  if (stdout.trim()) append(stdout.trim());
  if (stderr.trim()) append(stderr.trim());

  if (code !== 0) {
    const authFail = /authentication methods failed|All configured authentication/i.test(
      `${stdout}\n${stderr}`
    );
    throw Object.assign(
      new Error(authFail ? SETUP_HINT : `Provisionamento local falhou (código ${code})`),
      { provisionLog: logLines.join('\n') }
    );
  }

  let nodeId = parseNodeIdFromProvisionOutput(stdout + '\n' + logLines.join('\n'));
  if (!nodeId) {
    const status = await getLocalZerotierHostStatus();
    nodeId = status.nodeId;
  }

  if (!nodeId) {
    throw Object.assign(new Error('Não foi possível obter o node ID ZeroTier local'), {
      provisionLog: logLines.join('\n'),
    });
  }

  append(`[zt] a autorizar node ${nodeId} na rede ${network.networkId}`);
  await zerotierSetMemberAuthorized(
    getClientConfig(network.account),
    network.networkId,
    nodeId,
    true
  );
  append('[zt] membro autorizado');

  const local = await getLocalZerotierHostStatus();
  return { local, nodeId, provisionLog: logLines.join('\n') };
}

const localJoinInFlight = new Set<string>();

export type LocalZerotierEnsureResult = {
  networkRowId: string;
  networkId: string;
  skipped: boolean;
  reason?: string;
  nodeId: string | null;
  provisionLog: string;
  error?: string;
};

/**
 * Garante que o servidor da API está nesta rede ZT (join + authorize).
 * Idempotente: se já estiver OK, só reautoriza na Central se necessário.
 */
export async function ensureLocalZerotierOnNetwork(
  tenantId: string,
  workspaceId: string,
  networkRowId: string
): Promise<LocalZerotierEnsureResult> {
  const key = `${workspaceId}:${networkRowId}`;
  if (localJoinInFlight.has(key)) {
    return {
      networkRowId,
      networkId: '',
      skipped: true,
      reason: 'in_flight',
      nodeId: null,
      provisionLog: '[local] join já em curso',
    };
  }

  localJoinInFlight.add(key);
  try {
    const network = await prisma.virtualizationZerotierNetwork.findFirst({
      where: { id: networkRowId, tenantId, workspaceId },
      include: { account: true },
    });
    if (!network) {
      return {
        networkRowId,
        networkId: '',
        skipped: true,
        reason: 'not_found',
        nodeId: null,
        provisionLog: '',
        error: 'Rede não encontrada',
      };
    }

    const local = await getLocalZerotierHostStatus();
    const membership = local.networks.find((n) => n.networkId === network.networkId);

    if (local.nodeId && membership && /^OK$/i.test(membership.status)) {
      try {
        await zerotierSetMemberAuthorized(
          getClientConfig(network.account),
          network.networkId,
          local.nodeId,
          true
        );
      } catch {
        /* already authorized */
      }
      return {
        networkRowId,
        networkId: network.networkId,
        skipped: true,
        reason: 'already_ok',
        nodeId: local.nodeId,
        provisionLog: `[local] já na rede ${network.networkId} (OK)`,
      };
    }

    if (local.nodeId && membership && /ACCESS_DENIED/i.test(membership.status)) {
      await zerotierSetMemberAuthorized(
        getClientConfig(network.account),
        network.networkId,
        local.nodeId,
        true
      );
      return {
        networkRowId,
        networkId: network.networkId,
        skipped: false,
        reason: 'authorized_only',
        nodeId: local.nodeId,
        provisionLog: `[local] autorizado node ${local.nodeId} na rede ${network.networkId}`,
      };
    }

    const provisioned = await provisionLocalZerotierHost(tenantId, workspaceId, networkRowId);
    return {
      networkRowId,
      networkId: network.networkId,
      skipped: false,
      reason: 'provisioned',
      nodeId: provisioned.nodeId,
      provisionLog: provisioned.provisionLog,
    };
  } catch (err) {
    return {
      networkRowId,
      networkId: '',
      skipped: false,
      nodeId: null,
      provisionLog: '',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    localJoinInFlight.delete(key);
  }
}

/** Junta o servidor da API a todas as redes ZT activas do workspace. */
export async function ensureLocalZerotierOnAllWorkspaceNetworks(
  tenantId: string,
  workspaceId: string
): Promise<{
  local: VirtualizationZerotierLocalHostPublic;
  results: LocalZerotierEnsureResult[];
}> {
  const networks = await prisma.virtualizationZerotierNetwork.findMany({
    where: { tenantId, workspaceId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const results: LocalZerotierEnsureResult[] = [];
  for (const network of networks) {
    results.push(await ensureLocalZerotierOnNetwork(tenantId, workspaceId, network.id));
  }

  return {
    local: await getLocalZerotierHostStatus(),
    results,
  };
}

/** Dispara join local em background (não bloqueia a resposta HTTP). */
export function startLocalZerotierEnsureInBackground(
  tenantId: string,
  workspaceId: string,
  networkRowId: string
): void {
  void ensureLocalZerotierOnNetwork(tenantId, workspaceId, networkRowId).then((result) => {
    if (result.error) {
      console.error('[zerotier-local] auto-join falhou', networkRowId, result.error);
    } else {
      console.log(
        '[zerotier-local] auto-join',
        result.networkId || networkRowId,
        result.skipped ? `skip:${result.reason}` : result.reason
      );
    }
  });
}
