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
} from 'lucide-react';
import {
  defaultPaymentWeekRange,
  lisbonDatetimeLocalToIso,
  pickLatestUberReportForPeriod,
  type PortalKind,
  type UberReportListItem,
  type UberSyncOptions,
} from '@tvde/shared';
import { Modal } from '@/components/modal';
import { API_PATHS, apiFetch, getStoredToken } from '@/lib/api';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { PortalQuickLoginModal } from '@/components/pagamentos/portal-quick-login-modal';

type SyncStatus = 'pending' | 'syncing' | 'done' | 'error' | 'awaiting_uber_choice';

type UberExistingChoice = {
  report: UberReportListItem;
  periodStart: string;
  periodEnd: string;
};

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
  return /sess[aã]o|session|expired|expirad|volte a ligar|faça login|fazer login|autentic|desligad|disconnected|não ligad|nao ligad|sem sessão|sem sessao|awaiting_otp|\botp\b|credentials|credencia|espera de OTP|já existe um job|conta não ligada|conta nao ligada/i.test(
    message
  );
}

const ORG_STORAGE_KEY = 'tvde.uber.organizationName';
const DEFAULT_ORG = 'CAMINHOS TOLERANTES, LDA';

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
  const res = await apiFetch(
    API_PATHS.portalConnections.sync(portal),
    { method: 'POST', body: JSON.stringify(body) },
    getStoredToken()
  );
  if (!res.success) {
    throw new Error(res.error || `Não foi possível iniciar sync ${portal}`);
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** Período Y-m-d para gerar relatório Uber (generate mode). */
  periodStart?: string;
  periodEnd?: string;
  onFinished?: () => void;
};

export function SyncPagamentosModal({
  open,
  onClose,
  periodStart,
  periodEnd,
  onFinished,
}: Props) {
  const { workspaceId } = useWorkspaceContext();
  const [phase, setPhase] = useState<'idle' | 'syncing' | 'summary'>('idle');
  const [activeIndex, setActiveIndex] = useState(0);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [blockingClose, setBlockingClose] = useState(false);
  const [loginPortal, setLoginPortal] = useState<PortalKind | null>(null);
  const [retryingId, setRetryingId] = useState<ProviderId | null>(null);
  const [uberChoice, setUberChoice] = useState<UberExistingChoice | null>(null);
  const uberChoiceResolverRef = useRef<((choice: 'existing' | 'generate') => void) | null>(
    null
  );
  const rafRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    if (uberChoiceResolverRef.current) {
      uberChoiceResolverRef.current = null;
    }
    setUberChoice(null);
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

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    reset();
    setPhase('syncing');
  }, [open, reset]);

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

  const waitUberChoice = useCallback(
    (index: number, payload: UberExistingChoice) => {
      return new Promise<'existing' | 'generate'>((resolve) => {
        uberChoiceResolverRef.current = resolve;
        setUberChoice(payload);
        markRow(index, {
          status: 'awaiting_uber_choice',
          progress: 40,
          message: 'já existe relatório neste intervalo — escolha',
        });
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      });
    },
    [markRow]
  );

  const resolveUberChoice = useCallback((choice: 'existing' | 'generate') => {
    const resolve = uberChoiceResolverRef.current;
    uberChoiceResolverRef.current = null;
    setUberChoice(null);
    resolve?.(choice);
  }, []);

  const runUber = useCallback(
    async (index: number) => {
      const week = defaultPaymentWeekRange();
      const start = periodStart || week.periodStart;
      const end = periodEnd || week.periodEnd;
      const org = readUberOrg();
      const rangeStart = lisbonDatetimeLocalToIso(`${start}T01:00`);
      const rangeEnd = lisbonDatetimeLocalToIso(`${end}T23:30`);

      markRow(index, {
        status: 'syncing',
        progress: 8,
        message: 'a listar relatórios Uber…',
      });
      animateProgress(index, 60_000);

      const listRes = await apiFetch<UberReportListItem[]>(
        API_PATHS.portalConnections.reports('uber'),
        { method: 'POST', body: JSON.stringify({}) },
        getStoredToken()
      );
      if (!listRes.success || !listRes.data) {
        const err = new Error(
          listRes.error || 'Não foi possível listar relatórios Uber'
        ) as Error & { needsLogin?: boolean };
        err.needsLogin = isSessionError(err.message);
        throw err;
      }

      const latest = pickLatestUberReportForPeriod(listRes.data, start, end);
      let uberSync: UberSyncOptions;

      if (latest) {
        const choice = await waitUberChoice(index, {
          report: latest,
          periodStart: start,
          periodEnd: end,
        });
        if (choice === 'existing') {
          uberSync = { mode: 'existing', reportName: latest.name };
        } else {
          uberSync = {
            mode: 'generate',
            rangeStart,
            rangeEnd,
            organizationName: org,
          };
        }
      } else {
        uberSync = {
          mode: 'generate',
          rangeStart,
          rangeEnd,
          organizationName: org,
        };
      }

      markRow(index, {
        status: 'syncing',
        progress: 45,
        message:
          uberSync.mode === 'existing'
            ? `a descarregar «${uberSync.reportName?.slice(0, 42) ?? 'relatório'}»…`
            : 'a gerar relatório novo…',
      });
      animateProgress(index, uberSync.mode === 'existing' ? 60_000 : 120_000);

      await startPortalSync('uber', { uberSync });
      return pollPortalUntilDone('uber', 15 * 60_000);
    },
    [animateProgress, markRow, periodEnd, periodStart, waitUberChoice]
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
      animateProgress(index, 90_000);
      await startPortalSync('myprio', { syncScope: 'fleet' });
      await pollPortalUntilDone('myprio', 2 * 60_000);
      markRow(index, { progress: 55, message: 'Frota OK · a sincronizar electricidade…' });
      await startPortalSync('myprio', { syncScope: 'electric' });
      return pollPortalUntilDone('myprio', 2 * 60_000);
    },
    [animateProgress, markRow]
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
      } catch (err) {
        if (cancelled || token !== runTokenRef.current) return;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        const message = err instanceof Error ? err.message : 'Erro';
        const needsLogin =
          Boolean(provider.portal) &&
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
        phase === 'summary' ? 'Resumo do sincronismo' : 'A sincronizar plataformas'
      }
      showCloseButton={!(blockingClose && phase === 'syncing')}
      closeOnBackdrop={!(blockingClose && phase === 'syncing')}
      closeOnEscape={!(blockingClose && phase === 'syncing')}
      panelClassName="max-w-xl"
      footer={
        phase === 'summary' ? (
          <button type="button" className="btn-primary" onClick={onClose}>
            Fechar
          </button>
        ) : uberChoice ? (
          <p className="text-xs text-amber-800">
            Escolha se reutiliza o relatório Uber existente ou gera um novo para continuar.
          </p>
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
          {periodStart && periodEnd ? (
            <>
              {' '}
              Período Uber: <span className="font-medium text-slate-700">{periodStart}</span> →{' '}
              <span className="font-medium text-slate-700">{periodEnd}</span>.
            </>
          ) : null}
        </p>

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
                    {row.status === 'awaiting_uber_choice' && (
                      <span className="text-amber-700">à espera</span>
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
                {row.status === 'syncing' ||
                row.status === 'awaiting_uber_choice' ||
                row.status === 'done' ||
                row.status === 'error' ? (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-[width] duration-150 ${
                        row.status === 'error'
                          ? 'bg-red-500'
                          : row.status === 'done'
                            ? 'bg-emerald-500'
                            : row.status === 'awaiting_uber_choice'
                              ? 'bg-amber-400'
                              : 'bg-[var(--color-primary)]'
                      }`}
                      style={{ width: `${row.progress}%` }}
                    />
                  </div>
                ) : null}
                {row.id === 'uber' && uberChoice && row.status === 'awaiting_uber_choice' ? (
                  <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2.5">
                    <p className="text-xs text-amber-950">
                      Já existe um relatório de pagamentos para{' '}
                      <span className="font-medium">
                        {uberChoice.periodStart} → {uberChoice.periodEnd}
                      </span>
                      . Pode reutilizar o último ou gerar um novo.
                    </p>
                    <div className="overflow-hidden rounded border border-amber-100 bg-white">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-2 py-1.5 font-medium">Nome</th>
                            <th className="px-2 py-1.5 font-medium">Intervalo</th>
                            <th className="px-2 py-1.5 font-medium">Criado</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-slate-100">
                            <td
                              className="max-w-[11rem] truncate px-2 py-1.5 font-medium text-slate-800"
                              title={uberChoice.report.name}
                            >
                              {uberChoice.report.name}
                            </td>
                            <td
                              className="max-w-[8rem] truncate px-2 py-1.5 text-slate-600"
                              title={uberChoice.report.interval ?? ''}
                            >
                              {uberChoice.report.interval ?? '—'}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                              {uberChoice.report.createdAt ?? '—'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <button
                        type="button"
                        className="btn-primary px-2.5 py-1 text-xs"
                        onClick={() => resolveUberChoice('existing')}
                      >
                        Usar este relatório
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1 text-xs"
                        onClick={() => resolveUberChoice('generate')}
                      >
                        Gerar novo
                      </button>
                    </div>
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
              {errorCount ? ` · ${errorCount} com erro` : ''} — se a sessão
              expirou use Login e depois Repetir; em timeout do portal use só Repetir.
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
