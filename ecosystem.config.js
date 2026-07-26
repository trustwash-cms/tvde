/** PM2 — TVDE API + Web (produção / VM) */
const path = require('path');

const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'tvde-api',
      cwd: path.join(root, 'apps/api'),
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
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
