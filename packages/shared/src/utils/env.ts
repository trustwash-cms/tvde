export function envOr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}
