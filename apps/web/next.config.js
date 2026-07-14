const path = require('path');
const fs = require('fs');
const { config } = require('dotenv');

function findEnvFile(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envPath = findEnvFile(path.join(__dirname, '../..'));
const nodeEnvBeforeDotenv = process.env.NODE_ENV;

if (envPath) config({ path: envPath, override: false });

if (process.argv.includes('build')) {
  process.env.NODE_ENV = 'production';
} else if (nodeEnvBeforeDotenv) {
  process.env.NODE_ENV = nodeEnvBeforeDotenv;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SHOW_DEMO_HINT: process.env.NEXT_PUBLIC_SHOW_DEMO_HINT,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  },
};

module.exports = nextConfig;
