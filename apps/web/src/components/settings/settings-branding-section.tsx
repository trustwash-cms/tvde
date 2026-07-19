'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import {
  DEFAULT_LOGIN_WALLPAPER_PATH,
  TENANT_BRANDING_MAX_LOGO_BYTES,
  TENANT_BRANDING_MAX_WALLPAPER_BYTES,
  type TenantLoginLogoScale,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { SETTINGS_LOGO_PREVIEW_CLASSES } from '@/lib/login-logo-scale';

interface BrandingFileInfo {
  hasLogo?: boolean;
  hasWallpaper?: boolean;
  fileName?: string;
  updatedAt?: string;
}

interface TenantBrandingInfo {
  companyName: string;
  loginLogoScale: TenantLoginLogoScale;
  logo: BrandingFileInfo;
  wallpaper: BrandingFileInfo;
}

function LogoScaleButtons({
  scale,
  disabled,
  onChange,
}: {
  scale: TenantLoginLogoScale;
  disabled?: boolean;
  onChange: (scale: TenantLoginLogoScale) => void;
}) {
  return (
    <div className="flex gap-1">
      {([2, 3] as const).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none disabled:opacity-50 ${
            scale === value
              ? 'bg-[var(--color-primary)] text-white'
              : 'border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
          aria-pressed={scale === value}
          onClick={() => onChange(scale === value ? 1 : value)}
        >
          {value}x
        </button>
      ))}
    </div>
  );
}

function BrandingFileUpload({
  label,
  hint,
  maxBytes,
  previewUrl,
  hasFile,
  busy,
  onUpload,
  onRemove,
  previewObjectFit = 'cover',
  accept = 'image/jpeg,image/png,image/webp',
  formatsHint = 'PNG, JPEG ou WebP',
  emptyLabel = 'Sem imagem',
}: {
  label: string;
  hint: string;
  maxBytes: number;
  previewUrl: string | null;
  hasFile: boolean;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  previewObjectFit?: 'cover' | 'contain';
  accept?: string;
  formatsHint?: string;
  emptyLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
        <p className="mt-1 text-sm text-slate-500">{hint}</p>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-200 bg-slate-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={label}
              className={`max-h-full max-w-full ${previewObjectFit === 'contain' ? 'object-contain' : 'object-cover'}`}
            />
          ) : (
            <span className="px-2 text-center text-xs text-slate-400">{emptyLabel}</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              if (inputRef.current) inputRef.current.value = '';
            }}
          />
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 text-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus size={14} />
            {hasFile ? 'Substituir' : 'Carregar'}
          </button>
          {hasFile && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-sm text-red-600"
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2 size={14} />
              Remover
            </button>
          )}
          <p className="text-xs text-slate-400">
            {formatsHint} · máx. {maxMb} MB
          </p>
        </div>
      </div>
    </div>
  );
}

function LogoBrandingUpload({
  previewUrl,
  hasLogo,
  logoScale,
  busy,
  onUpload,
  onRemove,
  onScaleChange,
}: {
  previewUrl: string | null;
  hasLogo: boolean;
  logoScale: TenantLoginLogoScale;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onScaleChange: (scale: TenantLoginLogoScale) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewClass = SETTINGS_LOGO_PREVIEW_CLASSES[logoScale];

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Logotipo</h3>
        <p className="mt-1 text-sm text-slate-500">
          Aparece no ecrã de login e no cabeçalho dos emails. Use 2x ou 3x para ajustar o tamanho no login.
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-h-24 min-w-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3">
          {previewUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Logotipo" className={`w-auto object-contain ${previewClass}`} />
              <LogoScaleButtons scale={logoScale} disabled={busy || !hasLogo} onChange={onScaleChange} />
            </>
          ) : (
            <span className="px-2 text-center text-xs text-slate-400">Sem logotipo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              if (inputRef.current) inputRef.current.value = '';
            }}
          />
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 text-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus size={14} />
            {hasLogo ? 'Substituir logotipo' : 'Carregar logotipo'}
          </button>
          {hasLogo && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-sm text-red-600"
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2 size={14} />
              Remover
            </button>
          )}
          <p className="text-xs text-slate-400">PNG, JPEG ou WebP · máx. 2 MB · fundo transparente recomendado</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsBrandingSection() {
  const [info, setInfo] = useState<TenantBrandingInfo | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [wallpaperPreviewUrl, setWallpaperPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function load() {
    setLoading(true);
    apiFetch<TenantBrandingInfo>(API_PATHS.tenantBranding.info, {}, getStoredToken()).then((res) => {
      setLoading(false);
      if (res.data) setInfo(res.data);
      else setError(getApiErrorMessage(res));
    });
  }

  useEffect(load, []);

  useEffect(() => {
    if (!info?.logo.hasLogo) {
      setLogoPreviewUrl(null);
      return;
    }
    const token = getStoredToken();
    const logoVersion = info.logo.updatedAt ?? String(Date.now());
    const url = `${getApiUrl()}${API_PATHS.tenantBranding.logo(logoVersion)}`;
    let objectUrl: string | null = null;
    fetch(url, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setLogoPreviewUrl(objectUrl);
        }
      })
      .catch(() => setLogoPreviewUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [info?.logo.hasLogo, info?.logo.updatedAt]);

  useEffect(() => {
    if (!info?.wallpaper.hasWallpaper) {
      setWallpaperPreviewUrl(DEFAULT_LOGIN_WALLPAPER_PATH);
      return;
    }
    const token = getStoredToken();
    const wallpaperVersion = info.wallpaper.updatedAt ?? String(Date.now());
    const url = `${getApiUrl()}${API_PATHS.tenantBranding.wallpaper(wallpaperVersion)}`;
    let objectUrl: string | null = null;
    fetch(url, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setWallpaperPreviewUrl(objectUrl);
        } else {
          setWallpaperPreviewUrl(DEFAULT_LOGIN_WALLPAPER_PATH);
        }
      })
      .catch(() => setWallpaperPreviewUrl(DEFAULT_LOGIN_WALLPAPER_PATH));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [info?.wallpaper.hasWallpaper, info?.wallpaper.updatedAt]);

  async function uploadLogo(file: File) {
    if (file.size > TENANT_BRANDING_MAX_LOGO_BYTES) {
      setError('Logotipo demasiado grande (máx. 2 MB)');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    const formData = new FormData();
    formData.append('file', file);
    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.tenantBranding.logo()}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const raw = await res.text();
    let parsed: { success?: boolean; error?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { success: false, error: raw.slice(0, 200) };
    }
    setBusy(false);
    if (!res.ok || !parsed.success) {
      setError(parsed.error ?? 'Falha ao carregar logotipo');
      return;
    }
    setSuccess('Logotipo guardado — usado no login e nos emails da plataforma.');
    load();
  }

  async function removeLogo() {
    setBusy(true);
    setError('');
    setSuccess('');
    const res = await apiFetch(API_PATHS.tenantBranding.logo(), { method: 'DELETE' }, getStoredToken());
    setBusy(false);
    if (res.success) {
      setSuccess('Logotipo removido.');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function updateLogoScale(scale: TenantLoginLogoScale) {
    setBusy(true);
    setError('');
    setSuccess('');
    const res = await apiFetch<TenantBrandingInfo>(
      API_PATHS.tenantBranding.info,
      { method: 'PATCH', body: JSON.stringify({ loginLogoScale: scale }) },
      getStoredToken()
    );
    setBusy(false);
    if (res.data) {
      setInfo(res.data);
      setSuccess(scale === 1 ? 'Tamanho do logotipo no login: normal.' : `Tamanho do logotipo no login: ${scale}x.`);
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function uploadWallpaper(file: File) {
    if (file.size > TENANT_BRANDING_MAX_WALLPAPER_BYTES) {
      setError('Wallpaper demasiado grande (máx. 8 MB)');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    const formData = new FormData();
    formData.append('file', file);
    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.tenantBranding.wallpaper()}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const raw = await res.text();
    let parsed: { success?: boolean; error?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { success: false, error: raw.slice(0, 200) };
    }
    setBusy(false);
    if (!res.ok || !parsed.success) {
      setError(parsed.error ?? 'Falha ao carregar wallpaper');
      return;
    }
    setSuccess('Wallpaper guardado — substitui a cor roxa no ecrã de login.');
    load();
  }

  async function removeWallpaper() {
    setBusy(true);
    setError('');
    setSuccess('');
    const res = await apiFetch(
      API_PATHS.tenantBranding.wallpaper(),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusy(false);
    if (res.success) {
      setSuccess('Wallpaper removido — volta a usar a cor por defeito no login.');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Identidade visual</h2>
        <p className="mt-1 text-sm text-slate-500">
          Personalize o ecrã de login e os emails transaccionais.
          {info?.companyName ? ` Empresa: ${info.companyName}.` : ''}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">A carregar…</p>
      ) : (
        <div className="space-y-8">
          <LogoBrandingUpload
            previewUrl={logoPreviewUrl}
            hasLogo={Boolean(info?.logo.hasLogo)}
            logoScale={info?.loginLogoScale ?? 1}
            busy={busy}
            onUpload={(file) => void uploadLogo(file)}
            onRemove={() => void removeLogo()}
            onScaleChange={(scale) => void updateLogoScale(scale)}
          />
          <BrandingFileUpload
            label="Wallpaper do login"
            hint="Imagem de fundo no painel esquerdo do ecrã de login. Sem wallpaper personalizado, usa-se o wallpaper por defeito da app (GIF animado suportado)."
            maxBytes={TENANT_BRANDING_MAX_WALLPAPER_BYTES}
            previewUrl={wallpaperPreviewUrl}
            hasFile={Boolean(info?.wallpaper.hasWallpaper)}
            busy={busy}
            onUpload={(file) => void uploadWallpaper(file)}
            onRemove={() => void removeWallpaper()}
            accept="image/jpeg,image/png,image/webp,image/gif"
            formatsHint="PNG, JPEG, WebP ou GIF"
            emptyLabel="Wallpaper por defeito"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      {success && <p className="text-sm text-green-700">{success}</p>}
    </div>
  );
}
