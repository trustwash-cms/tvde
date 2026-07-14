import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { config } from 'dotenv';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { prepareStandalone } from './prepare-standalone.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  let dir = resolve(__dirname, '../../..');
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadEnv();

const port = process.env.WEB_PORT || '3000';
const { serverDir, serverFile } = prepareStandalone();

if (!existsSync(serverFile)) {
  console.error(`Servidor standalone não encontrado: ${serverFile}`);
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: port,
  HOSTNAME: '0.0.0.0',
};

const child = spawn(process.execPath, [serverFile], {
  stdio: 'inherit',
  cwd: serverDir,
  env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
