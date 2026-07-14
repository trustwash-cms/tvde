import { spawn } from 'child_process';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

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

spawn('npx', ['next', 'dev', '-p', port], {
  stdio: 'inherit',
  shell: true,
  cwd: join(__dirname, '..'),
});
