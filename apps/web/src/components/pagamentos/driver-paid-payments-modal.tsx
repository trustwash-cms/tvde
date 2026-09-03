'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Paperclip, Percent } from 'lucide-react';
import { API_PATHS, apiFetch, getApiUrl, getStoredToken } from '@/lib/api';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

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

function computeIva6Receitas(receitasTotal: number) {
  const ivaAmount = Math.round(receitasTotal * 0.06 * 100) / 100;
  const diferencaAmount = Math.round((receitasTotal - ivaAmount) * 100) / 100;
  return { ivaAmount, diferencaAmount };
}

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

type PaymentReportRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  receitasTotal: string;
  resultadoFinal: string;
  paymentMethod: string | null;
  attachmentsCount: number;
  isPaid: boolean;
  despesasComissao?: string;
  adminIvaReceitas6?: string | null;
  adminIvaReceitasSentAt?: string | null;
  adminIvaReceitasSentTo?: string | null;
};

type PaymentAttachment = {
  id: string;
  paymentReportId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  createdAt: string;
  fileAvailable?: boolean;
};

async function downloadAttachmentError(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = (await res.json()) as { error?: string };
    return json.error ?? 'Não foi possível descarregar o ficheiro';
  }
  return 'Não foi possível descarregar o ficheiro';
}

type ReportsList = {
  items: PaymentReportRow[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

export type DriverPaidPaymentsUser = {
  id: string;
  fullName?: string | null;
  username?: string | null;
  email: string;
};

export function DriverPaidPaymentsModal({
  open,
  user,
  onClose,
}: {
  open: boolean;
  user: DriverPaidPaymentsUser | null;
  onClose: () => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [appliedStart, setAppliedStart] = useState('');
  const [appliedEnd, setAppliedEnd] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ReportsList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [attachReport, setAttachReport] = useState<PaymentReportRow | null>(null);
  const [attachments, setAttachments] = useState<PaymentAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [ivaModal, setIvaModal] = useState<PaymentReportRow | null>(null);
  const [ivaEmail, setIvaEmail] = useState('');
  const [ivaSending, setIvaSending] = useState(false);
  const [ivaIncludeCarro, setIvaIncludeCarro] = useState(false);
  const [ivaCarroBase, setIvaCarroBase] = useState('');

  const userLabel = user?.fullName || user?.username || user?.email || '';

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('userId', user.id);
    params.set('isPaid', 'true');
    params.set('page', String(page));
    params.set('perPage', '10');
    if (appliedStart) params.set('periodStart', appliedStart);
    if (appliedEnd) params.set('periodEnd', appliedEnd);

    const res = await apiFetch<ReportsList>(
      `${API_PATHS.pagamentos.reports}?${params}`,
      {},
      getStoredToken()
    );
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? 'Não foi possível carregar pagamentos');
      return;
    }
    setList(res.data);
  }, [user, page, appliedStart, appliedEnd]);

  useEffect(() => {
    if (!open || !user) return;
    setPage(1);
    setAppliedStart('');
    setAppliedEnd('');
    setPeriodStart('');
    setPeriodEnd('');
    setList(null);
    setError('');
    setSuccess('');
    setIvaModal(null);
    setIvaEmail('');
    setIvaIncludeCarro(false);
    setIvaCarroBase('');
  }, [open, user?.id]);

  useEffect(() => {
    if (!open || !user) return;
    void load();
  }, [open, user, load]);

  function applyPeriod() {
    setPage(1);
    setAppliedStart(periodStart);
    setAppliedEnd(periodEnd);
  }

  function clearPeriod() {
    setPeriodStart('');
    setPeriodEnd('');
    setAppliedStart('');
    setAppliedEnd('');
    setPage(1);
  }

  const zipEnabled = Boolean(appliedStart && appliedEnd);

  function openIvaModal(row: PaymentReportRow) {
    setIvaModal(row);
    setIvaEmail(row.adminIvaReceitasSentTo ?? '');
    setIvaIncludeCarro(false);
    const comissao = Number(row.despesasComissao);
    setIvaCarroBase(Number.isFinite(comissao) && comissao > 0 ? comissao.toFixed(2) : '300');
    setError('');
    setSuccess('');
  }

  async function sendIva6Email() {
    if (!ivaModal || !user) return;
    const to = ivaEmail.trim();
    if (!isValidEmail(to)) {
      setError('Indique um endereço de email válido');
      return;
    }

    const receitas = Number(ivaModal.receitasTotal);
    const { ivaAmount } = computeIva6Receitas(receitas);
    const carroBaseNum = Number(String(ivaCarroBase).replace(',', '.'));
    if (ivaIncludeCarro && (!Number.isFinite(carroBaseNum) || carroBaseNum < 0)) {
      setError('Indique um valor do carro válido');
      return;
    }

    const carroLine = ivaIncludeCarro
      ? `\nCarro: ${formatMoney(carroBaseNum)} − IVA = ${formatMoney(Math.round((carroBaseNum - ivaAmount) * 100) / 100)}`
      : '';

    const ok = await confirm({
      title: 'Enviar IVA 6%',
      message: `Enviar o relatório de IVA (${formatMoney(ivaAmount)}) para ${to}?${carroLine}\n\nMotorista: ${userLabel}\nPeríodo: ${formatDatePt(ivaModal.periodStart)} – ${formatDatePt(ivaModal.periodEnd)}\n\nO motorista não recebe este email.`,
      confirmLabel: 'Enviar',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;

    setIvaSending(true);
    setError('');
    const res = await apiFetch<{
      sentAt: string;
      to: string;
      receitasTotal: string;
      ivaAmount: string;
      diferencaAmount: string;
    }>(
      API_PATHS.pagamentos.reportIva6Email(ivaModal.id),
      {
        method: 'POST',
        body: JSON.stringify({
          to,
          includeCarro: ivaIncludeCarro,
          ...(ivaIncludeCarro ? { carroBase: carroBaseNum } : {}),
        }),
      },
      getStoredToken()
    );
    setIvaSending(false);
    if (!res.success) {
      setError(res.error ?? 'Falha ao enviar email de IVA');
      return;
    }
    setSuccess(`IVA gravado e email enviado para ${res.data?.to ?? to}`);
    setIvaModal(null);
    setIvaEmail('');
    setIvaIncludeCarro(false);
    setIvaCarroBase('');
    void load();
  }

  async function downloadZip() {
    if (!user || !zipEnabled) return;
    setDownloading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('userId', user.id);
    params.set('isPaid', 'true');
    params.set('periodStart', appliedStart);
    params.set('periodEnd', appliedEnd);

    const token = getStoredToken();
    const res = await fetch(
      `${getApiUrl()}${API_PATHS.pagamentos.reportsAttachmentsZip}?${params}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );

    setDownloading(false);

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      if (contentType.includes('application/json')) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? 'Falha ao gerar ZIP');
      } else {
        setError('Falha ao gerar ZIP');
      }
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    a.href = url;
    a.download = match?.[1] ?? `pagamentos_${appliedStart}_${appliedEnd}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function openAttachments(row: PaymentReportRow) {
    setAttachReport(row);
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

  async function downloadAttachment(att: PaymentAttachment) {
    if (!attachReport) return;
    if (att.fileAvailable === false) {
      setError('Ficheiro em falta no servidor — peça para voltar a carregar o comprovativo');
      return;
    }
    const token = getStoredToken();
    const res = await fetch(
      `${getApiUrl()}${API_PATHS.pagamentos.reportAttachmentDownload(attachReport.id, att.id)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (!res.ok) {
      setError(await downloadAttachmentError(res));
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

  return (
    <>
    {confirmDialog}
    <Modal
      open={open}
      onClose={onClose}
      title="Pagamentos pagos"
      panelClassName="max-w-4xl"
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          Fechar
        </button>
      }
    >
      {!user ? null : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <span className="font-medium text-slate-900">{userLabel}</span>
            {user.email ? ` · ${user.email}` : ''}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Período início</span>
              <input
                type="date"
                className="input w-full"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Período fim</span>
              <input
                type="date"
                className="input w-full"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </label>
            <div className="flex items-end gap-2 sm:col-span-2">
              <button type="button" className="btn-primary" onClick={applyPeriod}>
                Filtrar
              </button>
              <button type="button" className="btn-secondary" onClick={clearPeriod}>
                Limpar
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!zipEnabled || downloading}
                title={
                  zipEnabled
                    ? 'Descarregar comprovativos do período (ZIP)'
                    : 'Indique período (início e fim) e filtre'
                }
                onClick={() => void downloadZip()}
              >
                {downloading ? (
                  <Loader2 className="inline h-4 w-4 animate-spin" />
                ) : (
                  'Download anexos (ZIP)'
                )}
              </button>
            </div>
          </div>

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

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Período</th>
                  <th className="px-3 py-2 font-medium">Receitas</th>
                  <th className="px-3 py-2 font-medium">IVA 6%</th>
                  <th className="px-3 py-2 font-medium">Resultado</th>
                  <th className="px-3 py-2 font-medium">Método</th>
                  <th className="px-3 py-2 font-medium">Anexos</th>
                  <th className="px-3 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : list?.items.length ? (
                  list.items.map((row) => {
                    const receitas = Number(row.receitasTotal);
                    const { ivaAmount } = computeIva6Receitas(receitas);
                    const shownIva =
                      row.adminIvaReceitas6 != null && row.adminIvaReceitas6 !== ''
                        ? Number(row.adminIvaReceitas6)
                        : ivaAmount;
                    return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-600">
                        {formatDatePt(row.periodStart)} – {formatDatePt(row.periodEnd)}
                      </td>
                      <td className="px-3 py-2 font-medium text-emerald-700">
                        {formatMoney(row.receitasTotal)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium tabular-nums text-violet-700">
                          {formatMoney(shownIva)}
                        </span>
                        {row.adminIvaReceitasSentAt ? (
                          <p className="mt-0.5 text-[11px] text-violet-500">
                            Enviado {formatDateTime(row.adminIvaReceitasSentAt)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {formatMoney(row.resultadoFinal)}
                      </td>
                      <td className="px-3 py-2">
                        {row.paymentMethod ? (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                            {row.paymentMethod}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.attachmentsCount > 0 ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sky-700 hover:bg-sky-50"
                            title="Ver comprovativos"
                            onClick={() => void openAttachments(row)}
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            {row.attachmentsCount}
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="relative inline-flex items-center justify-center rounded-md p-1.5 text-violet-600 hover:bg-violet-50"
                          title={
                            row.adminIvaReceitasSentAt
                              ? `IVA 6% — enviado ${formatDateTime(row.adminIvaReceitasSentAt)}`
                              : 'Ver / enviar IVA 6%'
                          }
                          onClick={() => openIvaModal(row)}
                        >
                          <Percent className="h-4 w-4" />
                          {row.adminIvaReceitas6 ? (
                            <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-violet-600 px-0.5 text-[9px] font-bold leading-none text-white">
                              ✓
                            </span>
                          ) : null}
                        </button>
                      </td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                      Sem pagamentos pagos
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Página {list?.page ?? page} de {list?.totalPages ?? 1}
              {list ? ` · ${list.total} registo(s)` : ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                «
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!list || page >= list.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                »
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            O filtro de período usa sobreposição: inclui pagamentos cujo intervalo cruza com as
            datas indicadas.
          </p>
        </div>
      )}
    </Modal>

    <Modal
      open={Boolean(attachReport)}
      onClose={() => {
        if (loadingAttachments) return;
        setAttachReport(null);
        setAttachments([]);
      }}
      title="Comprovativos"
      panelClassName="max-w-lg"
      showCloseButton={!loadingAttachments}
      closeOnBackdrop={!loadingAttachments}
      closeOnEscape={!loadingAttachments}
      footer={
        <button
          type="button"
          className="btn-primary"
          disabled={loadingAttachments}
          onClick={() => {
            setAttachReport(null);
            setAttachments([]);
          }}
        >
          Fechar
        </button>
      }
    >
      {!attachReport ? null : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {userLabel} · {formatDatePt(attachReport.periodStart)} –{' '}
            {formatDatePt(attachReport.periodEnd)}
          </p>
          {loadingAttachments ? (
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
                      {(Number(att.sizeBytes) / 1024).toFixed(1)} KB · {formatDateTime(att.createdAt)}
                      {att.fileAvailable === false ? (
                        <span className="ml-1 font-medium text-amber-700">· Em falta no servidor</span>
                      ) : null}
                    </p>
                  </div>
                  {att.fileAvailable === false ? (
                    <span className="shrink-0 rounded px-2 py-1 text-xs font-medium text-amber-700">
                      Indisponível
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="shrink-0 rounded px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
                      onClick={() => void downloadAttachment(att)}
                    >
                      Download
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>

    {ivaModal ? (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
          <h3 className="text-lg font-semibold text-slate-900">IVA 6% sobre receitas</h3>
          <p className="mt-1 text-sm text-slate-500">
            {userLabel}
            {user?.email ? ` · ${user.email}` : ''}
          </p>
          <p className="text-sm text-slate-500">
            {formatDatePt(ivaModal.periodStart)} até {formatDatePt(ivaModal.periodEnd)}
          </p>

          {(() => {
            const receitas = Number(ivaModal.receitasTotal);
            const { ivaAmount, diferencaAmount } = computeIva6Receitas(receitas);
            const carroBaseNum = Number(String(ivaCarroBase).replace(',', '.'));
            const carroAmount =
              ivaIncludeCarro && Number.isFinite(carroBaseNum)
                ? Math.round((carroBaseNum - ivaAmount) * 100) / 100
                : null;
            return (
              <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-600">Receitas (corridas)</span>
                  <span className="font-medium tabular-nums text-slate-900">
                    {formatMoney(receitas)}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-600">IVA 6%</span>
                  <span className="font-semibold tabular-nums text-red-600">
                    {formatMoney(ivaAmount)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
                  <span className="font-medium text-slate-700">Diferença (receitas − IVA)</span>
                  <span className="font-semibold tabular-nums text-emerald-700">
                    {formatMoney(diferencaAmount)}
                  </span>
                </div>

                <label className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-3 text-slate-700">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={ivaIncludeCarro}
                    disabled={ivaSending}
                    onChange={(e) => setIvaIncludeCarro(e.target.checked)}
                  />
                  <span className="font-medium">Incluir Carro no email</span>
                </label>

                {ivaIncludeCarro ? (
                  <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/80 p-3">
                    <label className="block text-xs text-slate-600">
                      Valor do carro
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input mt-1 w-full"
                        value={ivaCarroBase}
                        disabled={ivaSending}
                        onChange={(e) => setIvaCarroBase(e.target.value)}
                      />
                    </label>
                    <div className="flex justify-between gap-4">
                      <span className="font-medium text-violet-800">Semana do Carro</span>
                      <span className="font-semibold tabular-nums text-violet-800">
                        {carroAmount != null && Number.isFinite(carroAmount)
                          ? formatMoney(carroAmount)
                          : '—'}
                      </span>
                    </div>
                    <p className="text-[11px] text-violet-600">
                      {Number.isFinite(carroBaseNum)
                        ? `${formatMoney(carroBaseNum)} − ${formatMoney(ivaAmount)} · no email substitui a Diferença`
                        : 'Indique o valor do carro'}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })()}

          {ivaModal.adminIvaReceitasSentAt ? (
            <p className="mt-3 text-xs text-violet-700">
              Último envio: {formatDateTime(ivaModal.adminIvaReceitasSentAt)}
              {ivaModal.adminIvaReceitasSentTo ? ` → ${ivaModal.adminIvaReceitasSentTo}` : ''}
              {ivaModal.adminIvaReceitas6
                ? ` · IVA gravado: ${formatMoney(ivaModal.adminIvaReceitas6)}`
                : ''}
            </p>
          ) : null}

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-slate-600">Enviar por email para</span>
            <input
              type="email"
              className="input w-full"
              placeholder="contabilidade@empresa.pt"
              value={ivaEmail}
              disabled={ivaSending}
              onChange={(e) => setIvaEmail(e.target.value)}
            />
            {ivaEmail.trim() && !isValidEmail(ivaEmail) ? (
              <span className="mt-1 block text-xs text-red-600">
                Indique um endereço de email válido
              </span>
            ) : null}
          </label>

          <p className="mt-2 text-xs text-slate-500">
            O motorista não vê nem recebe este valor — uso interno / fiscal.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={ivaSending}
              onClick={() => {
                setIvaModal(null);
                setIvaEmail('');
                setIvaIncludeCarro(false);
                setIvaCarroBase('');
              }}
            >
              Fechar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                ivaSending ||
                !isValidEmail(ivaEmail) ||
                (ivaIncludeCarro &&
                  (!Number.isFinite(Number(String(ivaCarroBase).replace(',', '.'))) ||
                    Number(String(ivaCarroBase).replace(',', '.')) < 0))
              }
              onClick={() => void sendIva6Email()}
            >
              {ivaSending ? <Loader2 className="inline h-4 w-4 animate-spin" /> : 'Enviar email'}
            </button>
          </div>
        </div>
      </div>
    ) : null}
  </>
  );
}
