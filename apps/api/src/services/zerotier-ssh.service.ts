import { Client, type ConnectConfig } from 'ssh2';

export interface SshExecOptions {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  command: string;
  timeoutMs?: number;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

function buildConnectConfig(options: SshExecOptions): ConnectConfig {
  const base: ConnectConfig = {
    host: options.host,
    port: options.port,
    username: options.username,
    readyTimeout: Math.min(options.timeoutMs ?? 120_000, 30_000),
  };

  if (options.privateKey?.trim()) {
    return {
      ...base,
      privateKey: options.privateKey,
      passphrase: options.passphrase?.trim() || undefined,
    };
  }

  if (options.password != null) {
    return { ...base, password: options.password };
  }

  throw new Error('Credenciais SSH em falta (password ou chave privada)');
}

export async function sshExec(options: SshExecOptions): Promise<SshExecResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const chunksOut: string[] = [];
    const chunksErr: string[] = [];

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        // ignore
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`SSH timeout após ${Math.round(timeoutMs / 1000)}s`)));
    }, timeoutMs);

    let connectConfig: ConnectConfig;
    try {
      connectConfig = buildConnectConfig(options);
    } catch (err) {
      finish(() => reject(err));
      return;
    }

    conn
      .on('ready', () => {
        conn.exec(options.command, (err, stream) => {
          if (err) {
            finish(() => reject(err));
            return;
          }

          stream.on('close', (code: number) => {
            finish(() =>
              resolve({
                stdout: chunksOut.join(''),
                stderr: chunksErr.join(''),
                code: code ?? 0,
              })
            );
          });
          stream.on('data', (data: Buffer | string) => {
            chunksOut.push(String(data));
          });
          stream.stderr.on('data', (data: Buffer | string) => {
            chunksErr.push(String(data));
          });
        });
      })
      .on('error', (err) => {
        finish(() => reject(err));
      })
      .connect(connectConfig);
  });
}

export function buildZerotierInstallJoinScript(networkId: string): string {
  const safeNetworkId = networkId.trim().toLowerCase();
  return [
    'set -e',
    'export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"',
    'if [ "$(id -u)" -eq 0 ]; then',
    '  SUDO=""',
    'elif command -v sudo >/dev/null 2>&1; then',
    '  SUDO="sudo "',
    'else',
    '  echo "[zt] erro: precisa de root ou sudo instalado" >&2',
    '  exit 1',
    'fi',
    'ZT_CLI="$(command -v zerotier-cli || true)"',
    'if [ -n "$ZT_CLI" ] && ${SUDO}"$ZT_CLI" info >/dev/null 2>&1; then',
    '  echo "[zt] zerotier-cli já instalado e a responder ($ZT_CLI)"',
    'else',
    '  echo "[zt] a instalar ZeroTier (pacote oficial)…"',
    '  curl -fsSL https://install.zerotier.com | ${SUDO}bash',
    '  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"',
    '  ZT_CLI="$(command -v zerotier-cli || true)"',
    'fi',
    'if [ -z "$ZT_CLI" ]; then',
    '  echo "[zt] erro: zerotier-cli não encontrado após instalação" >&2',
    '  exit 1',
    'fi',
    `${'${SUDO}'}"$ZT_CLI" join ${safeNetworkId}`,
    'sleep 3',
    'NODE_ID=$(${SUDO}"$ZT_CLI" info 2>/dev/null | awk \'{print $3}\')',
    'if [ -z "$NODE_ID" ]; then',
    '  echo "[zt] erro: não foi possível obter node ID" >&2',
    '  exit 1',
    'fi',
    'echo "[zt] node_id=$NODE_ID"',
    `echo "[zt] join apenas à rede ${safeNetworkId} (outras redes no listnetworks já existiam neste host)"`,
    `${'${SUDO}'}"$ZT_CLI" listnetworks | grep -i "${safeNetworkId}" || true`,
  ].join('\n');
}

export function parseNodeIdFromProvisionOutput(stdout: string): string | null {
  const tagged = stdout.match(/\[zt\] node_id=([a-f0-9]{10})/i);
  if (tagged?.[1]) return tagged[1].toLowerCase();

  const info = stdout.match(/\b200 info ([a-f0-9]{10})\b/i);
  if (info?.[1]) return info[1].toLowerCase();

  return null;
}

export function buildSshExecOptionsFromJoinTarget(target: {
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthMode: string;
  encryptedSshPassword: string | null;
  encryptedSshPrivateKey: string | null;
  encryptedSshPassphrase: string | null;
  decrypt: (value: string) => string;
  command: string;
  timeoutMs?: number;
}): SshExecOptions {
  const base = {
    host: target.sshHost,
    port: target.sshPort,
    username: target.sshUsername,
    command: target.command,
    timeoutMs: target.timeoutMs,
  };

  if (target.sshAuthMode === 'private_key') {
    if (!target.encryptedSshPrivateKey) {
      throw new Error('Chave privada SSH não configurada');
    }
    return {
      ...base,
      privateKey: target.decrypt(target.encryptedSshPrivateKey),
      passphrase: target.encryptedSshPassphrase
        ? target.decrypt(target.encryptedSshPassphrase)
        : undefined,
    };
  }

  if (!target.encryptedSshPassword) {
    throw new Error('Password SSH não configurada');
  }

  return {
    ...base,
    password: target.decrypt(target.encryptedSshPassword),
  };
}
