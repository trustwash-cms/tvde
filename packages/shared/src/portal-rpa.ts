export const PORTAL_KINDS = ['via_verde', 'myprio', 'uber'] as const;
export type PortalKind = (typeof PORTAL_KINDS)[number];

export const PORTAL_KIND_LABELS: Record<PortalKind, string> = {
  via_verde: 'Via Verde',
  myprio: 'MyPRIO',
  uber: 'Uber',
};

/** Sync MyPRIO: Electric, Frota ou ambos num único browser (pagamentos). */
export const MYPRIO_SYNC_SCOPES = ['electric', 'fleet', 'both'] as const;
export type MyPrioSyncScope = (typeof MYPRIO_SYNC_SCOPES)[number];

export const MYPRIO_SYNC_SCOPE_LABELS: Record<MyPrioSyncScope, string> = {
  electric: 'Electric',
  fleet: 'Combustível',
  both: 'Frota + Electric',
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
  /**
   * Password encriptada existe mas não desencripta com a ENCRYPTION_KEY actual
   * (chave mudou / ciphertext corrompido) — pedir «Esquecer password» + re-ligar.
   */
  passwordNeedsResave: boolean;
  lastLoginAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  isEnabled: boolean;
  /** Sync automático diário (Via Verde / MyPRIO / Uber). Default false — o sync manual não muda. */
  autoSyncEnabled: boolean;
  activeJobId: string | null;
  /** Tipo do job activo (connect / sync / refresh) — evita misturar spinner de sync com login */
  activeJobType: 'connect' | 'sync' | 'refresh' | null;
  activeJobStatus: string | null;
  otpHint: string | null;
  /** Desafio humano actual: passkey (QR), bot (Arkose live), OTP SMS, ou password pós-OTP */
  authChallenge: 'passkey' | 'otp' | 'bot' | 'password' | null;
  /** PNG base64 do QR/ecrã passkey (quando authChallenge=passkey) */
  challengeImageBase64: string | null;
  /** Stream JPEG do Chromium vivo activo (login Uber em curso) */
  uberLiveStream: boolean;
  /** URL noVNC do ambiente RPA no servidor (quando uberLiveStream) */
  rpaVncUrl: string | null;
  rpaEnabled: boolean;
  /** Chromium Playwright pronto no servidor (launch verificado quando possível) */
  browserReady: boolean;
  /** Detalhe do probe (path OK / erro humanizado) — separado do estado da conta */
  browserDetail: string | null;
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
  /**
   * mode=generate: tipo no dropdown «Tipo de relatório» do portal.
   * Default: Transação de pagamentos (`payments_order`).
   */
  reportTypeKey?: UberReportTypeKey;
}

export const UBER_REPORT_TYPE_CATALOG = [
  {
    key: 'REPORT_TYPE_PAYMENTS_ORDER',
    label: 'Transação de pagamentos',
    slug: 'payments_order',
    filterText: 'Transação de pagamentos',
  },
  {
    key: 'REPORT_TYPE_PAYMENTS_DRIVER',
    label: 'Pagamentos do motorista',
    slug: 'payments_driver',
    filterText: 'Pagamentos do motorista',
  },
] as const;

export type UberReportTypeKey = (typeof UBER_REPORT_TYPE_CATALOG)[number]['key'];

export const DEFAULT_UBER_REPORT_TYPE: UberReportTypeKey = 'REPORT_TYPE_PAYMENTS_ORDER';

export function resolveUberReportType(key?: string | null): UberReportTypeKey {
  const hit = UBER_REPORT_TYPE_CATALOG.find((t) => t.key === key);
  return hit?.key ?? DEFAULT_UBER_REPORT_TYPE;
}

export function uberReportTypeLabel(key: UberReportTypeKey): string {
  return UBER_REPORT_TYPE_CATALOG.find((t) => t.key === key)?.label ?? key;
}

export function uberReportTypeFromReportName(
  name: string,
  type?: string | null
): UberReportTypeKey | null {
  const blob = `${name} ${type ?? ''}`;
  if (
    /payments_order|payments_orde|transa[cç][aã]o de pagamentos?|transacao de pagamentos|payment.?transaction/i.test(
      blob
    )
  ) {
    return 'REPORT_TYPE_PAYMENTS_ORDER';
  }
  if (/payments_driver|pagamentos? do?s? motoristas?|driver payments?/i.test(blob)) {
    return 'REPORT_TYPE_PAYMENTS_DRIVER';
  }
  return null;
}

/** Tipos já vistos na lista Supplier; fallback ao catálogo completo. */
export function guessUberReportTypesFromReports(reports: UberReportListItem[]): UberReportTypeKey[] {
  const found = new Set<UberReportTypeKey>();
  for (const r of reports) {
    const k = uberReportTypeFromReportName(r.name, r.type);
    if (k) found.add(k);
  }
  const seen = UBER_REPORT_TYPE_CATALOG.map((t) => t.key).filter((k) => found.has(k));
  return seen.length > 0 ? seen : UBER_REPORT_TYPE_CATALOG.map((t) => t.key);
}

export function uberReportMatchesType(
  report: UberReportListItem,
  reportTypeKey: UberReportTypeKey
): boolean {
  const blob = `${report.name} ${report.type ?? ''}`;
  if (/driver_activity|atividade do moto/i.test(blob)) return false;
  if (reportTypeKey === 'REPORT_TYPE_PAYMENTS_ORDER') {
    return /payments_order|payments_orde|transa[cç][aã]o de pagamentos?|transacao de pagamentos|payment.?transaction/i.test(
      blob
    );
  }
  return /payments_driver|pagamentos? do?s? motoristas?|driver payments?/i.test(blob);
}

/** Chave única por linha (nome pode repetir na lista Uber). */
export function uberReportRowKey(r: UberReportListItem): string {
  return `${r.name}\u0001${r.createdAt ?? ''}\u0001${r.type ?? ''}`;
}

export function uberReportDisplayType(r: UberReportListItem): string {
  const t = (r.type ?? '').replace(/\s+/g, ' ').trim();
  if (t && !/^tipo de relatório$/i.test(t)) {
    return t.length > 32 ? `${t.slice(0, 29)}…` : t;
  }
  if (/driver_activity|atividade do moto/i.test(r.name)) return 'Atividade do motorista';
  if (/payments_order|payments_orde/i.test(r.name)) return 'Transação de pagamentos';
  if (/payments_driver/i.test(r.name)) return 'Pagamentos do motorista';
  return '—';
}

const PT_MONTH_NAMES = [
  '',
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

function formatPortugueseDayMonth(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const month = PT_MONTH_NAMES[m];
  if (!month || !d) return ymd;
  return `${d} de ${month}`;
}

/** Intervalo legível — prioriza datas do prefixo do nome (convenção Uber YYYYMMDD-YYYYMMDD). */
export function uberReportDisplayInterval(r: UberReportListItem): string {
  const fromName = extractUberReportDatesFromName(r.name);
  if (fromName) {
    return `${formatPortugueseDayMonth(fromName.startYmd)} - ${formatPortugueseDayMonth(fromName.endYmd)}`;
  }
  const interval = (r.interval ?? '').replace(/\s+/g, ' ').trim();
  if (interval && interval !== r.name && !/^\d{8}-\d{8}/.test(interval)) {
    return interval.length > 36 ? `${interval.slice(0, 33)}…` : interval;
  }
  return '—';
}

export function uberReportTypeOptionMatches(
  reportTypeKey: UberReportTypeKey,
  value: string,
  text: string
): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  const v = value.trim();
  if (reportTypeKey === 'REPORT_TYPE_PAYMENTS_ORDER') {
    if (v === 'REPORT_TYPE_PAYMENTS_ORDER') return true;
    if (/^transa[cç][aã]o de pagamentos?$/i.test(t)) return true;
    if (/^payment transactions?$/i.test(t)) return true;
    if (/transa[cç][aã]o/i.test(t) && /pagamento/i.test(t) && !/motorista/i.test(t)) return true;
    return false;
  }
  if (v === 'REPORT_TYPE_PAYMENTS_DRIVER') return true;
  if (/^pagamentos? do?s? motoristas?$/i.test(t)) return true;
  if (/^driver payments?$/i.test(t)) return true;
  if (/pagamento/i.test(t) && /motorista/i.test(t) && !/transa[cç][aã]o/i.test(t)) return true;
  if (/driver/i.test(t) && /payment/i.test(t) && !/order|transaction/i.test(t)) return true;
  return false;
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

const PT_MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/** Datas Y-m-d extraídas do prefixo do nome (`20260824-20260831-payments_order-…`). */
export function extractUberReportDatesFromName(name: string): {
  startYmd: string;
  endYmd: string;
} | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})/.exec(name.trim());
  if (!m) return null;
  return {
    startYmd: `${m[1]}-${m[2]}-${m[3]}`,
    endYmd: `${m[4]}-${m[5]}-${m[6]}`,
  };
}

function ymdUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetweenYmd(a: string, b: string): number {
  return Math.round((ymdUtcMs(b) - ymdUtcMs(a)) / 86_400_000);
}

function parsePortugueseIntervalDays(interval: string): {
  startDay: number;
  startMonth: number;
  endDay: number;
  endMonth: number;
} | null {
  const m = /(\d{1,2})\s+de\s+(\S+?)\s*[-–—]\s*(\d{1,2})\s+de\s+(\S+)/i.exec(
    interval.replace(/\s+/g, ' ').trim()
  );
  if (!m) return null;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const startMonth = PT_MONTHS[norm(m[2])];
  const endMonth = PT_MONTHS[norm(m[4])];
  if (!startMonth || !endMonth) return null;
  return {
    startDay: Number(m[1]),
    startMonth,
    endDay: Number(m[3]),
    endMonth,
  };
}

function intervalMatchesPeriodDays(
  interval: string,
  periodStartYmd: string,
  periodEndYmd: string
): boolean {
  const parsed = parsePortugueseIntervalDays(interval);
  if (!parsed) return false;
  const [sy, sm, sd] = periodStartYmd.split('-').map(Number);
  const [ey, em, ed] = periodEndYmd.split('-').map(Number);
  if (parsed.startDay !== sd || parsed.startMonth !== sm) return false;
  if (parsed.endDay === ed && parsed.endMonth === em) return true;
  // Uber às vezes mostra fim no dia seguinte ao domingo (ex. 24–31 vs seg–dom 24–30)
  return parsed.endMonth === em && Math.abs(parsed.endDay - ed) <= 1;
}

function isPaymentsUberReport(report: UberReportListItem): boolean {
  const blob = `${report.name} ${report.type ?? ''}`;
  return /payments_driver|payments_orde|pagamentos? do?s? motoristas?|transação de pagamentos|transacao de pagamentos|payment.?transaction|driver payments?/i.test(
    blob
  );
}

/** Relatórios de pagamentos descarregáveis (lista Supplier). */
export function listUberPaymentReports(reports: UberReportListItem[]): UberReportListItem[] {
  return reports.filter((r) => r.hasDownload && isPaymentsUberReport(r));
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

  const fromName = extractUberReportDatesFromName(name);
  if (fromName) {
    if (fromName.startYmd === periodStartYmd) {
      const endDiff = Math.abs(daysBetweenYmd(fromName.endYmd, periodEndYmd));
      if (endDiff <= 1) return true;
    }
    const nameStart = ymdToUberCompact(fromName.startYmd);
    const nameEnd = ymdToUberCompact(fromName.endYmd);
    if (nameStart === start && Math.abs(daysBetweenYmd(fromName.endYmd, periodEndYmd)) <= 1) {
      return true;
    }
    if (name.includes(start) && /payments/i.test(name)) {
      const endDiff = Math.abs(daysBetweenYmd(fromName.endYmd, periodEndYmd));
      if (endDiff <= 1) return true;
    }
  }

  const interval = (report.interval ?? '').replace(/\s+/g, ' ');
  if (interval) {
    if (intervalMatchesPeriodDays(interval, periodStartYmd, periodEndYmd)) return true;
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
    preferOrder: uberReportMatchesType(r, 'REPORT_TYPE_PAYMENTS_ORDER') ? 1 : 0,
  }));
  scored.sort((a, b) => {
    if (a.preferOrder !== b.preferOrder) return b.preferOrder - a.preferOrder;
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
 * Semana completa anterior em Europe/Lisbon (convenção Uber):
 * segunda 01:00 → segunda seguinte 23:30 (fim YYYYMMDD no nome, ex. …20260831).
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
  const endMonday = addDays(prevSunday.year, prevSunday.month, prevSunday.day, 1);

  return {
    rangeStart: lisbonLocalToUtcIso(prevMonday.year, prevMonday.month, prevMonday.day, 1, 0),
    rangeEnd: lisbonLocalToUtcIso(endMonday.year, endMonday.month, endMonday.day, 23, 30),
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
