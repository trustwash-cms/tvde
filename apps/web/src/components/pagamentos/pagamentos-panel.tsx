'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import {
  defaultPaymentWeekRange,
  type PaymentCalculation,
  type PaymentDriverOption,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiUrl, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { MassPagamentosModal } from '@/components/pagamentos/mass-pagamentos-modal';
import { SyncPagamentosModal } from '@/components/pagamentos/sync-pagamentos-modal';

function formatMoney(value: string | number) {
  const n = Number(value);
  if (Number.isNaN(n)) return '€ 0,00';
  return `€ ${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDatePt(ymd: string) {
  if (!ymd) return '—';
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-PT');
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MoneyRow({
  label,
  amount,
  muted,
  strong,
}: {
  label: string;
  amount: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-1.5 text-sm ${
        strong ? 'border-t border-slate-200 pt-3 font-semibold text-slate-900' : ''
      } ${muted ? 'text-slate-500' : 'text-slate-700'}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(amount)}</span>
    </div>
  );
}

type PaymentMethod = { code: string; label: string };

type PaymentReportRow = {
  id: string;
  userId: string;
  userLabel: string;
  userEmail: string | null;
  periodStart: string;
  periodEnd: string;
  receitasTotal: string;
  receitasUber: string;
  receitasBolt: string;
  despesasTotal: string;
  despesasViaVerde: string;
  despesasEletricidade: string;
  despesasCombustivel: string;
  despesasComissao: string;
  despesasIva6: string;
  despesasContaCorrente: string;
  contaCorrenteLabel: 'credito' | 'debito' | 'zero';
  resultadoFinal: string;
  isPaid: boolean;
  paymentMethod: string | null;
  lastSentAt: string | null;
  attachmentsCount: number;
  createdAt: string;
};

type PaymentReportDetail = PaymentReportRow & {
  details: PaymentCalculation['detalhes'] | null;
  warnings: string[];
};

type PaymentAttachment = {
  id: string;
  paymentReportId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  createdAt: string;
};

type ReportsList = {
  items: PaymentReportRow[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

type Filters = {
  periodStart: string;
  periodEnd: string;
  search: string;
  isPaid: '' | 'true' | 'false';
  paymentMethod: string;
  perPage: number;
};

const EMPTY_FILTERS: Filters = {
  periodStart: '',
  periodEnd: '',
  search: '',
  isPaid: '',
  paymentMethod: '',
  perPage: 25,
};

export function PagamentosPanel() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [showCalc, setShowCalc] = useState(false);
  const [drivers, setDrivers] = useState<PaymentDriverOption[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [userId, setUserId] = useState('');
  const [calcStart, setCalcStart] = useState('');
  const [calcEnd, setCalcEnd] = useState('');
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [result, setResult] = useState<PaymentCalculation | null>(null);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ReportsList | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [busyId, setBusyId] = useState('');

  const [payModal, setPayModal] = useState<PaymentReportRow | null>(null);
  const [payMethod, setPayMethod] = useState('');
  const [detail, setDetail] = useState<PaymentReportDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [massOpen, setMassOpen] = useState(false);
  const [syncPeriod, setSyncPeriod] = useState<{ start: string; end: string } | null>(null);
  const [attachModal, setAttachModal] = useState<PaymentReportRow | null>(null);
  const [attachments, setAttachments] = useState<PaymentAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const loadDefaultRange = useCallback(() => {
    const range = defaultPaymentWeekRange();
    setCalcStart(range.periodStart);
    setCalcEnd(range.periodEnd);
  }, []);

  const loadDrivers = useCallback(async () => {
    setLoadingDrivers(true);
    const res = await apiFetch<PaymentDriverOption[]>(
      API_PATHS.pagamentos.drivers,
      {},
      getStoredToken()
    );
    if (res.success && res.data) {
      setDrivers(res.data);
      setUserId((prev) => prev || res.data![0]?.id || '');
    }
    setLoadingDrivers(false);
  }, []);

  const loadMethods = useCallback(async () => {
    const res = await apiFetch<PaymentMethod[]>(
      API_PATHS.pagamentos.methods,
      {},
      getStoredToken()
    );
    if (res.success && res.data) setMethods(res.data);
  }, []);

  const loadReports = useCallback(async () => {
    setLoadingList(true);
    setError('');
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('perPage', String(applied.perPage));
    if (applied.periodStart) params.set('periodStart', applied.periodStart);
    if (applied.periodEnd) params.set('periodEnd', applied.periodEnd);
    if (applied.search.trim()) params.set('search', applied.search.trim());
    if (applied.isPaid) params.set('isPaid', applied.isPaid);
    if (applied.paymentMethod) params.set('paymentMethod', applied.paymentMethod);

    const res = await apiFetch<ReportsList>(
      `${API_PATHS.pagamentos.reports}?${params}`,
      {},
      getStoredToken()
    );
    setLoadingList(false);
    if (!res.success || !res.data) {
      setError(res.error ?? 'Não foi possível carregar pagamentos');
      return;
    }
    setList(res.data);
  }, [applied, page]);

  useEffect(() => {
    void loadDrivers();
    loadDefaultRange();
    void loadMethods();
  }, [loadDrivers, loadDefaultRange, loadMethods]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  function applyFilters() {
    setPage(1);
    setApplied({ ...filters });
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  async function handleCalculate() {
    if (!userId) {
      setError('Seleccione um motorista');
      return;
    }
    setCalculating(true);
    setError('');
    setSuccess('');
    setResult(null);
    const res = await apiFetch<PaymentCalculation>(
      API_PATHS.pagamentos.calculate,
      {
        method: 'POST',
        body: JSON.stringify({
          userId,
          periodStart: calcStart,
          periodEnd: calcEnd,
        }),
      },
      getStoredToken()
    );
    setCalculating(false);
    if (!res.success || !res.data) {
      setError(res.error ?? 'Cálculo falhou');
      return;
    }
    setResult(res.data);
  }

  async function handleConfirm() {
    if (!userId || !result) return;
    setConfirming(true);
    setError('');
    setSuccess('');
    const res = await apiFetch<{ reportId: string; calculation: PaymentCalculation }>(
      API_PATHS.pagamentos.confirm,
      {
        method: 'POST',
        body: JSON.stringify({
          userId,
          periodStart: calcStart,
          periodEnd: calcEnd,
        }),
      },
      getStoredToken()
    );
    setConfirming(false);
    if (!res.success || !res.data) {
      setError(res.error ?? 'Não foi possível gravar o pagamento');
      return;
    }
    setResult(res.data.calculation);
    setSuccess('Pagamento gravado. Movimentos incluídos marcados como pagos.');
    void loadReports();
  }

  async function markPending(row: PaymentReportRow) {
    const ok = await confirm({
      title: 'Marcar como pendente',
      message: `Marcar como pendente o pagamento de ${row.userLabel}?`,
      confirmLabel: 'Marcar pendente',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(row.id);
    const res = await apiFetch(
      API_PATHS.pagamentos.reportPaid(row.id),
      {
        method: 'PATCH',
        body: JSON.stringify({ isPaid: false }),
      },
      getStoredToken()
    );
    setBusyId('');
    if (!res.success) {
      setError(res.error ?? 'Não foi possível actualizar');
      return;
    }
    void loadReports();
  }

  async function confirmMarkPaid() {
    if (!payModal || !payMethod) return;
    setBusyId(payModal.id);
    const res = await apiFetch(
      API_PATHS.pagamentos.reportPaid(payModal.id),
      {
        method: 'PATCH',
        body: JSON.stringify({ isPaid: true, paymentMethod: payMethod }),
      },
      getStoredToken()
    );
    setBusyId('');
    if (!res.success) {
      setError(res.error ?? 'Não foi possível marcar como pago');
      return;
    }
    setPayModal(null);
    setPayMethod('');
    void loadReports();
  }

  async function openDetail(row: PaymentReportRow) {
    setLoadingDetail(true);
    setDetail(null);
    const res = await apiFetch<PaymentReportDetail>(
      API_PATHS.pagamentos.reportById(row.id),
      {},
      getStoredToken()
    );
    setLoadingDetail(false);
    if (!res.success || !res.data) {
      setError(res.error ?? 'Não foi possível abrir o detalhe');
      return;
    }
    setDetail(res.data);
  }

  async function removeReport(row: PaymentReportRow) {
    const ok = await confirm({
      title: 'Eliminar pagamento',
      message: `Eliminar o pagamento de ${row.userLabel} (${formatDatePt(row.periodStart)} – ${formatDatePt(row.periodEnd)})?\n\nOs movimentos associados voltam a ficar em aberto. Os comprovativos anexados também serão apagados.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(row.id);
    const res = await apiFetch(
      API_PATHS.pagamentos.reportById(row.id),
      { method: 'DELETE' },
      getStoredToken()
    );
    setBusyId('');
    if (!res.success) {
      setError(res.error ?? 'Não foi possível eliminar');
      return;
    }
    setSuccess('Pagamento eliminado');
    void loadReports();
  }

  async function sendReportEmail(row: PaymentReportRow) {
    if (!row.userEmail) {
      setError('O motorista não tem email configurado');
      return;
    }
    const ok = await confirm({
      title: row.lastSentAt ? 'Reenviar email' : 'Enviar email',
      message: `Enviar o relatório de pagamento a ${row.userLabel} (${row.userEmail})?\nPeríodo: ${formatDatePt(row.periodStart)} – ${formatDatePt(row.periodEnd)}${
        row.attachmentsCount > 0
          ? `\n\nOs ${row.attachmentsCount} comprovativo(s) serão anexados (se o tamanho total o permitir).`
          : ''
      }`,
      confirmLabel: 'Enviar',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;

    setBusyId(row.id);
    setError('');
    const res = await apiFetch<{
      lastSentAt: string;
      to: string;
      attachmentsIncluded: number;
      attachmentsSkipped: boolean;
    }>(API_PATHS.pagamentos.reportSendEmail(row.id), { method: 'POST' }, getStoredToken());
    setBusyId('');
    if (!res.success) {
      setError(res.error ?? 'Falha ao enviar email');
      return;
    }
    setSuccess(
      res.message ??
        `Email enviado para ${res.data?.to ?? row.userEmail}`
    );
    void loadReports();
  }

  async function openAttachments(row: PaymentReportRow) {
    setAttachModal(row);
    setAttachments([]);
    setLoadingAttachments(true);
    setError('');
    const res = await apiFetch<PaymentAttachment[]>(
      API_PATHS.pagamentos.reportAttachments(row.id),
      {},
      getStoredToken()
    );
    setLoadingAttachments(false);
    if (!res.success || !res.data) {
      setError(res.error ?? 'Não foi possível listar comprovativos');
      return;
    }
    setAttachments(res.data);
  }

  async function uploadAttachment(file: File) {
    if (!attachModal) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Cada ficheiro pode ter no máximo 10 MB');
      return;
    }
    setUploadingAttachment(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    const token = getStoredToken();
    const res = await fetch(
      `${getApiUrl()}${API_PATHS.pagamentos.reportAttachmentUpload(attachModal.id)}`,
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      }
    );
    const raw = await res.text();
    let parsed: { success?: boolean; data?: PaymentAttachment; error?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { success: false, error: raw.slice(0, 200) };
    }
    setUploadingAttachment(false);
    if (!res.ok || !parsed.success || !parsed.data) {
      setError(parsed.error ?? 'Falha ao carregar comprovativo');
      return;
    }
    setAttachments((prev) => [parsed.data!, ...prev]);
    setSuccess('Comprovativo carregado');
    void loadReports();
  }

  async function downloadAttachment(att: PaymentAttachment) {
    if (!attachModal) return;
    const token = getStoredToken();
    const res = await fetch(
      `${getApiUrl()}${API_PATHS.pagamentos.reportAttachmentDownload(attachModal.id, att.id)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (!res.ok) {
      setError('Não foi possível descarregar o ficheiro');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = att.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function removeAttachment(att: PaymentAttachment) {
    if (!attachModal) return;
    const ok = await confirm({
      title: 'Remover comprovativo',
      message: `Remover «${att.fileName}»?`,
      confirmLabel: 'Remover',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await apiFetch(
      API_PATHS.pagamentos.reportAttachmentById(attachModal.id, att.id),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (!res.success) {
      setError(res.error ?? 'Não foi possível remover');
      return;
    }
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    setSuccess('Comprovativo removido');
    void loadReports();
  }

  const resultadoNum = result ? Number(result.resultado) : 0;
  const zipEnabled = Boolean(filters.periodStart && filters.periodEnd);

  return (
    <div className="space-y-6">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Gestão de pagamentos dos motoristas</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            onClick={() => {
              const range =
                calcStart && calcEnd
                  ? { start: calcStart, end: calcEnd }
                  : (() => {
                      const d = defaultPaymentWeekRange();
                      return { start: d.periodStart, end: d.periodEnd };
                    })();
              setSyncPeriod(range);
              setSyncOpen(true);
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Sincronizar plataformas
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            onClick={() => setMassOpen(true)}
          >
            <Wallet className="h-4 w-4" />
            Pagamentos em massa
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => setShowCalc((v) => !v)}
          >
            <Calculator className="h-4 w-4" />
            {showCalc ? 'Ocultar calculadora' : 'Calcular pagamento'}
          </button>
        </div>
      </div>

      {showCalc ? (
        <div className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Calcular pagamento</h2>
            <p className="mt-1 text-sm text-slate-500">
              Semana típica: segunda → domingo. Receitas Uber/Bolt − Via Verde (abertos) −
              Eletricidade − Combustível − Comissão da viatura.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">Motorista</span>
              <select
                className="input w-full"
                value={userId}
                disabled={loadingDrivers}
                onChange={(e) => setUserId(e.target.value)}
              >
                {drivers.length === 0 ? (
                  <option value="">Sem motoristas com viatura</option>
                ) : (
                  drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                      {d.vehicleCount ? ` · ${d.vehicleCount} viatura(s)` : ''}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Início</span>
              <input
                type="date"
                className="input w-full"
                value={calcStart}
                onChange={(e) => setCalcStart(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Fim</span>
              <input
                type="date"
                className="input w-full"
                value={calcEnd}
                onChange={(e) => setCalcEnd(e.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              disabled={calculating || !userId || !calcStart || !calcEnd}
              onClick={() => void handleCalculate()}
            >
              {calculating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4" />
              )}
              Calcular
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={loadDefaultRange}
            >
              Semana anterior
            </button>
          </div>

          {result ? (
            <div className="grid gap-6 border-t border-slate-100 pt-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">
                  {result.userLabel}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {result.periodStart} → {result.periodEnd}
                  </span>
                </h3>
                <MoneyRow label="Uber" amount={result.receitas.uber} />
                <MoneyRow label="Bolt" amount={result.receitas.bolt} />
                <MoneyRow label="Total receitas" amount={result.receitas.total} strong />
                <MoneyRow label="Via Verde" amount={result.despesas.viaVerde} />
                <MoneyRow label="Eletricidade" amount={result.despesas.eletricidade} />
                <MoneyRow label="Combustível" amount={result.despesas.combustivel} />
                <MoneyRow label="Comissão viatura" amount={result.despesas.comissaoViatura} />
                {Number(result.despesas.iva6Uber) !== 0 || Number(result.despesas.iva6Bolt) !== 0 ? (
                  <>
                    <MoneyRow label="IVA 6% · Uber" amount={result.despesas.iva6Uber} />
                    <MoneyRow label="IVA 6% · Bolt" amount={result.despesas.iva6Bolt} />
                  </>
                ) : null}
                <MoneyRow label="Conta corrente" amount={result.despesas.contaCorrente} muted />
                <MoneyRow label="Total despesas" amount={result.despesas.total} strong />
                <div
                  className={`mt-2 rounded-lg px-4 py-3 ${
                    resultadoNum >= 0
                      ? 'bg-emerald-50 text-emerald-900'
                      : 'bg-amber-50 text-amber-900'
                  }`}
                >
                  <p className="text-xs font-medium uppercase tracking-wide opacity-70">
                    Pago ao motorista
                  </p>
                  <p className="text-2xl font-bold tabular-nums">
                    {formatMoney(result.resultado)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary mt-2 inline-flex items-center gap-2"
                  disabled={confirming}
                  onClick={() => void handleConfirm()}
                >
                  {confirming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Confirmar e gravar
                </button>
              </div>
              <div className="space-y-3 text-sm text-slate-600">
                {result.warnings.length ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    <p className="font-medium">Avisos</p>
                    <ul className="mt-1 list-inside list-disc">
                      {result.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-slate-400">Sem avisos neste cálculo.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      <div className="card space-y-4">
        <div className="grid gap-3 lg:grid-cols-6">
          <label className="block text-sm lg:col-span-2">
            <span className="mb-1 block text-slate-600">Período (sobreposição)</span>
            <div className="flex gap-2">
              <input
                type="date"
                className="input w-full"
                value={filters.periodStart}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, periodStart: e.target.value }))
                }
              />
              <input
                type="date"
                className="input w-full"
                value={filters.periodEnd}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, periodEnd: e.target.value }))
                }
              />
            </div>
          </label>
          <label className="block text-sm lg:col-span-2">
            <span className="mb-1 block text-slate-600">Motorista / email / ID</span>
            <input
              type="search"
              className="input w-full"
              placeholder="Pesquisar..."
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Estado</span>
            <select
              className="input w-full"
              value={filters.isPaid}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  isPaid: e.target.value as Filters['isPaid'],
                }))
              }
            >
              <option value="">Todos</option>
              <option value="true">Pago</option>
              <option value="false">Pendente</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Método</span>
            <select
              className="input w-full"
              value={filters.paymentMethod}
              onChange={(e) =>
                setFilters((f) => ({ ...f, paymentMethod: e.target.value }))
              }
            >
              <option value="">Todos</option>
              {methods.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Por página
            <select
              className="input"
              value={filters.perPage}
              onChange={(e) =>
                setFilters((f) => ({ ...f, perPage: Number(e.target.value) }))
              }
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary" onClick={applyFilters}>
            Filtrar
          </button>
          <button type="button" className="btn-secondary" onClick={clearFilters}>
            Limpar
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!zipEnabled}
            title={
              zipEnabled
                ? 'Exportação ZIP em breve'
                : 'Indique período (início e fim) para exportar anexos'
            }
          >
            Download anexos (ZIP)
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Motorista</th>
                <th className="px-3 py-3 font-medium">Período</th>
                <th className="px-3 py-3 font-medium">Receitas</th>
                <th className="px-3 py-3 font-medium">Despesas</th>
                <th className="px-3 py-3 font-medium">Conta Corrente</th>
                <th className="px-3 py-3 font-medium">Resultado</th>
                <th className="px-3 py-3 font-medium">Último envio</th>
                <th className="px-3 py-3 font-medium">Método</th>
                <th className="px-3 py-3 font-medium">Pago</th>
                <th className="px-3 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {list?.items.map((row) => {
                const resultado = Number(row.resultadoFinal);
                return (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-900">{row.userLabel}</p>
                      {row.userEmail ? (
                        <p className="text-xs text-slate-500">{row.userEmail}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {formatDatePt(row.periodStart)} até {formatDatePt(row.periodEnd)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        {formatMoney(row.receitasTotal)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 font-medium text-red-600">
                        <ArrowDownRight className="h-3.5 w-3.5" />
                        {formatMoney(row.despesasTotal)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {row.contaCorrenteLabel === 'zero' ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div className="space-y-1">
                          <p className="tabular-nums text-slate-800">
                            {formatMoney(row.despesasContaCorrente)}
                          </p>
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              row.contaCorrenteLabel === 'credito'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {row.contaCorrenteLabel === 'credito' ? 'Crédito' : 'Débito'}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`font-semibold tabular-nums ${
                          resultado >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {formatMoney(row.resultadoFinal)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {row.lastSentAt ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          {formatDateTime(row.lastSentAt)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.paymentMethod ? (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {row.paymentMethod}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.isPaid ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          <Check className="h-3 w-3" />
                          Pago
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          <Clock className="h-3 w-3" />
                          Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-white">
                        <button
                          type="button"
                          className="border-r border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                          title="Ver detalhe (como calculadora)"
                          disabled={busyId === row.id || loadingDetail}
                          onClick={() => void openDetail(row)}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {row.isPaid ? (
                          <button
                            type="button"
                            className="border-r border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                            title="Marcar pendente"
                            disabled={busyId === row.id}
                            onClick={() => void markPending(row)}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="border-r border-slate-200 p-2 text-emerald-700 hover:bg-emerald-50"
                            title="Marcar pago"
                            disabled={busyId === row.id}
                            onClick={() => {
                              setPayModal(row);
                              setPayMethod(methods[0]?.code ?? '');
                            }}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="border-r border-slate-200 p-2 text-sky-600 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            row.userEmail
                              ? row.lastSentAt
                                ? `Reenviar email (último: ${formatDateTime(row.lastSentAt)})`
                                : `Enviar email para ${row.userEmail}`
                              : 'Motorista sem email'
                          }
                          disabled={busyId === row.id || !row.userEmail}
                          onClick={() => void sendReportEmail(row)}
                        >
                          {busyId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Mail className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="relative border-r border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                          title="Comprovativos"
                          disabled={busyId === row.id}
                          onClick={() => void openAttachments(row)}
                        >
                          <Paperclip className="h-4 w-4" />
                          {row.attachmentsCount > 0 ? (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-bold text-white">
                              {row.attachmentsCount}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="p-2 text-red-600 hover:bg-red-50"
                          title="Eliminar"
                          disabled={busyId === row.id}
                          onClick={() => void removeReport(row)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loadingList && !list?.items.length ? (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-slate-400">
                    Sem pagamentos — use «Calcular pagamento» para gerar o primeiro relatório.
                  </td>
                </tr>
              ) : null}
              {loadingList ? (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-slate-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-500">
            Página {list?.page ?? page} de {list?.totalPages ?? 1}
            {list ? ` · ${list.total} registo(s)` : ''}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={page <= 1 || loadingList}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              «
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!list || page >= list.totalPages || loadingList}
              onClick={() => setPage((p) => p + 1)}
            >
              »
            </button>
          </div>
        </div>
      </div>

      {payModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Marcar como pago</h3>
            <p className="mt-1 text-sm text-slate-500">
              {payModal.userLabel} · {formatDatePt(payModal.periodStart)} até{' '}
              {formatDatePt(payModal.periodEnd)} · {formatMoney(payModal.resultadoFinal)}
            </p>
            <label className="mt-4 block text-sm">
              <span className="mb-1 block text-slate-600">Método de pagamento</span>
              <select
                className="input w-full"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
              >
                {methods.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setPayModal(null);
                  setPayMethod('');
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!payMethod || busyId === payModal.id}
                onClick={() => void confirmMarkPaid()}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        open={Boolean(detail) || loadingDetail}
        onClose={() => {
          if (loadingDetail) return;
          setDetail(null);
        }}
        title="Detalhe do pagamento"
        panelClassName="max-w-lg"
        showCloseButton={!loadingDetail}
        closeOnBackdrop={!loadingDetail}
        closeOnEscape={!loadingDetail}
        footer={
          <button type="button" className="btn-primary" onClick={() => setDetail(null)}>
            Fechar
          </button>
        }
      >
        {loadingDetail || !detail ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-900">
              {detail.userLabel}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {detail.periodStart} → {detail.periodEnd}
              </span>
            </h3>
            <MoneyRow label="Uber" amount={detail.receitasUber} />
            <MoneyRow label="Bolt" amount={detail.receitasBolt} />
            <MoneyRow label="Total receitas" amount={detail.receitasTotal} strong />
            <MoneyRow label="Via Verde" amount={detail.despesasViaVerde} />
            <MoneyRow label="Eletricidade" amount={detail.despesasEletricidade} />
            <MoneyRow label="Combustível" amount={detail.despesasCombustivel} />
            <MoneyRow label="Comissão viatura" amount={detail.despesasComissao} />
            <MoneyRow label="IVA 6% (receitas)" amount={detail.despesasIva6} />
            <MoneyRow label="Conta corrente" amount={detail.despesasContaCorrente} muted />
            <MoneyRow label="Total despesas" amount={detail.despesasTotal} strong />
            <div
              className={`mt-2 rounded-lg px-4 py-3 ${
                Number(detail.resultadoFinal) >= 0
                  ? 'bg-emerald-50 text-emerald-900'
                  : 'bg-amber-50 text-amber-900'
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide opacity-70">
                Pago ao motorista
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {formatMoney(detail.resultadoFinal)}
              </p>
            </div>
            {detail.warnings?.length ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">Avisos</p>
                <ul className="mt-1 list-inside list-disc">
                  {detail.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(attachModal)}
        onClose={() => {
          if (uploadingAttachment) return;
          setAttachModal(null);
          setAttachments([]);
        }}
        title="Comprovativos"
        panelClassName="max-w-lg"
        showCloseButton={!uploadingAttachment}
        closeOnBackdrop={!uploadingAttachment}
        closeOnEscape={!uploadingAttachment}
        footer={
          <button
            type="button"
            className="btn-primary"
            disabled={uploadingAttachment}
            onClick={() => {
              setAttachModal(null);
              setAttachments([]);
            }}
          >
            Fechar
          </button>
        }
      >
        {!attachModal ? null : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {attachModal.userLabel} · {formatDatePt(attachModal.periodStart)} –{' '}
              {formatDatePt(attachModal.periodEnd)}
            </p>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-600">
                Carregar ficheiro (PDF, JPG, PNG, WEBP · máx. 10 MB)
              </span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                disabled={uploadingAttachment || loadingAttachments}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadAttachment(file);
                  e.target.value = '';
                }}
              />
            </label>
            {uploadingAttachment || loadingAttachments ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : attachments.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">Sem comprovativos</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {attachments.map((att) => (
                  <li
                    key={att.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{att.fileName}</p>
                      <p className="text-xs text-slate-500">
                        {(Number(att.sizeBytes) / 1024).toFixed(1)} KB ·{' '}
                        {formatDateTime(att.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
                        onClick={() => void downloadAttachment(att)}
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        onClick={() => void removeAttachment(att)}
                      >
                        Remover
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      <SyncPagamentosModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        periodStart={syncPeriod?.start}
        periodEnd={syncPeriod?.end}
      />
      <MassPagamentosModal
        open={massOpen}
        onClose={() => setMassOpen(false)}
        drivers={drivers}
        onCompleted={() => void loadReports()}
        onRequestSync={(start, end) => {
          setMassOpen(false);
          setSyncPeriod({ start, end });
          setSyncOpen(true);
        }}
      />
    </div>
  );
}
