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
  const check = await runLocal('sudo', ['-n', 'true']);
  return check.code === 0;
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
        ? 'ZeroTier não instalado neste servidor. Use «Instalar neste servidor» com uma rede associada.'
        : 'ZeroTier não instalado. A app corre como utilizador sem sudo sem password — o install usa SSH root@127.0.0.1 com as credenciais SSH do workspace.',
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
          ? 'CLI instalado mas precisa de root (sudo). Tente «Instalar / join neste servidor».'
          : 'CLI presente (ex. snap) mas sem serviço/root. Instale o pacote oficial via «Instalar neste servidor» (SSH root@127.0.0.1).'
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
 * Preferência: SSH root@127.0.0.1 com credenciais do workspace (macbusinesss não tem sudo NOPASSWD).
 * Fallback: sudo -n local se disponível.
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

  const hasWorkspaceSsh =
    (workspaceSsh.sshAuthMode === 'password' && Boolean(workspaceSsh.encryptedSshPassword)) ||
    (workspaceSsh.sshAuthMode === 'private_key' && Boolean(workspaceSsh.encryptedSshPrivateKey));

  if (hasWorkspaceSsh) {
    append(
      `[local] a provisionar via SSH ${workspaceSsh.sshDefaultUsername}@127.0.0.1:${workspaceSsh.sshDefaultPort} (credenciais do workspace)`
    );
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
  } else if (await canSudoNopass()) {
    append('[local] a provisionar com sudo -n (sem password)');
    const viaSudo = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
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
    stdout = viaSudo.stdout;
    stderr = viaSudo.stderr;
    code = viaSudo.code;
  } else {
    throw new Error(
      'Configure as credenciais SSH do workspace (utilizador root) — a app corre como macbusinesss sem sudo sem password, e usa SSH a 127.0.0.1 para instalar ZeroTier neste servidor.'
    );
  }

  if (stdout.trim()) append(stdout.trim());
  if (stderr.trim()) append(stderr.trim());

  if (code !== 0) {
    throw Object.assign(new Error(`Provisionamento local falhou (código ${code})`), {
      provisionLog: logLines.join('\n'),
    });
  }

  let nodeId = parseNodeIdFromProvisionOutput(stdout);
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
