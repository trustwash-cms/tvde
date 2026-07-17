export const PORTAL_KINDS = ['via_verde', 'myprio', 'uber'] as const;
export type PortalKind = (typeof PORTAL_KINDS)[number];

export const PORTAL_KIND_LABELS: Record<PortalKind, string> = {
  via_verde: 'Via Verde',
  myprio: 'MyPRIO',
  uber: 'Uber',
};

/** Sync MyPRIO: Electric e Frota são jobs separados (páginas Eletricidade / Combustível). */
export const MYPRIO_SYNC_SCOPES = ['electric', 'fleet'] as const;
export type MyPrioSyncScope = (typeof MYPRIO_SYNC_SCOPES)[number];

export const MYPRIO_SYNC_SCOPE_LABELS: Record<MyPrioSyncScope, string> = {
  electric: 'Electric',
  fleet: 'Combustível',
};

export const PORTAL_CONNECTION_STATUSES = [
  'disconnected',
  'connected',
  'awaiting_otp',
  'expired',
  'error',
] as const;
export type PortalConnectionStatus = (typeof PORTAL_CONNECTION_STATUSES)[number];

export const PORTAL_CONNECTION_STATUS_LABELS: Record<PortalConnectionStatus, string> = {
  disconnected: 'Desligado',
  connected: 'Ligado',
  awaiting_otp: 'OTP pendente',
  expired: 'Sessão expirada',
  error: 'Erro',
};

export interface PortalConnectionPublic {
  portal: PortalKind;
  status: PortalConnectionStatus;
  usernameMasked: string | null;
  hasSession: boolean;
  lastLoginAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  isEnabled: boolean;
  activeJobId: string | null;
  activeJobStatus: string | null;
  otpHint: string | null;
  rpaEnabled: boolean;
  /** Chromium Playwright detectado no servidor */
  browserReady: boolean;
  /** true = simula sem browser (PORTAL_RPA_MOCK) */
  mockMode: boolean;
  /** Mensagem do último job (ex. "Sync: 6 inseridos, 4 ignorados") */
  lastJobMessage: string | null;
}

export interface PortalConnectInput {
  username: string;
  password: string;
}

export interface PortalOtpInput {
  code: string;
}

export interface PortalSyncResultSummary {
  inserted: number;
  skipped: number;
  failed: number;
  message?: string;
}
