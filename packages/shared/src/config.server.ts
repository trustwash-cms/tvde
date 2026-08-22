import { requireEnv, envOr } from './utils/env';

export function getApiPrefix(): string {
  return envOr('API_PREFIX', '/api/v1');
}

export function getHealthPath(): string {
  return envOr('HEALTH_PATH', '/health');
}

export function parseDurationMs(value: string): number {
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) throw new Error(`Invalid duration format: ${value}`);
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * multipliers[unit];
}

export function getSessionRefreshExpiresMs(): number {
  return parseDurationMs(envOr('JWT_REFRESH_EXPIRES', '7d'));
}

export function getJwtAccessExpires(): string {
  return envOr('JWT_ACCESS_EXPIRES', '8h');
}

export function getServerConfig() {
  const isProd = process.env.NODE_ENV === 'production';

  const get = (key: string, devFallback?: string): string => {
    const val = process.env[key];
    if (val) return val;
    if (isProd) return requireEnv(key);
    if (devFallback !== undefined) return devFallback;
    return requireEnv(key);
  };

  const port = parseInt(get('API_PORT', '3001'), 10);
  const apiPrefix = getApiPrefix();

  return {
    nodeEnv: envOr('NODE_ENV', 'development'),
    port,
    host: get('API_HOST', '0.0.0.0'),
    corsOrigin: get('CORS_ORIGIN', 'http://localhost:3000'),
    jwtSecret: get('JWT_SECRET', 'dev-secret-change-me'),
    jwtAccessExpires: getJwtAccessExpires(),
    jwtRefreshExpiresMs: getSessionRefreshExpiresMs(),
    redisUrl: get('REDIS_URL', 'redis://localhost:6379'),
    encryptionKey: get('ENCRYPTION_KEY', '32-char-key-change-in-prod!!'),
    apiPrefix,
    healthPath: getHealthPath(),
    apiPublicUrl: (() => {
      const explicit = envOr('API_PUBLIC_URL', '');
      if (explicit) return explicit.replace(/\/$/, '');
      const fromNextPublic = envOr('NEXT_PUBLIC_API_PUBLIC_URL', '');
      if (fromNextPublic) return fromNextPublic.replace(/\/$/, '');
      const fromNext = envOr('NEXT_PUBLIC_API_URL', '');
      if (fromNext) return fromNext.replace(/\/$/, '');
      return `http://localhost:${port}${apiPrefix}`.replace(/\/$/, '');
    })(),
    geoapifyApiKey: envOr('GEOAPIFY_API_KEY', ''),
    googleMapsApiKey: envOr('GOOGLE_MAPS_API_KEY', ''),
    rateLimitMax: parseInt(envOr('RATE_LIMIT_MAX', isProd ? '100' : '600'), 10),
    rateLimitWindow: envOr('RATE_LIMIT_WINDOW', '1 minute'),
    passwordResetExpiresMs: parseDurationMs(envOr('PASSWORD_RESET_EXPIRES', '1h')),
    webPublicUrl: envOr('WEB_PUBLIC_URL', envOr('CORS_ORIGIN', '')),
    exposeResetToken: envOr('RESET_EXPOSE_TOKEN', 'false') === 'true',
    appName: envOr('NEXT_PUBLIC_APP_NAME', envOr('SMTP_FROM_NAME', 'CMS')),
    smtpHost: envOr('SMTP_HOST', ''),
    smtpPort: parseInt(envOr('SMTP_PORT', '587'), 10),
    smtpUser: envOr('SMTP_USER', ''),
    smtpPass: envOr('SMTP_PASS', ''),
    smtpFrom: envOr('SMTP_FROM', ''),
    smtpSecure: envOr('SMTP_SECURE', 'false') === 'true',
    turnstileSecretKey: envOr('TURNSTILE_SECRET_KEY', ''),
    hibpCheckEnabled: envOr('HIBP_CHECK', isProd ? 'true' : 'false') === 'true',
    smsDevMock: envOr('SMS_DEV_MOCK', 'true') === 'true',
    whatsappBridgeUrl: envOr('WHATSAPP_BRIDGE_URL', 'http://localhost:3002'),
    whatsappBridgeSecret: envOr('WHATSAPP_BRIDGE_SECRET', 'dev-whatsapp-bridge-secret'),
    billingSyncSecret: envOr('BILLING_SYNC_SECRET', ''),
    calendarUploadDir: envOr('CALENDAR_UPLOAD_DIR', 'uploads/calendar'),
    calendarMaxAttachmentBytes: parseInt(envOr('CALENDAR_MAX_ATTACHMENT_BYTES', '10485760'), 10),
    carwashUploadDir: envOr('CARWASH_UPLOAD_DIR', 'uploads/carwash'),
    carwashMaxVehicleImageBytes: parseInt(envOr('CARWASH_MAX_VEHICLE_IMAGE_BYTES', '5242880'), 10),
    adminMgmtUploadDir: envOr('ADMIN_MGMT_UPLOAD_DIR', 'uploads/admin-mgmt'),
    adminMgmtMaxAttachmentBytes: parseInt(envOr('ADMIN_MGMT_MAX_ATTACHMENT_BYTES', '10485760'), 10),
    pickupTokenExpiresMs: parseDurationMs(envOr('PICKUP_TOKEN_EXPIRES', '30d')),
    invoiceDownloadTokenExpiresMs: parseDurationMs(envOr('INVOICE_DOWNLOAD_TOKEN_EXPIRES', '90d')),
    /** Máximo de descarregamentos PDF por link público (HTML da página não conta). */
    invoiceDownloadMaxCount: Math.max(
      1,
      parseInt(envOr('INVOICE_DOWNLOAD_MAX_COUNT', '3'), 10) || 3
    ),
    brandingUploadDir: envOr('BRANDING_UPLOAD_DIR', 'uploads/branding'),
    brandingMaxLogoBytes: parseInt(envOr('BRANDING_MAX_LOGO_BYTES', '2097152'), 10),
    brandingMaxWallpaperBytes: parseInt(envOr('BRANDING_MAX_WALLPAPER_BYTES', '8388608'), 10),
    ecommerceUploadDir: envOr('ECOMMERCE_UPLOAD_DIR', 'uploads/ecommerce'),
    ecommerceMaxProductImageBytes: parseInt(
      envOr('ECOMMERCE_MAX_PRODUCT_IMAGE_BYTES', '5242880'),
      10
    ),
    portalRpaEnabled: envOr('PORTAL_RPA_ENABLED', 'true') === 'true',
    // Default: mock em dev para não exigir Chromium; em produção sync real
    portalRpaMock: (process.env.PORTAL_RPA_MOCK ?? (isProd ? 'false' : 'true')) === 'true',
    portalRpaHeadless: envOr('PORTAL_RPA_HEADLESS', 'true') === 'true',
    /**
     * Uber Ligar conta com Chromium visível (debug). Default false — fluxo automático
     * SMS → OTP (modal TVDE) → palavra-passe.
     */
    portalRpaUberInteractive: envOr('PORTAL_RPA_UBER_INTERACTIVE', 'false') === 'true',
    /**
     * Uber Ligar conta: Chromium headed (Xvfb / DISPLAY) para o Arkose pintar no stream
     * «Desafio Uber». Diferente de UBER_INTERACTIVE (não espera humano no servidor).
     * Default: true se DISPLAY estiver definido.
     */
    portalRpaUberHeadedConnect:
      envOr('PORTAL_RPA_UBER_HEADED_CONNECT', process.env.DISPLAY ? 'true' : 'false') === 'true',
    /** Intervalo do worker que renova cookies (horas). */
    portalRpaRefreshIntervalHours: Math.max(
      1,
      parseInt(envOr('PORTAL_RPA_REFRESH_INTERVAL_HOURS', '3'), 10) || 3
    ),
    userDocumentsUploadDir: envOr('USER_DOCUMENTS_UPLOAD_DIR', 'uploads/user-documents'),
    userDocumentsMaxBytes: parseInt(envOr('USER_DOCUMENTS_MAX_BYTES', '5242880'), 10),
    paymentReceiptsUploadDir: envOr('PAYMENT_RECEIPTS_UPLOAD_DIR', 'uploads/payment_receipts'),
    paymentReceiptsMaxBytes: parseInt(envOr('PAYMENT_RECEIPTS_MAX_BYTES', '10485760'), 10),
    driverCurrentAccountUploadDir: envOr(
      'DRIVER_CURRENT_ACCOUNT_UPLOAD_DIR',
      'uploads/driver-current-account'
    ),
    driverCurrentAccountMaxBytes: parseInt(
      envOr('DRIVER_CURRENT_ACCOUNT_MAX_BYTES', '10485760'),
      10
    ),
  };
}
