/**
 * Copia assets estáticos para o bundle standalone (obrigatório com output: standalone).
 * Correr após `next build` — também invocado por start.mjs se faltar sync.
 */
import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, '..');
const standaloneRoot = join(webRoot, '.next/standalone');

export function prepareStandalone() {
  if (!existsSync(standaloneRoot)) {
    throw new Error('Build standalone em falta — correr: npm run build -w @tvde/web');
  }

  const serverDir = existsSync(join(standaloneRoot, 'apps/web/server.js'))
    ? join(standaloneRoot, 'apps/web')
    : standaloneRoot;

  const staticSrc = join(webRoot, '.next/static');
  const staticDest = join(serverDir, '.next/static');
  if (existsSync(staticSrc)) {
    mkdirSync(dirname(staticDest), { recursive: true });
    cpSync(staticSrc, staticDest, { recursive: true });
  }

  const publicSrc = join(webRoot, 'public');
  const publicDest = join(serverDir, 'public');
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, publicDest, { recursive: true });
  }

  return { serverDir, serverFile: join(serverDir, 'server.js') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { serverFile } = prepareStandalone();
  console.log(`Standalone ready: ${serverFile}`);
}
