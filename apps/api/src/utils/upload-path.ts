import { existsSync } from 'node:fs';
import path from 'node:path';

let cachedMonorepoRoot: string | null = null;

/** Raiz do monorepo (pasta com apps/ e packages/), independente do cwd. */
export function resolveMonorepoRoot(): string {
  if (cachedMonorepoRoot) return cachedMonorepoRoot;

  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(path.join(dir, 'apps', 'api')) &&
      existsSync(path.join(dir, 'packages', 'database'))
    ) {
      cachedMonorepoRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cachedMonorepoRoot = process.cwd();
  return cachedMonorepoRoot;
}

/** Resolve caminhos de upload relativos à raiz do monorepo (não ao cwd do processo). */
export function resolveUploadRoot(configured: string): string {
  if (path.isAbsolute(configured)) return configured;
  return path.join(resolveMonorepoRoot(), configured);
}

/** Caminho efectivo de um ficheiro — suporta uploads legados em apps/api/uploads. */
export function resolveStorageFilePath(configured: string, storageKey: string): string {
  const primary = path.join(resolveUploadRoot(configured), storageKey);
  if (existsSync(primary)) return primary;

  const legacy = path.join(resolveMonorepoRoot(), 'apps', 'api', configured, storageKey);
  if (existsSync(legacy)) return legacy;

  return primary;
}
