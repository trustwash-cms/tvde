import { Client as SshClient } from 'ssh2';
import WebSocket from 'ws';
import { formatPveAuthorizationHeader } from '@tvde/shared';
import type { PveConsoleSessionRecord, PveSshSessionRecord } from './virtualization-pve-sessions.service';

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
      upstream.send(`${session.user}:${session.ticket}\n`);
    }
  });

  upstream.on('message', (data, isBinary) => {
    if (browser.readyState !== WebSocket.OPEN) return;
    if (isBinary || Buffer.isBuffer(data)) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      browser.send(buf, { binary: true });
    } else {
      browser.send(String(data));
    }
  });

  upstream.on('error', (err) => {
    closeBoth(1011, err.message.slice(0, 100));
  });

  upstream.on('close', () => closeBoth());

  browser.on('message', (data, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary || Buffer.isBuffer(data)) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      upstream.send(buf);
    } else {
      upstream.send(String(data));
    }
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

        browser.on('message', (data, isBinary) => {
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
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
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
    .on('error', (err) => {
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
