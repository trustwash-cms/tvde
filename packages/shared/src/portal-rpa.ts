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
  /** Password AES-GCM guardada no servidor (nunca devolvida em claro) */
  hasPassword: boolean;
  lastLoginAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  isEnabled: boolean;
  activeJobId: string | null;
  activeJobStatus: string | null;
  otpHint: string | null;
  /** Desafio humano actual: passkey (QR) ou OTP SMS */
  authChallenge: 'passkey' | 'otp' | null;
  /** PNG base64 do QR/ecrã passkey (quando authChallenge=passkey) */
  challengeImageBase64: string | null;
  rpaEnabled: boolean;
  /** Chromium Playwright detectado no servidor */
  browserReady: boolean;
  /** true = simula sem browser (PORTAL_RPA_MOCK) */
  mockMode: boolean;
  /** Mensagem do último job (ex. "Sync: 6 inseridos, 4 ignorados") */
  lastJobMessage: string | null;
}

export interface PortalConnectInput {
  /** Opcional se já há username guardado e useStoredCredentials */
  username?: string;
  /** Opcional se já há password guardada e useStoredCredentials */
  password?: string;
  /** Reutilizar username/password encriptados no servidor */
  useStoredCredentials?: boolean;
}

export interface PortalOtpInput {
  code: string;
}

/** Sync Uber: descarregar existente ou gerar com intervalo. */
export const UBER_SYNC_MODES = ['existing', 'generate'] as const;
export type UberSyncMode = (typeof UBER_SYNC_MODES)[number];

export interface UberSyncOptions {
  mode: UberSyncMode;
  /** mode=existing: nome do relatório (prefixo da linha) */
  reportName?: string;
  /** mode=generate: início ISO (Europe/Lisbon) */
  rangeStart?: string;
  /** mode=generate: fim ISO */
  rangeEnd?: string;
  /**
   * mode=generate: nome da organização no modal Uber
   * (ex. «CAMINHOS TOLERANTES, LDA» ou «CAMINHOS TOLERANTES»).
   */
  organizationName?: string;
}

export interface UberReportListItem {
  name: string;
  type: string | null;
  interval: string | null;
  createdAt: string | null;
  hasDownload: boolean;
}

/**
 * Extrai candidatos de organização a partir de nomes de relatório
 * (ex. `…-payments_order-CAMINHOS_TOLERANTES_LDA` → «CAMINHOS TOLERANTES, LDA»).
 */
export function guessUberOrganizationsFromReports(reportNames: string[]): string[] {
  const out = new Set<string>();
  for (const name of reportNames) {
    const m = /payments_orde[r]?[-_](.+)$/i.exec(name.trim());
    if (!m?.[1]) continue;
    const raw = m[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    // «FOO BAR LDA» → «FOO BAR, LDA»
    const withComma = raw.replace(/\s+LDA$/i, ', LDA');
    out.add(withComma);
    const withoutLda = raw.replace(/,?\s*LDA$/i, '').trim();
    if (withoutLda) out.add(withoutLda);
  }
  return Array.from(out).filter(Boolean);
}

/** Y-m-d → YYYYMMDD (prefixo típico nos nomes Uber). */
export function ymdToUberCompact(ymd: string): string {
  return ymd.trim().replace(/-/g, '').slice(0, 8);
}

function isPaymentsUberReport(report: UberReportListItem): boolean {
  const blob = `${report.name} ${report.type ?? ''}`;
  return /payments_orde|transação de pagamentos|transacao de pagamentos|payment.?transaction/i.test(
    blob
  );
}

/**
 * Relatório Uber «Transação de pagamentos» cujo nome/intervalo cobre o período Y-m-d.
 * Nome típico: `20260713-20260719-payments_order-…`
 */
export function uberReportMatchesPeriod(
  report: UberReportListItem,
  periodStartYmd: string,
  periodEndYmd: string
): boolean {
  if (!isPaymentsUberReport(report)) return false;
  const start = ymdToUberCompact(periodStartYmd);
  const end = ymdToUberCompact(periodEndYmd);
  if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) return false;

  const name = report.name.trim();
  if (new RegExp(`^${start}-${end}[-_]payments`, 'i').test(name)) return true;
  if (name.includes(start) && name.includes(end) && /payments/i.test(name)) return true;

  const interval = (report.interval ?? '').replace(/\s+/g, ' ');
  if (!interval) return false;
  // Intervalo UI: «13/07/2026 – 19/07/2026» ou «20260713 - 20260719»
  const compact = interval.replace(/\D/g, '');
  if (compact.includes(start) && compact.includes(end)) return true;

  const dmy = (ymd: string) => {
    const [y, m, d] = ymd.split('-');
    return d && m && y ? `${Number(d)}/${Number(m)}/${y}` : '';
  };
  const startDmy = dmy(periodStartYmd);
  const endDmy = dmy(periodEndYmd);
  if (startDmy && endDmy && interval.includes(startDmy) && interval.includes(endDmy)) {
    return true;
  }
  return false;
}

/**
 * Último relatório de pagamentos descarregável para o intervalo (lista Supplier).
 * Preferência: ordem da lista Uber (mais recente primeiro); desempate por `createdAt`.
 */
export function pickLatestUberReportForPeriod(
  reports: UberReportListItem[],
  periodStartYmd: string,
  periodEndYmd: string
): UberReportListItem | null {
  const matches = reports.filter(
    (r) => r.hasDownload && uberReportMatchesPeriod(r, periodStartYmd, periodEndYmd)
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;

  const scored = matches.map((r, index) => ({
    r,
    index,
    t: r.createdAt ? Date.parse(r.createdAt) : Number.NaN,
  }));
  scored.sort((a, b) => {
    const aOk = !Number.isNaN(a.t);
    const bOk = !Number.isNaN(b.t);
    if (aOk && bOk && a.t !== b.t) return b.t - a.t;
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    return a.index - b.index;
  });
  return scored[0]?.r ?? null;
}

/**
 * Semana completa anterior em Europe/Lisbon:
 * segunda 01:00 → domingo 23:30 (alinhado a ficheiros YYYYMMDD-YYYYMMDD-payments_order-…).
 */
export function defaultUberReportRange(now: Date = new Date()): {
  rangeStart: string;
  rangeEnd: string;
} {
  const lisbonParts = (d: Date) => {
    const map = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Lisbon',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
      })
        .formatToParts(d)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value])
    ) as Record<string, string>;
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      weekday: weekdayMap[map.weekday ?? 'Mon'] ?? 1,
    };
  };

  /** UTC ISO whose wall clock in Europe/Lisbon equals the given local parts. */
  const lisbonLocalToUtcIso = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number
  ): string => {
    let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (let i = 0; i < 4; i += 1) {
      const d = new Date(utc);
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Lisbon',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        })
          .formatToParts(d)
          .filter((p) => p.type !== 'literal')
          .map((p) => [p.type, p.value])
      ) as Record<string, string>;
      const asUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute)
      );
      const desired = Date.UTC(year, month - 1, day, hour, minute);
      utc += desired - asUtc;
    }
    return new Date(utc).toISOString();
  };

  const addDays = (y: number, m: number, d: number, delta: number) => {
    const t = new Date(Date.UTC(y, m - 1, d + delta));
    return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
  };

  const today = lisbonParts(now);
  const daysSinceMonday = (today.weekday + 6) % 7; // Mon=0 … Sun=6
  const thisMonday = addDays(today.year, today.month, today.day, -daysSinceMonday);
  const prevMonday = addDays(thisMonday.year, thisMonday.month, thisMonday.day, -7);
  const prevSunday = addDays(prevMonday.year, prevMonday.month, prevMonday.day, 6);

  return {
    rangeStart: lisbonLocalToUtcIso(prevMonday.year, prevMonday.month, prevMonday.day, 1, 0),
    rangeEnd: lisbonLocalToUtcIso(prevSunday.year, prevSunday.month, prevSunday.day, 23, 30),
  };
}

/** `YYYY-MM-DDTHH:mm` wall clock Europe/Lisbon → ISO UTC. */
export function lisbonDatetimeLocalToIso(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) throw new Error('Data/hora inválida');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const d = new Date(utc);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Lisbon',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(d)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value])
    ) as Record<string, string>;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute)
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    utc += desired - asUtc;
  }
  return new Date(utc).toISOString();
}

/** ISO UTC → `YYYY-MM-DDTHH:mm` for datetime-local (Europe/Lisbon). */
export function isoToLisbonDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export interface PortalSyncResultSummary {
  inserted: number;
  skipped: number;
  failed: number;
  message?: string;
}
