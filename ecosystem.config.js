/** PM2 — TVDE API + Web (produção / VM) */
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = __dirname;
const playwrightLibs = path.join(root, '.playwright-libs');
const playwrightLibPath = [
  path.join(playwrightLibs, 'usr/lib/x86_64-linux-gnu'),
  path.join(playwrightLibs, 'lib/x86_64-linux-gnu'),
]
  .filter((p) => fs.existsSync(p))
  .join(':');

/** Carregar DISPLAY / PORTAL_RPA_* do .env da raiz (PM2 não faz dotenv sozinho). */
function readEnvFile() {
  const envPath = path.join(root, '.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = readEnvFile();
const display = fileEnv.DISPLAY || process.env.DISPLAY || ':1';
const home = process.env.HOME || os.homedir();
const tvdeX11Root = path.join(home, 'tvde-x11', 'root');
const tvdeX11Bin = path.join(tvdeX11Root, 'usr/bin');
const tvdeX11Lib = [
  path.join(tvdeX11Root, 'usr/lib/x86_64-linux-gnu'),
  path.join(tvdeX11Root, 'lib/x86_64-linux-gnu'),
].filter((p) => fs.existsSync(p));
const xauthCandidates = [
  fileEnv.XAUTHORITY,
  fileEnv.PORTAL_RPA_XAUTHORITY,
  path.join(root, '.xauthority-vnc'),
  '/tmp/tvde-xauth',
  path.join(home, '.Xauthority'),
].filter((p) => p && fs.existsSync(p));

const apiEnv = {
  NODE_ENV: 'production',
  PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL: '0',
  DISPLAY: display,
  ...(xauthCandidates[0] ? { XAUTHORITY: xauthCandidates[0] } : {}),
  TVDE_X11_ROOT: fs.existsSync(path.join(tvdeX11Root, 'usr/bin/Xvfb')) ? tvdeX11Root : undefined,
  // Arkose: Chromium headed no Xvfb para o stream «Desafio Uber» pintar
  PORTAL_RPA_UBER_HEADED_CONNECT: fileEnv.PORTAL_RPA_UBER_HEADED_CONNECT || 'true',
  PORTAL_RPA_UBER_INTERACTIVE: fileEnv.PORTAL_RPA_UBER_INTERACTIVE || 'false',
  PORTAL_RPA_LIBS_DIR: fs.existsSync(playwrightLibs) ? playwrightLibs : undefined,
  PATH: [fs.existsSync(tvdeX11Bin) ? tvdeX11Bin : null, process.env.PATH].filter(Boolean).join(':'),
  LD_LIBRARY_PATH: [...tvdeX11Lib, playwrightLibPath, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(':'),
  FONTCONFIG_PATH: fs.existsSync(path.join(playwrightLibs, 'etc/fonts'))
    ? path.join(playwrightLibs, 'etc/fonts')
    : undefined,
  FONTCONFIG_FILE: fs.existsSync(path.join(playwrightLibs, 'etc/fonts/fonts.conf'))
    ? path.join(playwrightLibs, 'etc/fonts/fonts.conf')
    : undefined,
};

module.exports = {
  apps: [
    {
      name: 'tvde-api',
      cwd: path.join(root, 'apps/api'),
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: apiEnv,
      max_memory_restart: '768M',
      error_file: path.join(root, 'logs/api-error.log'),
      out_file: path.join(root, 'logs/api-out.log'),
      time: true,
    },
    {
      name: 'tvde-web',
      cwd: path.join(root, 'apps/web'),
      script: 'scripts/start.mjs',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '768M',
      error_file: path.join(root, 'logs/web-error.log'),
      out_file: path.join(root, 'logs/web-out.log'),
      time: true,
    },
  ],
};
