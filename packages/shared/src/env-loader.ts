import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

/** Walk up from startDir until a .env file is found (monorepo root). */
export function findEnvFile(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 12; depth++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadEnvFile(startDir?: string): string | null {
  const path = findEnvFile(startDir);
  if (!path) return null;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require('dotenv') as typeof import('dotenv');
  config({ path });
  return path;
}
