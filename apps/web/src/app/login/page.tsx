'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STORAGE_KEYS, WEB_ROUTES, DEFAULT_LOGIN_WALLPAPER_PATH } from '@tvde/shared';
import type { TenantLoginLogoScale } from '@tvde/shared';
import { apiFetch, storeTokens, showDemoHint, appName, turnstileSiteKey, API_PATHS, getApiUrl } from '@/lib/api';
import { LOGIN_LOGO_SCALE_CLASSES } from '@/lib/login-logo-scale';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/turnstile-widget';
import { TwoFaVerifyPanel } from '@/components/two-fa-verify-panel';

type LoginStep = 'credentials' | '2fa';

interface TenantBrandingPreview {
  companyName: string;
  loginLogoScale: TenantLoginLogoScale;
  logo: { hasLogo: boolean; updatedAt?: string };
  wallpaper: { hasWallpaper: boolean; updatedAt?: string };
}

function LoginFormLogo({
  logoUrl,
  companyName,
  logoScale,
}: {
  logoUrl: string | null;
  companyName: string | null;
  logoScale: TenantLoginLogoScale;
}) {
  if (!logoUrl) return null;

  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <img
        src={logoUrl}
        alt={companyName ?? appName}
        className={`mb-2 w-auto object-contain transition-all duration-200 ${LOGIN_LOGO_SCALE_CLASSES[logoScale]}`}
      />
      {companyName && <p className="text-sm font-medium text-slate-600">{companyName}</p>}
    </div>
  );
}

function LoginSidePanel({
  wallpaperUrl,
  companyName,
}: {
  wallpaperUrl: string | null;
  companyName: string | null;
}) {
  if (wallpaperUrl) {
    return (
      <div
        className="relative hidden w-1/2 overflow-hidden bg-[var(--color-primary)] lg:block"
        style={{
          backgroundImage: `url(${wallpaperUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        aria-hidden
      />
    );
  }

  return (
    <div className="hidden w-1/2 items-center justify-center bg-[var(--color-primary)] p-12 text-white lg:flex">
      {companyName ? (
        <p className="text-xl font-semibold opacity-90">{companyName}</p>
      ) : (
        <p className="text-sm font-medium uppercase tracking-wider opacity-80">{appName}</p>
      )}
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [siteId, setSiteId] = useState('');
  const [rememberSiteId, setRememberSiteId] = useState(false);
  const [pendingUserId, setPendingUserId] = useState('');
  const [pending2faMethod, setPending2faMethod] = useState<string>('totp');
  const [deliveryHint, setDeliveryHint] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<TenantBrandingPreview | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(DEFAULT_LOGIN_WALLPAPER_PATH);

  const turnstileEnabled = mounted && Boolean(turnstileSiteKey);

  useEffect(() => {
    setMounted(true);
    const storedSiteId = localStorage.getItem(STORAGE_KEYS.rememberedSiteId);
    if (storedSiteId) {
      setSiteId(storedSiteId);
      setRememberSiteId(true);
    }
  }, []);

  useEffect(() => {
    const trimmed = siteId.trim();
    if (!trimmed) {
      setBranding(null);
      setLogoUrl(null);
      setWallpaperUrl(null);
      return;
    }

    const timer = window.setTimeout(() => {
      apiFetch<TenantBrandingPreview>(API_PATHS.publicTenantBranding.info(trimmed), {
        cache: 'no-store',
      }).then((res) => {
        if (res.data) setBranding(res.data);
        else {
          setBranding(null);
          setLogoUrl(null);
          setWallpaperUrl(DEFAULT_LOGIN_WALLPAPER_PATH);
        }
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [siteId]);

  useEffect(() => {
    const trimmed = siteId.trim();
    if (!trimmed || !branding?.logo.hasLogo) {
      setLogoUrl(null);
      return;
    }

    let objectUrl: string | null = null;
    const logoVersion = branding.logo.updatedAt ?? String(Date.now());
    fetch(`${getApiUrl()}${API_PATHS.publicTenantBranding.logo(trimmed, logoVersion)}`, {
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setLogoUrl(objectUrl);
        }
      })
      .catch(() => setLogoUrl(null));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [siteId, branding?.logo.hasLogo, branding?.logo.updatedAt]);

  useEffect(() => {
    const trimmed = siteId.trim();
    if (!trimmed || !branding?.wallpaper.hasWallpaper) {
      setWallpaperUrl(DEFAULT_LOGIN_WALLPAPER_PATH);
      return;
    }

    let objectUrl: string | null = null;
    const wallpaperVersion = branding.wallpaper.updatedAt ?? String(Date.now());
    fetch(`${getApiUrl()}${API_PATHS.publicTenantBranding.wallpaper(trimmed, wallpaperVersion)}`, {
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setWallpaperUrl(objectUrl);
        } else {
          setWallpaperUrl(DEFAULT_LOGIN_WALLPAPER_PATH);
        }
      })
      .catch(() => setWallpaperUrl(DEFAULT_LOGIN_WALLPAPER_PATH));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [siteId, branding?.wallpaper.hasWallpaper, branding?.wallpaper.updatedAt]);

  function persistRememberedSiteId(nextSiteId: string, remember: boolean) {
    if (remember && nextSiteId.trim()) {
      localStorage.setItem(STORAGE_KEYS.rememberedSiteId, nextSiteId.trim());
      return;
    }
    localStorage.removeItem(STORAGE_KEYS.rememberedSiteId);
  }

  function handleSiteIdChange(value: string) {
    setSiteId(value);
    if (rememberSiteId) {
      persistRememberedSiteId(value, true);
    }
  }

  function handleRememberSiteIdChange(checked: boolean) {
    setRememberSiteId(checked);
    persistRememberedSiteId(siteId, checked);
  }

  function resetTurnstile() {
    if (!turnstileEnabled) return;
    turnstileRef.current?.reset();
    setTurnstileToken(null);
  }

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (turnstileEnabled && !turnstileToken) {
      setError('Complete a verificação captcha');
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch<{
        accessToken?: string;
        refreshToken?: string;
        requires2fa?: boolean;
        userId?: string;
        method?: string;
        deliveryHint?: string;
        user?: { mustChangePassword?: boolean };
      }>(API_PATHS.auth.login, {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          siteId: siteId || undefined,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });

      if (!res.success || !res.data) {
        setError(res.error ?? 'Login falhou');
        resetTurnstile();
        return;
      }

      if (res.data.requires2fa && res.data.userId) {
        persistRememberedSiteId(siteId, rememberSiteId);
        setPendingUserId(res.data.userId);
        setPending2faMethod(res.data.method ?? 'totp');
        setDeliveryHint(res.data.deliveryHint ?? '');
        setStep('2fa');
        setTotpCode('');
        return;
      }

      if (!res.data.accessToken || !res.data.refreshToken) {
        setError('Resposta de login inválida');
        resetTurnstile();
        return;
      }

      persistRememberedSiteId(siteId, rememberSiteId);
      storeTokens(res.data.accessToken, res.data.refreshToken);
      router.push(
        res.data.user?.mustChangePassword
          ? WEB_ROUTES.changePassword
          : WEB_ROUTES.dashboard.root
      );
    } catch {
      setError('Erro de ligação ao servidor');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  }

  async function resend2faCode() {
    if (!pendingUserId || pending2faMethod === 'totp') return;
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ deliveryHint?: string; maskedPhone?: string; maskedEmail?: string }>(
        API_PATHS.auth.twoFa.sendCode,
        { method: 'POST', body: JSON.stringify({ userId: pendingUserId }) }
      );
      if (res.success) {
        const hint =
          res.data?.maskedPhone ?? res.data?.maskedEmail ?? res.data?.deliveryHint ?? deliveryHint;
        if (hint) setDeliveryHint(hint);
      } else {
        setError(res.error ?? 'Não foi possível reenviar o código');
      }
    } catch {
      setError('Erro de ligação ao servidor');
    } finally {
      setLoading(false);
    }
  }

  function get2faDescription() {
    if (pending2faMethod === 'totp') {
      return 'Introduza o código de 6 dígitos da app autenticadora.';
    }
    if (deliveryHint) {
      return `Introduza o código enviado para ${deliveryHint}.`;
    }
    return 'Introduza o código de verificação de 6 dígitos.';
  }

  async function verify2fa(code: string) {
    setError('');
    setLoading(true);

    try {
      const res = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user?: { mustChangePassword?: boolean };
      }>(API_PATHS.auth.twoFa.verify, {
        method: 'POST',
        body: JSON.stringify({
          userId: pendingUserId,
          code: code.replace(/\s/g, ''),
          siteId: siteId || undefined,
        }),
      });

      if (!res.success || !res.data?.accessToken) {
        setError(res.error ?? 'Código inválido');
        setTotpCode('');
        return;
      }

      persistRememberedSiteId(siteId, rememberSiteId);
      storeTokens(res.data.accessToken, res.data.refreshToken);
      router.push(
        res.data.user?.mustChangePassword
          ? WEB_ROUTES.changePassword
          : WEB_ROUTES.dashboard.root
      );
    } catch {
      setError('Erro de ligação ao servidor');
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  }

  function backToCredentials() {
    setStep('credentials');
    setPendingUserId('');
    setTotpCode('');
    setError('');
    resetTurnstile();
  }

  return (
    <div className="flex min-h-screen">
      <LoginSidePanel
        wallpaperUrl={wallpaperUrl}
        companyName={branding?.companyName ?? null}
      />

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          {step === 'credentials' ? (
            <>
              <LoginFormLogo
                logoUrl={logoUrl}
                companyName={branding?.companyName ?? null}
                logoScale={branding?.loginLogoScale ?? 1}
              />

              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Site ID</label>
                  <input
                    className="input"
                    value={siteId}
                    onChange={(e) => handleSiteIdChange(e.target.value)}
                    placeholder="site-id do tenant"
                    autoComplete="organization"
                  />
                  <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={rememberSiteId}
                      onChange={(e) => handleRememberSiteIdChange(e.target.checked)}
                    />
                    Memorizar Site ID neste dispositivo
                  </label>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Email</label>
                  <input
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Password</label>
                  <input
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>

                {turnstileEnabled && (
                  <TurnstileWidget
                    ref={turnstileRef}
                    siteKey={turnstileSiteKey}
                    onToken={setTurnstileToken}
                  />
                )}

                {error && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                )}

                <button
                  type="submit"
                  className="btn-primary w-full"
                  disabled={loading || (turnstileEnabled && !turnstileToken)}
                >
                  {loading ? 'A entrar...' : 'Entrar'}
                </button>

                <p className="text-center text-sm">
                  <Link href={WEB_ROUTES.forgotPassword} className="text-[var(--color-primary)] hover:underline">
                    Esqueceu a password?
                  </Link>
                </p>
              </form>
            </>
          ) : (
            <>
              <TwoFaVerifyPanel
                title="Verificação em dois passos"
                description={get2faDescription()}
                value={totpCode}
                onChange={setTotpCode}
                onSubmit={verify2fa}
                loading={loading}
                error={error}
              />

              {pending2faMethod !== 'totp' && (
                <button
                  type="button"
                  className="mt-4 w-full text-sm text-[var(--color-primary)] hover:underline"
                  onClick={resend2faCode}
                  disabled={loading}
                >
                  Reenviar código
                </button>
              )}

              <button
                type="button"
                className="mt-8 w-full text-sm text-slate-500 hover:text-slate-700"
                onClick={backToCredentials}
              >
                Voltar ao login
              </button>
            </>
          )}

          {showDemoHint && step === 'credentials' && (
            <div className="mt-8 rounded-lg bg-slate-100 p-4 text-xs text-slate-600">
              Modo demo activo — credenciais definidas via seed (ver documentação).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
