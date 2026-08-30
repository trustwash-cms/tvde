'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Car,
  CheckCircle2,
  Fuel,
  Loader2,
  LogIn,
  MapPinned,
  RefreshCw,
  Zap,
  AlertCircle,
  Calculator,
} from 'lucide-react';
import {
  defaultPaymentWeekRange,
  lisbonDatetimeLocalToIso,
  listUberPaymentReports,
  uberReportMatchesPeriod,
  uberReportMatchesType,
  resolveUberReportType,
  uberReportTypeLabel,
  UBER_REPORT_TYPE_CATALOG,
  DEFAULT_UBER_REPORT_TYPE,
  type PortalKind,
  type UberReportListItem,
  type UberReportTypeKey,
  type UberSyncOptions,
} from '@tvde/shared';
import { Modal } from '@/components/modal';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { PortalQuickLoginModal } from '@/components/pagamentos/portal-quick-login-modal';

type SyncStatus = 'pending' | 'syncing' | 'done' | 'error';

type UberReadyMode = 'existing' | 'generate';

type ProviderId = 'uber' | 'bolt' | 'viaverde' | 'prio';

type ProviderRow = {
  id: ProviderId;
  name: string;
  icon: typeof Car;
  status: SyncStatus;
  progress: number;
  message: string;
  error?: string;
  /** Portal RPA associado (para login). */
  portal?: PortalKind;
  needsLogin?: boolean;
};

const PROVIDERS_BASE: Omit<
  ProviderRow,
  'status' | 'progress' | 'message' | 'error' | 'needsLogin'
>[] = [
  { id: 'uber', name: 'Uber', icon: Car, portal: 'uber' },
  { id: 'bolt', name: 'Bolt', icon: Zap },
  { id: 'viaverde', name: 'Via Verde', icon: MapPinned, portal: 'via_verde' },
  { id: 'prio', name: 'Prio (elec. + combustível)', icon: Fuel, portal: 'myprio' },
];

/**
 * Sessão / login em falta — NÃO incluir «timeout» genérico.
 * Timeout Playwright ou poll ≠ precisa de Login (pode ser portal lento).
 */
function isSessionError(message: string): boolean {
  return /sess[aã]o|session|expired|expirad|volte a ligar|faça login|fazer login|autentic|desligad|disconnected|não ligad|nao ligad|sem sessão|sem sessao|awaiting_otp|\botp\b|credentials|credencia|espera de OTP|conta não ligada|conta nao ligada/i.test(
    message
  );
}

function isJobConflictError(message: string): boolean {
  return /sincroniza(ç|c)ão.*em curso|job.*em curso|opera(ç|c)ão em curso/i.test(message);
}

const ORG_STORAGE_KEY = 'tvde.uber.organizationName';
const REPORT_TYPE_STORAGE_KEY = 'tvde.uber.reportTypeKey';
const DEFAULT_ORG = 'CAMINHOS TOLERANTES, LDA';

function readUberReportType(): UberReportTypeKey {
  if (typeof window === 'undefined') return DEFAULT_UBER_REPORT_TYPE;
  try {
    return resolveUberReportType(localStorage.getItem(REPORT_TYPE_STORAGE_KEY));
  } catch {
    return DEFAULT_UBER_REPORT_TYPE;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function readUberOrg(): string {
  if (typeof window === 'undefined') return DEFAULT_ORG;
  try {
    return localStorage.getItem(ORG_STORAGE_KEY)?.trim() || DEFAULT_ORG;
  } catch {
    return DEFAULT_ORG;
  }
}

type PortalConnectionStatus = {
  status?: string;
  activeJobId?: string | null;
  activeJobStatus?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  lastJobMessage?: string | null;
};

async function pollPortalUntilDone(portal: PortalKind, timeoutMs: number) {
  const started = Date.now();
  let lastSyncAt: string | null | undefined;

  const first = await apiFetch<PortalConnectionStatus>(
    API_PATHS.portalConnections.byPortal(portal),
    {},
    getStoredToken()
  );
  if (first.data?.status === 'disconnected' || first.data?.status === 'expired') {
    const err = new Error(
      first.data.lastError ||
        `Sessão ${portal} expirada ou desligada — faça login`
    ) as Error & { needsLogin?: boolean };
    err.needsLogin = true;
    throw err;
  }
  lastSyncAt = first.data?.lastSyncAt;

  while (Date.now() - started < timeoutMs) {
    await sleep(1500);
    const res = await apiFetch<PortalConnectionStatus>(
      API_PATHS.portalConnections.byPortal(portal),
      {},
      getStoredToken()
    );
    if (!res.success || !res.data) {
      throw new Error(res.error || `Falha ao consultar estado ${portal}`);
    }
    const s = res.data.activeJobStatus;
    if (res.data.status === 'expired' || res.data.status === 'disconnected') {
      const msg =
        res.data.lastError ||
        `Sessão ${portal} expirada ou desligada — faça login`;
      const err = new Error(msg) as Error & { needsLogin?: boolean };
      err.needsLogin = true;
      throw err;
    }
    if (s === 'failed' || res.data.status === 'error') {
      const msg = res.data.lastError || res.data.lastJobMessage || 'Sincronização falhou';
      const err = new Error(msg) as Error & { needsLogin?: boolean };
      err.needsLogin =
        res.data.status === 'expired' ||
        res.data.status === 'disconnected' ||
        isSessionError(msg);
      throw err;
    }
    if (s === 'completed') {
      return res.data.lastJobMessage || 'Concluído';
    }
    if (
      Boolean(res.data.lastSyncAt) &&
      res.data.lastSyncAt !== lastSyncAt &&
      !res.data.activeJobId
    ) {
      return res.data.lastJobMessage || 'Concluído';
    }
  }

  // Poll esgotado — consultar estado final; Login só se a API marcar sessão morta
  const final = await apiFetch<PortalConnectionStatus>(
    API_PATHS.portalConnections.byPortal(portal),
    {},
    getStoredToken()
  );
  const finalStatus = final.data?.status;
  const finalMsg =
    final.data?.lastError ||
    final.data?.lastJobMessage ||
    `Timeout a sincronizar ${portal}`;
  const err = new Error(
    finalStatus === 'expired' || finalStatus === 'disconnected'
      ? final.data?.lastError || `Sessão ${portal} expirada ou desligada — faça login`
      : /Timeout Playwright|sync abortado/i.test(finalMsg)
        ? finalMsg
        : `Timeout a sincronizar ${portal} (portal lento ou sync ainda a correr — use Repetir; Login só se a sessão estiver expirada)`
  ) as Error & { needsLogin?: boolean };
  err.needsLogin =
    finalStatus === 'expired' ||
    finalStatus === 'disconnected' ||
    isSessionError(finalMsg);
  throw err;
}

async function startPortalSync(portal: PortalKind, body: Record<string, unknown>) {
  const attempt = async () => {
    const res = await apiFetch(
      API_PATHS.portalConnections.sync(portal),
      { method: 'POST', body: JSON.stringify(body) },
      getStoredToken()
    );
    if (!res.success) {
      throw new Error(res.error || `Não foi possível iniciar sync ${portal}`);
    }
  };

  try {
    await attempt();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJobConflictError(message)) {
      await sleep(3500);
      await attempt();
      return;
    }
    throw err;
  }
}

/** Pausa entre plataformas — libertar Chromium antes do próximo portal. */
const STEP_COOLDOWN_MS = 2500;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Período Y-m-d para gerar relatório Uber (generate mode). */
  periodStart?: string;
  periodEnd?: string;
  onFinished?: () => void;
  /** Abrir calculadora de pagamento (resumo do sincronismo). */
  onCalculatePayment?: () => void;
};

export function SyncPagamentosModal({
  open,
  onClose,
  periodStart: periodStartProp,
  periodEnd: periodEndProp,
  onFinished,
  onCalculatePayment,
}: Props) {
  const { workspaceId } = useWorkspaceContext();
  const [phase, setPhase] = useState<'idle' | 'ready' | 'syncing' | 'summary'>('idle');
  const [activeIndex, setActiveIndex] = useState(0);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [blockingClose, setBlockingClose] = useState(false);
  const [loginPortal, setLoginPortal] = useState<PortalKind | null>(null);
  const [retryingId, setRetryingId] = useState<ProviderId | null>(null);
  const [uberReports, setUberReports] = useState<UberReportListItem[]>([]);
  const [uberListLoading, setUberListLoading] = useState(false);
  const [uberListError, setUberListError] = useState('');
  const [uberListNeedsLogin, setUberListNeedsLogin] = useState(false);
  const [uberSelectedReport, setUberSelectedReport] = useState<string | null>(null);
  const [uberReadyMode, setUberReadyMode] = useState<UberReadyMode>('existing');
  const [uberPeriodStart, setUberPeriodStart] = useState('');
  const [uberPeriodEnd, setUberPeriodEnd] = useState('');
  const [uberReportTypeKey, setUberReportTypeKey] = useState<UberReportTypeKey>(
    DEFAULT_UBER_REPORT_TYPE
  );
  const uberPeriodRef = useRef({ start: '', end: '' });
  const uberSyncRef = useRef<UberSyncOptions | null>(null);
  const rafRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    setUberReports([]);
    setUberListLoading(false);
    setUberListError('');
    setUberListNeedsLogin(false);
    setUberSelectedReport(null);
    setUberReadyMode('existing');
    uberSyncRef.current = null;
    setPhase('idle');
    setActiveIndex(0);
    setBlockingClose(false);
    setRows(
      PROVIDERS_BASE.map((p) => ({
        ...p,
        status: 'pending',
        progress: 0,
        message: 'em espera',
      }))
    );
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const loadUberReports = useCallback(async (periodStart: string, periodEnd: string) => {
    setUberListLoading(true);
    setUberListError('');
    setUberListNeedsLogin(false);
    setUberSelectedReport(null);
    const res = await apiFetch<UberReportListItem[]>(
      API_PATHS.portalConnections.reports('uber'),
      { method: 'POST', body: JSON.stringify({}) },
      getStoredToken()
    );
    setUberListLoading(false);
    if (!res.success || !res.data) {
      const msg = res.error || 'Não foi possível listar relatórios Uber';
      setUberReports([]);
      setUberListError(msg);
      setUberListNeedsLogin(isSessionError(msg));
      setUberReadyMode('generate');
      return;
    }
    // Lista completa do Supplier (como no modal Uber antigo)
    setUberReports(res.data);
    const reportTypeKey = readUberReportType();
    const paymentReports = listUberPaymentReports(res.data).filter((r) =>
      uberReportMatchesType(r, reportTypeKey)
    );
    const matching = paymentReports.find((r) =>
      uberReportMatchesPeriod(r, periodStart, periodEnd)
    );
    const preselect =
      matching?.name ??
      paymentReports.find((r) => r.hasDownload)?.name ??
      listUberPaymentReports(res.data).find((r) => r.hasDownload && /payments_order/i.test(r.name))
        ?.name ??
      res.data.find((r) => r.hasDownload && !/driver_activity/i.test(r.name))?.name ??
      null;
    if (preselect) {
      setUberSelectedReport(preselect);
      setUberReadyMode('existing');
    } else {
      setUberReadyMode('generate');
    }
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    reset();
    const week = defaultPaymentWeekRange();
    const start = periodStartProp || week.periodStart;
    const end = periodEndProp || week.periodEnd;
    setUberPeriodStart(start);
    setUberPeriodEnd(end);
    setUberReportTypeKey(readUberReportType());
    uberPeriodRef.current = { start, end };
    setPhase('ready');
    void loadUberReports(start, end);
  }, [open, reset, periodStartProp, periodEndProp, loadUberReports]);

  function buildUberSyncOptions(): UberSyncOptions | null {
    if (uberReadyMode === 'existing') {
      if (!uberSelectedReport) return null;
      return { mode: 'existing', reportName: uberSelectedReport };
    }
    if (!uberPeriodStart || !uberPeriodEnd || uberPeriodEnd < uberPeriodStart) return null;
    return {
      mode: 'generate',
      rangeStart: lisbonDatetimeLocalToIso(`${uberPeriodStart}T01:00`),
      rangeEnd: lisbonDatetimeLocalToIso(`${uberPeriodEnd}T23:30`),
      organizationName: readUberOrg(),
      reportTypeKey: uberReportTypeKey,
    };
  }

  function startSync() {
    const uberSync = buildUberSyncOptions();
    if (!uberSync) return;
    uberPeriodRef.current = { start: uberPeriodStart, end: uberPeriodEnd };
    uberSyncRef.current = uberSync;
    setActiveIndex(0);
    setPhase('syncing');
  }

  const canStartSync =
    !uberListLoading &&
    Boolean(buildUberSyncOptions()) &&
    (uberReadyMode === 'generate' || Boolean(uberSelectedReport));

  const animateProgress = useCallback((index: number, durationMs: number) => {
    const start = performance.now();
    const step = (now: number) => {
      const pct = Math.min(94, ((now - start) / durationMs) * 100);
      setRows((prev) => {
        const next = [...prev];
        if (next[index]) next[index] = { ...next[index], progress: pct };
        return next;
      });
      if (pct < 94) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const markRow = useCallback(
    (index: number, patch: Partial<ProviderRow>) => {
      setRows((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
    []
  );

  const runUber = useCallback(
    async (index: number) => {
      const org = readUberOrg();
      let uberSync = uberSyncRef.current;
      if (!uberSync) {
        // Fallback (ex. Repetir): gerar com o período actual
        const { start, end } = uberPeriodRef.current;
        uberSync = {
          mode: 'generate',
          rangeStart: lisbonDatetimeLocalToIso(`${start}T01:00`),
          rangeEnd: lisbonDatetimeLocalToIso(`${end}T23:30`),
          organizationName: org,
          reportTypeKey: readUberReportType(),
        };
      }

      markRow(index, {
        status: 'syncing',
        progress: 12,
        message:
          uberSync.mode === 'existing'
            ? `a descarregar «${uberSync.reportName?.slice(0, 42) ?? 'relatório'}»…`
            : 'a gerar relatório novo…',
      });
      animateProgress(index, uberSync.mode === 'existing' ? 60_000 : 120_000);

      await startPortalSync('uber', { uberSync });
      return pollPortalUntilDone('uber', 15 * 60_000);
    },
    [animateProgress, markRow]
  );

  const runBolt = useCallback(
    async (index: number) => {
      if (!workspaceId) {
        throw new Error('Seleccione um workspace com Bolt configurado');
      }
      animateProgress(index, 25_000);
      const res = await apiFetch(
        API_PATHS.bolt.sync,
        {
          method: 'POST',
          body: JSON.stringify({ workspaceId, type: 'all' }),
        },
        getStoredToken()
      );
      if (!res.success) throw new Error(res.error || 'Sync Bolt falhou');
      return 'Pedidos / motoristas / viaturas actualizados';
    },
    [animateProgress, workspaceId]
  );

  const runViaVerde = useCallback(
    async (index: number) => {
      animateProgress(index, 45_000);
      await startPortalSync('via_verde', {});
      return pollPortalUntilDone('via_verde', 3.5 * 60_000);
    },
    [animateProgress]
  );

  const runPrio = useCallback(
    async (index: number) => {
      animateProgress(index, 180_000);
      await startPortalSync('myprio', { syncScope: 'both' });
      return pollPortalUntilDone('myprio', 4.5 * 60_000);
    },
    [animateProgress]
  );

  useEffect(() => {
    if (!open || phase !== 'syncing') return;
    if (activeIndex >= PROVIDERS_BASE.length) {
      setPhase('summary');
      setBlockingClose(false);
      onFinished?.();
      return;
    }

    const index = activeIndex;
    const provider = PROVIDERS_BASE[index];
    const token = ++runTokenRef.current;
    setBlockingClose(true);
    markRow(index, { status: 'syncing', progress: 0, message: 'a sincronizar…', error: undefined });

    const runners: Record<ProviderRow['id'], (i: number) => Promise<string>> = {
      uber: runUber,
      bolt: runBolt,
      viaverde: runViaVerde,
      prio: runPrio,
    };

    let cancelled = false;
    void (async () => {
      try {
        const message = await runners[provider.id](index);
        if (cancelled || token !== runTokenRef.current) return;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        markRow(index, {
          status: 'done',
          progress: 100,
          message: message || 'concluído',
        });
        await sleep(STEP_COOLDOWN_MS);
      } catch (err) {
        if (cancelled || token !== runTokenRef.current) return;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        const message = err instanceof Error ? err.message : 'Erro';
        const needsLogin =
          Boolean(provider.portal) &&
          !isJobConflictError(message) &&
          (Boolean((err as { needsLogin?: boolean })?.needsLogin) || isSessionError(message));
        markRow(index, {
          status: 'error',
          progress: 100,
          message: 'erro',
          error: message,
          needsLogin,
        });
      }
      if (cancelled || token !== runTokenRef.current) return;
      await sleep(STEP_COOLDOWN_MS);
      setActiveIndex((i) => i + 1);
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    open,
    phase,
    activeIndex,
    markRow,
    onFinished,
    runBolt,
    runPrio,
    runUber,
    runViaVerde,
  ]);

  const doneCount = rows.filter((r) => r.status === 'done').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;

  const retryProvider = useCallback(
    async (providerId: ProviderId) => {
      const index = PROVIDERS_BASE.findIndex((p) => p.id === providerId);
      if (index < 0) return;
      const provider = PROVIDERS_BASE[index];
      setRetryingId(providerId);
      markRow(index, {
        status: 'syncing',
        progress: 0,
        message: 'a sincronizar…',
        error: undefined,
        needsLogin: false,
      });

      const runners: Record<ProviderId, (i: number) => Promise<string>> = {
        uber: runUber,
        bolt: runBolt,
        viaverde: runViaVerde,
        prio: runPrio,
      };

      try {
        const message = await runners[providerId](index);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        markRow(index, {
          status: 'done',
          progress: 100,
          message: message || 'concluído',
          error: undefined,
          needsLogin: false,
        });
      } catch (err) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        const message = err instanceof Error ? err.message : 'Erro';
        const needsLogin =
          Boolean(provider.portal) &&
          !isJobConflictError(message) &&
          (Boolean((err as { needsLogin?: boolean })?.needsLogin) || isSessionError(message));
        markRow(index, {
          status: 'error',
          progress: 100,
          message: 'erro',
          error: message,
          needsLogin,
        });
        // Sync bloqueado porque MyPRIO/Uber já pediu OTP — abrir login/OTP
        if (needsLogin && provider.portal && /espera de OTP|awaiting_otp/i.test(message)) {
          setLoginPortal(provider.portal);
        }
      } finally {
        setRetryingId(null);
      }
    },
    [markRow, runBolt, runPrio, runUber, runViaVerde]
  );

  return (
    <>
    <Modal
      open={open}
      onClose={() => {
        if (blockingClose && phase === 'syncing') return;
        onClose();
      }}
      title={
        phase === 'summary'
          ? 'Resumo do sincronismo'
          : phase === 'ready'
            ? 'Sincronizar plataformas'
            : 'A sincronizar plataformas'
      }
      showCloseButton={!(blockingClose && phase === 'syncing')}
      closeOnBackdrop={!(blockingClose && phase === 'syncing')}
      closeOnEscape={!(blockingClose && phase === 'syncing')}
      panelClassName="max-w-2xl"
      scrollBody
      footer={
        phase === 'summary' ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Fechar
            </button>
            {onCalculatePayment ? (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                onClick={() => {
                  onCalculatePayment();
                  onClose();
                }}
              >
                <Calculator className="h-4 w-4" />
                Calcular pagamento
              </button>
            ) : null}
          </div>
        ) : phase === 'ready' ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canStartSync}
              onClick={startSync}
            >
              Iniciar sincronismo
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Não feche esta janela enquanto o sincronismo corre.
          </p>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Sequência: Uber → Bolt → Via Verde → Prio (frota + electricidade).
        </p>

        {phase === 'ready' ? (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div>
              <p className="text-xs font-medium text-slate-700">Uber — relatórios existentes</p>
              <p className="mt-1 text-xs text-slate-500">
                Lista do Supplier. Preferir «Transação de pagamentos» (`payments_order`). Ou gere um
                novo com o período abaixo.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 text-sm">
              <label className="inline-flex items-center gap-2 text-slate-800">
                <input
                  type="radio"
                  name="uber-ready-mode"
                  checked={uberReadyMode === 'existing'}
                  disabled={uberListLoading || uberReports.every((r) => !r.hasDownload)}
                  onChange={() => setUberReadyMode('existing')}
                />
                Usar relatório da lista
              </label>
              <label className="inline-flex items-center gap-2 text-slate-800">
                <input
                  type="radio"
                  name="uber-ready-mode"
                  checked={uberReadyMode === 'generate'}
                  disabled={uberListLoading}
                  onChange={() => setUberReadyMode('generate')}
                />
                Gerar novo com período
              </label>
            </div>

            {uberListLoading ? (
              <div className="flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-3 text-sm text-sky-900">
                <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
                A listar relatórios no portal Uber… (pode demorar ~45–60s)
              </div>
            ) : uberListError ? (
              <div className="space-y-2">
                <p className="text-sm text-amber-800">{uberListError}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                    onClick={() => void loadUberReports(uberPeriodStart, uberPeriodEnd)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Tentar outra vez
                  </button>
                  {uberListNeedsLogin ? (
                    <button
                      type="button"
                      className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                      onClick={() => setLoginPortal('uber')}
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      Login Uber
                    </button>
                  ) : null}
                </div>
              </div>
            ) : uberReports.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhum relatório na lista — use «Gerar novo com período».
              </p>
            ) : (
              <div
                className={`max-h-56 overflow-auto rounded-md border border-slate-200 bg-white ${
                  uberReadyMode !== 'existing' ? 'opacity-60' : ''
                }`}
              >
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="w-8 px-2 py-2" />
                      <th className="px-2 py-2 font-medium">Nome</th>
                      <th className="px-2 py-2 font-medium">Intervalo</th>
                      <th className="px-2 py-2 font-medium">Criado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uberReports.map((r) => {
                      const disabled = !r.hasDownload || uberReadyMode !== 'existing';
                      const matches =
                        Boolean(uberPeriodStart) &&
                        Boolean(uberPeriodEnd) &&
                        uberReportMatchesPeriod(r, uberPeriodStart, uberPeriodEnd);
                      return (
                        <tr
                          key={r.name + (r.createdAt ?? '')}
                          className={`border-t border-slate-100 ${
                            !r.hasDownload
                              ? 'opacity-50'
                              : matches
                                ? 'bg-emerald-50/70'
                                : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="radio"
                              name="uber-report-ready"
                              disabled={disabled}
                              checked={uberSelectedReport === r.name}
                              onChange={() => {
                                setUberSelectedReport(r.name);
                                setUberReadyMode('existing');
                              }}
                            />
                          </td>
                          <td
                            className="max-w-[14rem] truncate px-2 py-1.5 font-medium text-slate-800"
                            title={r.name}
                          >
                            {r.name}
                            {matches ? (
                              <span className="ml-1 text-[10px] font-normal text-emerald-700">
                                (período)
                              </span>
                            ) : null}
                          </td>
                          <td
                            className="max-w-[10rem] truncate px-2 py-1.5 text-slate-600"
                            title={r.interval ?? ''}
                          >
                            {r.interval ?? '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                            {r.createdAt ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div
              className={`space-y-2 border-t border-slate-200 pt-3 ${
                uberReadyMode !== 'generate' ? 'opacity-70' : ''
              }`}
            >
              <p className="text-xs font-medium text-slate-700">
                Período para gerar novo (se não usar a lista)
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Tipo de relatório</span>
                <select
                  className="input w-full"
                  value={uberReportTypeKey}
                  disabled={uberReadyMode !== 'generate'}
                  onChange={(e) => {
                    const next = resolveUberReportType(e.target.value);
                    setUberReportTypeKey(next);
                    try {
                      localStorage.setItem(REPORT_TYPE_STORAGE_KEY, next);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {UBER_REPORT_TYPE_CATALOG.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-slate-500">
                Por defeito: {uberReportTypeLabel(DEFAULT_UBER_REPORT_TYPE)}.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">De</span>
                  <input
                    type="date"
                    className="input w-full"
                    value={uberPeriodStart}
                    onChange={(e) => setUberPeriodStart(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Até</span>
                  <input
                    type="date"
                    className="input w-full"
                    value={uberPeriodEnd}
                    onChange={(e) => setUberPeriodEnd(e.target.value)}
                  />
                </label>
              </div>
              <p className="text-xs text-slate-500">
                Por defeito: última semana completa (segunda→domingo). Só é usado em «Gerar novo».
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
            Uber:{' '}
            {uberSyncRef.current?.mode === 'existing'
              ? `relatório «${uberSyncRef.current.reportName?.slice(0, 48) ?? ''}»`
              : `gerar ${uberPeriodStart} → ${uberPeriodEnd}`}
          </div>
        )}

        {phase === 'ready' ? (
          <p className="text-sm text-slate-600">
            Escolha o relatório Uber (ou gere um novo) e clique em{' '}
            <span className="font-medium">Iniciar sincronismo</span>. Via Verde / Prio renovam a
            sessão automaticamente quando possível.
          </p>
        ) : null}

        <ul className="space-y-3">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <li key={row.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700 ${
                        row.status === 'syncing' ? 'animate-pulse' : ''
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.message}</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-xs">
                    {row.status === 'pending' && (
                      <span className="text-slate-400">em espera</span>
                    )}
                    {row.status === 'syncing' && (
                      <span className="inline-flex items-center gap-1 text-slate-600">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        a sincronizar…
                      </span>
                    )}
                    {row.status === 'done' && (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        OK
                      </span>
                    )}
                    {row.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Erro
                      </span>
                    )}
                  </span>
                </div>
                {row.status === 'syncing' || row.status === 'done' || row.status === 'error' ? (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-[width] duration-150 ${
                        row.status === 'error'
                          ? 'bg-red-500'
                          : row.status === 'done'
                            ? 'bg-emerald-500'
                            : 'bg-[var(--color-primary)]'
                      }`}
                      style={{ width: `${row.progress}%` }}
                    />
                  </div>
                ) : null}
                {row.error ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="flex-1 text-xs text-red-600">{row.error}</p>
                    {row.needsLogin && row.portal ? (
                      <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                        disabled={retryingId === row.id}
                        onClick={() => setLoginPortal(row.portal!)}
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        Login
                      </button>
                    ) : null}
                    {row.status === 'error' && phase === 'summary' ? (
                      <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                        disabled={retryingId === row.id}
                        onClick={() => void retryProvider(row.id)}
                      >
                        {retryingId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Repetir
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {phase === 'summary' ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="inline-flex items-center gap-2 font-medium">
              <RefreshCw className="h-4 w-4 text-[var(--color-primary)]" />
              Sincronismo terminado
            </p>
            <p className="mt-1 text-slate-500">
              {doneCount} OK
              {errorCount ? ` · ${errorCount} com erro` : ''} — conflito ou portal lento:
              use Repetir; Login só se a sessão estiver expirada.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>

    <PortalQuickLoginModal
      open={Boolean(loginPortal)}
      portal={loginPortal}
      onClose={() => setLoginPortal(null)}
      onSuccess={(portal) => {
        const row = PROVIDERS_BASE.find((p) => p.portal === portal);
        if (row) void retryProvider(row.id);
      }}
    />
    </>
  );
}
