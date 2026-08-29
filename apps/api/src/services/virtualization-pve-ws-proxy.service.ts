import { Client as SshClient } from 'ssh2';
import WebSocket, { type RawData } from 'ws';
import { formatPveAuthorizationHeader } from '@tvde/shared';
import type { PveConsoleSessionRecord, PveSshSessionRecord } from './virtualization-pve-sessions.service';

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(String(data));
}

export function proxyPveConsoleWebsocket(
  browser: WebSocket,
  session: PveConsoleSessionRecord
): void {
  const headers: Record<string, string> = {
    Authorization: formatPveAuthorizationHeader(session.config.apiToken),
  };

  const upstream = new WebSocket(session.pveWsUrl, {
    headers,
    rejectUnauthorized: session.config.verifySsl,
    perMessageDeflate: false,
  });

  let closed = false;
  let upstreamReady = false;
  const pendingFromBrowser: Buffer[] = [];

  const closeBoth = (code = 1000, reason = 'closed') => {
    if (closed) return;
    closed = true;
    try {
      if (browser.readyState === WebSocket.OPEN) browser.close(code, reason);
    } catch {
      // ignore
    }
    try {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    } catch {
      // ignore
    }
  };

  upstream.on('open', () => {
    if (session.mode === 'term') {
      // Protocolo Proxmox termproxy: primeiro frame = user:ticket\n
      upstream.send(`${session.user}:${session.ticket}\n`);
    }
    upstreamReady = true;
    for (const chunk of pendingFromBrowser) {
      upstream.send(chunk);
    }
    pendingFromBrowser.length = 0;
  });

  upstream.on('message', (data: RawData, isBinary: boolean) => {
    if (browser.readyState !== WebSocket.OPEN) return;
    const buf = toBuffer(data);
    // RFB/VNC e termproxy usam frames binários; forçar binary evita corrupção.
    browser.send(buf, { binary: isBinary || true });
  });

  upstream.on('error', (err: Error) => {
    closeBoth(1011, err.message.slice(0, 100));
  });

  upstream.on('close', () => closeBoth());

  browser.on('message', (data: RawData) => {
    const buf = toBuffer(data);
    if (!upstreamReady || upstream.readyState !== WebSocket.OPEN) {
      pendingFromBrowser.push(buf);
      return;
    }
    upstream.send(buf);
  });

  browser.on('close', () => closeBoth());
  browser.on('error', () => closeBoth(1011, 'browser error'));
}

export function proxyPveSshWebsocket(browser: WebSocket, session: PveSshSessionRecord): void {
  const conn = new SshClient();
  let closed = false;

  const closeBoth = (code = 1000, reason = 'closed') => {
    if (closed) return;
    closed = true;
    try {
      if (browser.readyState === WebSocket.OPEN) browser.close(code, reason);
    } catch {
      // ignore
    }
    try {
      conn.end();
    } catch {
      // ignore
    }
  };

  conn
    .on('ready', () => {
      conn.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          closeBoth(1011, err.message.slice(0, 100));
          return;
        }

        stream.on('data', (chunk: Buffer) => {
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(chunk, { binary: true });
          }
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          if (browser.readyState === WebSocket.OPEN) {
            browser.send(chunk, { binary: true });
          }
        });
        stream.on('close', () => closeBoth());

        browser.on('message', (data: RawData, isBinary: boolean) => {
          if (!stream.writable) return;
          if (!isBinary && typeof data === 'string') {
            try {
              const parsed = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
              if (parsed?.type === 'resize' && parsed.cols && parsed.rows) {
                stream.setWindow(parsed.rows, parsed.cols, 0, 0);
                return;
              }
            } catch {
              // plain text
            }
            stream.write(data);
            return;
          }
          const buf = toBuffer(data);
          const asText = buf.toString('utf8');
          try {
            const parsed = JSON.parse(asText) as { type?: string; cols?: number; rows?: number };
            if (parsed?.type === 'resize' && parsed.cols && parsed.rows) {
              stream.setWindow(parsed.rows, parsed.cols, 0, 0);
              return;
            }
          } catch {
            // binary/plain
          }
          stream.write(buf);
        });
      });
    })
    .on('error', (err: Error) => {
      closeBoth(1011, err.message.slice(0, 100));
    })
    .on('close', () => closeBoth());

  browser.on('close', () => closeBoth());
  browser.on('error', () => closeBoth(1011, 'browser error'));

  conn.connect({
    host: session.host,
    port: session.port,
    username: session.username,
    password: session.password,
    privateKey: session.privateKey,
    passphrase: session.passphrase,
    readyTimeout: 20_000,
    tryKeyboard: false,
  });
}
