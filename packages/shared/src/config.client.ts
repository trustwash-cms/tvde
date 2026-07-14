/** Client-side web config — NEXT_PUBLIC_* only (safe for browser). */
export function getWebConfig() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl && process.env.NODE_ENV === 'production') {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_API_URL');
  }
  return {
    apiUrl: apiUrl ?? '',
    showDemoHint: process.env.NEXT_PUBLIC_SHOW_DEMO_HINT === 'true',
    // Acesso estático — Next.js só faz inline de process.env.NEXT_PUBLIC_* directo (não envOr dinâmico)
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'CMS',
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
  };
}
