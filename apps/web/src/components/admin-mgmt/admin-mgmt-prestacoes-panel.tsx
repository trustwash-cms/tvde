'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, FileText, Plus, Trash2, Wallet } from 'lucide-react';
import clsx from 'clsx';
import {
  ADMIN_MGMT_APOlice_MIME_TYPES,
  ADMIN_MGMT_PRESTACAO_STATUSES,
  formatAdminMgmtMoney,
  getAdminMgmtPrestacaoStatusLabel,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

const COMPROVATIVO_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
const MAX_COMPROVATIVO_BYTES = 10 * 1024 * 1024;

interface PagamentoRow {
  id: string;
  valor: string;
  dataPagamento: string;
  mesReferencia: string | null;
  notas: string | null;
  hasComprovativo?: boolean;
  comprovativoFileName?: string | null;
  comprovativoMimeType?: string | null;
}

interface PrestacaoRow {
  id: string;
  titulo: string;
  beneficiarioNome: string;
  beneficiarioNif: string | null;
  valorTotal: string;
  valorPrestacao: string;
  diaVencimento: number | null;
  dataInicio: string;
  dataFimPrevista: string | null;
  status: string;
  notas: string | null;
  totalPago: string;
  saldoEmDivida: string;
  percentualPago: number;
  prestacoesPagas: number;
  prestacoesRestantes: number | null;
  pagamentos: PagamentoRow[];
}

const EMPTY_FORM = {
  titulo: '',
  beneficiarioNome: '',
  beneficiarioNif: '',
  valorTotal: '',
  valorPrestacao: '',
  diaVencimento: '',
  dataInicio: new Date().toISOString().slice(0, 10),
  dataFimPrevista: '',
  status: 'ativo',
  notas: '',
};

function formatDatePt(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return d && m && y ? `${d}/${m}/${y}` : value;
}

function statusClass(status: string): string {
  switch (status) {
    case 'concluido':
      return 'bg-emerald-100 text-emerald-800';
    case 'cancelado':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-amber-100 text-amber-800';
  }
}

async function downloadComprovativo(
  prestacaoId: string,
  pagamento: PagamentoRow,
  workspaceId: string
) {
  const token = getStoredToken();
  const url = `${getApiUrl()}${withWorkspaceQuery(
    API_PATHS.adminMgmt.prestacaoPagamentoComprovativo(prestacaoId, pagamento.id),
    workspaceId
  )}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Não foi possível descarregar o comprovativo');
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = pagamento.comprovativoFileName ?? 'comprovativo';
  link.click();
  URL.revokeObjectURL(link.href);
}

export function AdminMgmtPrestacoesPanel() {
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<PrestacaoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<PrestacaoRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [paymentForm, setPaymentForm] = useState({
    valor: '',
    dataPagamento: new Date().toISOString().slice(0, 10),
    mesReferencia: '',
    notas: '',
  });
  const [comprovativoFile, setComprovativoFile] = useState<File | null>(null);
  const comprovativoInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return rows;
    return rows.filter((r) => r.status === filterStatus);
  }, [rows, filterStatus]);

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    apiFetch<PrestacaoRow[]>(
      withWorkspaceQuery(API_PATHS.adminMgmt.prestacoes, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      setLoading(false);
      if (res.data) setRows(res.data);
      else setError(getApiErrorMessage(res));
    });
  }

  useEffect(load, [workspaceId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    const res = await apiFetch<PrestacaoRow>(API_PATHS.adminMgmt.prestacoes, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, ...form }),
    }, getStoredToken());
    setSaving(false);
    if (res.success) {
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      load();
      return;
    }
    setError(getApiErrorMessage(res));
  }

  async function openDetail(row: PrestacaoRow) {
    if (!workspaceId) return;
    const res = await apiFetch<PrestacaoRow>(
      withWorkspaceQuery(API_PATHS.adminMgmt.prestacaoById(row.id), workspaceId),
      {},
      getStoredToken()
    );
    if (res.data) {
      setDetail(res.data);
      setPaymentForm({
        valor: res.data.valorPrestacao,
        dataPagamento: new Date().toISOString().slice(0, 10),
        mesReferencia: new Date().toISOString().slice(0, 7) + '-01',
        notas: '',
      });
      setComprovativoFile(null);
      if (comprovativoInputRef.current) comprovativoInputRef.current.value = '';
    }
  }

  async function registerPayment(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || !detail) return;

    if (comprovativoFile) {
      if (comprovativoFile.size > MAX_COMPROVATIVO_BYTES) {
        setError('O comprovativo pode ter no máximo 10 MB');
        return;
      }
      if (
        !ADMIN_MGMT_APOlice_MIME_TYPES.includes(
          comprovativoFile.type as (typeof ADMIN_MGMT_APOlice_MIME_TYPES)[number]
        )
      ) {
        setError('Tipo de ficheiro não permitido — use PDF ou imagem (PNG/JPEG/WebP)');
        return;
      }
    }

    setSaving(true);
    setError('');

    const formData = new FormData();
    formData.append('workspaceId', workspaceId);
    formData.append('valor', paymentForm.valor);
    formData.append('dataPagamento', paymentForm.dataPagamento);
    if (paymentForm.mesReferencia) formData.append('mesReferencia', paymentForm.mesReferencia);
    if (paymentForm.notas.trim()) formData.append('notas', paymentForm.notas.trim());
    if (comprovativoFile) formData.append('comprovativo', comprovativoFile);

    const token = getStoredToken();
    const res = await fetch(
      `${getApiUrl()}${API_PATHS.adminMgmt.prestacaoPagamentos(detail.id)}`,
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      }
    );
    const raw = await res.text();
    let parsed: { success?: boolean; data?: PrestacaoRow; error?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { success: false, error: raw.slice(0, 200) };
    }

    setSaving(false);

    if (res.ok && parsed.success && parsed.data) {
      setDetail(parsed.data);
      setComprovativoFile(null);
      if (comprovativoInputRef.current) comprovativoInputRef.current.value = '';
      load();
      return;
    }
    setError(parsed.error ?? 'Não foi possível registar o pagamento');
  }

  async function deletePrestacao(row: PrestacaoRow) {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Eliminar acordo',
      message: `Eliminar «${row.titulo}» e todos os pagamentos registados?`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.adminMgmt.prestacaoById(row.id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.success) {
      if (detail?.id === row.id) setDetail(null);
      load();
      return;
    }
    setError(getApiErrorMessage(res));
  }

  async function deletePayment(pagamento: PagamentoRow) {
    if (!workspaceId || !detail) return;
    const ok = await confirm({
      title: 'Eliminar pagamento',
      message: `Eliminar pagamento de ${formatAdminMgmtMoney(pagamento.valor)}?`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await apiFetch(
      withWorkspaceQuery(
        API_PATHS.adminMgmt.prestacaoPagamentoById(detail.id, pagamento.id),
        workspaceId
      ),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.success) {
      openDetail(detail);
      load();
      return;
    }
    setError(getApiErrorMessage(res));
  }

  return (
    <>
      {confirmDialog}
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Prestações</h2>
            <p className="mt-1 text-sm text-slate-500">
              Acordos de pagamento parcelado — registe o valor mensal e acompanhe o saldo em dívida.
            </p>
          </div>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Novo acordo
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['all', ...ADMIN_MGMT_PRESTACAO_STATUSES] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium transition',
                filterStatus === key
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
              onClick={() => setFilterStatus(key)}
            >
              {key === 'all' ? 'Todos' : getAdminMgmtPrestacaoStatusLabel(key)}
            </button>
          ))}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : filtered.length === 0 ? (
          <div className="card py-12 text-center text-sm text-slate-500">
            Nenhum acordo de prestações. Ex.: pagar 100€/mês até liquidar 1.000€.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((row) => (
              <article key={row.id} className="card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{row.titulo}</h3>
                      <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', statusClass(row.status))}>
                        {getAdminMgmtPrestacaoStatusLabel(row.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {row.beneficiarioNome}
                      {row.beneficiarioNif ? ` · NIF ${row.beneficiarioNif}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatAdminMgmtMoney(row.valorPrestacao)}/mês
                      {row.diaVencimento ? ` · vence dia ${row.diaVencimento}` : ''}
                      {' · '}desde {formatDatePt(row.dataInicio)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" className="btn-secondary text-xs" onClick={() => openDetail(row)}>
                      <Eye size={14} className="mr-1 inline" />
                      Detalhe
                    </button>
                    <button type="button" className="btn-secondary text-xs text-red-600" onClick={() => deletePrestacao(row)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-600">
                      Pago: {formatAdminMgmtMoney(row.totalPago)} / {formatAdminMgmtMoney(row.valorTotal)}
                    </span>
                    <span className="font-medium text-slate-900">
                      Falta: {formatAdminMgmtMoney(row.saldoEmDivida)}
                      {row.prestacoesRestantes != null ? ` (~${row.prestacoesRestantes} prestações)` : ''}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[var(--color-primary)] transition-all"
                      style={{ width: `${row.percentualPago}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.percentualPago}% · {row.prestacoesPagas} pagamento(s) registado(s)
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Novo acordo de prestações"
        panelClassName="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Título / descrição</label>
            <input className="input" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required placeholder="Ex.: Acordo indemnização" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Beneficiário</label>
              <input className="input" value={form.beneficiarioNome} onChange={(e) => setForm({ ...form, beneficiarioNome: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">NIF (opcional)</label>
              <input className="input" value={form.beneficiarioNif} onChange={(e) => setForm({ ...form, beneficiarioNif: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Valor total (€)</label>
              <input type="number" min="0.01" step="0.01" className="input" value={form.valorTotal} onChange={(e) => setForm({ ...form, valorTotal: e.target.value })} required placeholder="1000" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Prestação mensal (€)</label>
              <input type="number" min="0.01" step="0.01" className="input" value={form.valorPrestacao} onChange={(e) => setForm({ ...form, valorPrestacao: e.target.value })} required placeholder="100" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Data início</label>
              <input type="date" className="input" value={form.dataInicio} onChange={(e) => setForm({ ...form, dataInicio: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Dia vencimento (1–28)</label>
              <input type="number" min="1" max="28" className="input" value={form.diaVencimento} onChange={(e) => setForm({ ...form, diaVencimento: e.target.value })} placeholder="Opcional" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Notas</label>
            <textarea className="input min-h-[72px]" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'A guardar…' : 'Criar acordo'}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? detail.titulo : 'Detalhe'}
        panelClassName="max-w-2xl"
        scrollBody
      >
        {detail ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-900">{detail.beneficiarioNome}</p>
              <p className="mt-2 text-sm text-slate-600">
                Total: {formatAdminMgmtMoney(detail.valorTotal)} · Prestação: {formatAdminMgmtMoney(detail.valorPrestacao)}/mês
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                Saldo em dívida: {formatAdminMgmtMoney(detail.saldoEmDivida)}
              </p>
            </div>

            {detail.status !== 'cancelado' ? (
              <form onSubmit={registerPayment} className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                  <Wallet size={16} />
                  Registar pagamento
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Valor (€)</label>
                    <input type="number" min="0.01" step="0.01" className="input" value={paymentForm.valor} onChange={(e) => setPaymentForm({ ...paymentForm, valor: e.target.value })} required />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Data pagamento</label>
                    <input type="date" className="input" value={paymentForm.dataPagamento} onChange={(e) => setPaymentForm({ ...paymentForm, dataPagamento: e.target.value })} required />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Mês referência (opcional)</label>
                  <input type="date" className="input" value={paymentForm.mesReferencia} onChange={(e) => setPaymentForm({ ...paymentForm, mesReferencia: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Comprovativo (opcional)</label>
                  <input
                    ref={comprovativoInputRef}
                    type="file"
                    className="input py-2"
                    accept={COMPROVATIVO_ACCEPT}
                    onChange={(e) => setComprovativoFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="mt-1 text-xs text-slate-500">PDF ou imagem — máx. 10 MB</p>
                </div>
                <button type="submit" className="btn-primary text-sm" disabled={saving || detail.status === 'concluido'}>
                  {detail.status === 'concluido' ? 'Acordo concluído' : saving ? 'A registar…' : 'Registar pagamento'}
                </button>
              </form>
            ) : null}

            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-900">Histórico de pagamentos</h4>
              {detail.pagamentos.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum pagamento registado.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {detail.pagamentos.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium text-slate-900">{formatAdminMgmtMoney(p.valor)}</p>
                        <p className="text-xs text-slate-500">
                          {formatDatePt(p.dataPagamento)}
                          {p.mesReferencia ? ` · ref. ${formatDatePt(p.mesReferencia)}` : ''}
                        </p>
                        {p.hasComprovativo ? (
                          <button
                            type="button"
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline"
                            onClick={() =>
                              workspaceId &&
                              downloadComprovativo(detail.id, p, workspaceId).catch(() =>
                                setError('Não foi possível descarregar o comprovativo')
                              )
                            }
                          >
                            <FileText size={13} />
                            {p.comprovativoFileName ?? 'Comprovativo'}
                          </button>
                        ) : null}
                      </div>
                      <button type="button" className="text-red-500 hover:text-red-700" onClick={() => deletePayment(p)}>
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
