'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye, Plus, Trash2 } from 'lucide-react';
import {
  WEB_ROUTES,
  formatAdminMgmtMoney,
  getAdminMgmtFaturaMetodoPagamentoLabel,
  getAdminMgmtFaturaPagamentoLabel,
  getAdminMgmtFaturaTipoLabel,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface ClienteRow {
  id: string;
  nome: string;
  nif: string | null;
  email: string | null;
  telefone: string | null;
  morada: string | null;
  faturaCount: number;
  saldoEmAberto: string;
}

interface ContaCorrenteFatura {
  id: string;
  numero: string;
  tipoDocumento: string;
  dataEmissao: string;
  dataVencimento: string | null;
  descricaoResumo: string | null;
  valorTotal: string;
  estadoPagamento: string;
  dataPagamento: string | null;
  metodoPagamento: string | null;
  emAtraso: boolean;
}

interface ContaCorrenteLancamento {
  id: string;
  valor: string;
  valorAbatimento: string;
  valorFaturaLiquidada: string | null;
  faturaLiquidadaId: string | null;
  faturaNumero: string | null;
  descricao: string | null;
  dataLancamento: string;
}

interface LiquidacaoPreview {
  podeLiquidar: true;
  fatura: {
    id: string;
    numero: string;
    dataVencimento: string | null;
    valorTotal: string;
    emAtraso: boolean;
  };
  valorFatura: string;
  valorRemanescente: string;
  valorTotal: string;
}

interface ContaCorrenteData {
  id: string;
  nome: string;
  nif: string | null;
  email: string | null;
  telefone: string | null;
  morada: string | null;
  totalFaturasEmAberto: string;
  totalLancamentos: string;
  saldoEmAberto: string;
  totalPagoAno: string;
  faturasEmAtraso: number;
  faturas: ContaCorrenteFatura[];
  lancamentos: ContaCorrenteLancamento[];
}

interface LookupResult {
  module: Array<{ id: string; nome: string; nif: string | null }>;
  crm: Array<{ source: 'crm'; id: string; nome: string; nif: string | null }>;
  billing: Array<{ source: 'billing'; id: string; nome: string; nif: string | null }>;
}

type ContaFilter = 'all' | 'pendente' | 'atraso' | 'pago_mes';

function formatDatePt(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return d && m && y ? `${d}/${m}/${y}` : value;
}

function isPaidThisMonth(fatura: ContaCorrenteFatura): boolean {
  if (fatura.estadoPagamento !== 'pago' || !fatura.dataPagamento) return false;
  const now = new Date();
  const paid = new Date(fatura.dataPagamento);
  return paid.getFullYear() === now.getFullYear() && paid.getMonth() === now.getMonth();
}

function formatLancamentoDetalhe(l: ContaCorrenteLancamento): string {
  if (l.faturaNumero && l.valorFaturaLiquidada) {
    const partes = [`Liquidou ${l.faturaNumero} (${formatAdminMgmtMoney(l.valorFaturaLiquidada)})`];
    if (Number(l.valorAbatimento) > 0) {
      partes.push(`remanescente ${formatAdminMgmtMoney(l.valorAbatimento)}`);
    }
    return partes.join(' · ');
  }
  return `Abatimento na conta corrente`;
}

export function AdminMgmtClientesPanel() {
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<ClienteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [contaModal, setContaModal] = useState<ContaCorrenteData | null>(null);
  const [contaFilter, setContaFilter] = useState<ContaFilter>('all');
  const [contaLoading, setContaLoading] = useState(false);
  const [lancamentoOpen, setLancamentoOpen] = useState(false);
  const [lancamentoSaving, setLancamentoSaving] = useState(false);
  const [lancamentoForm, setLancamentoForm] = useState({
    valor: '',
    dataLancamento: new Date().toISOString().slice(0, 10),
    descricao: '',
  });
  const [liquidacaoPrompt, setLiquidacaoPrompt] = useState<LiquidacaoPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lookupQ, setLookupQ] = useState('');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [form, setForm] = useState({ nome: '', nif: '', email: '', telefone: '', morada: '' });

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    apiFetch<ClienteRow[]>(withWorkspaceQuery(API_PATHS.adminMgmt.clientes, workspaceId), {}, getStoredToken()).then(
      (res) => {
        setLoading(false);
        if (res.data) setRows(res.data);
        else setError(getApiErrorMessage(res));
      }
    );
  }

  useEffect(load, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || lookupQ.trim().length < 2) {
      setLookup(null);
      return;
    }
    const t = window.setTimeout(() => {
      apiFetch<LookupResult>(
        withWorkspaceQuery(API_PATHS.adminMgmt.clienteLookup, workspaceId, { q: lookupQ.trim() }),
        {},
        getStoredToken()
      ).then((res) => {
        if (res.data) setLookup(res.data);
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [lookupQ, workspaceId]);

  const filteredFaturas = useMemo(() => {
    if (!contaModal) return [];
    return contaModal.faturas.filter((f) => {
      if (contaFilter === 'pendente') {
        return f.estadoPagamento === 'pendente' || f.estadoPagamento === 'parcial';
      }
      if (contaFilter === 'atraso') return f.emAtraso;
      if (contaFilter === 'pago_mes') return isPaidThisMonth(f);
      return true;
    });
  }, [contaModal, contaFilter]);

  async function openContaCorrente(clienteId: string) {
    if (!workspaceId) return;
    setContaLoading(true);
    setContaFilter('all');
    setLancamentoOpen(false);
    setLiquidacaoPrompt(null);
    setError('');
    const res = await apiFetch<ContaCorrenteData>(
      withWorkspaceQuery(API_PATHS.adminMgmt.clienteById(clienteId), workspaceId),
      {},
      getStoredToken()
    );
    setContaLoading(false);
    if (res.data) setContaModal(res.data);
    else setError(getApiErrorMessage(res));
  }

  async function saveLancamento(liquidarFatura: boolean) {
    if (!workspaceId || !contaModal) return;
    setLancamentoSaving(true);
    setError('');
    const res = await apiFetch<ContaCorrenteData>(
      API_PATHS.adminMgmt.clienteLancamentos(contaModal.id),
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          valor: lancamentoForm.valor.trim(),
          dataLancamento: lancamentoForm.dataLancamento,
          descricao: lancamentoForm.descricao.trim() || null,
          liquidarFatura,
        }),
      },
      getStoredToken()
    );
    setLancamentoSaving(false);
    if (res.data) {
      setContaModal(res.data);
      setLancamentoOpen(false);
      setLiquidacaoPrompt(null);
      setLancamentoForm({
        valor: '',
        dataLancamento: new Date().toISOString().slice(0, 10),
        descricao: '',
      });
      load();
    } else setError(getApiErrorMessage(res));
  }

  async function submitLancamento(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || !contaModal) return;
    setLancamentoSaving(true);
    setError('');
    const previewRes = await apiFetch<LiquidacaoPreview | { podeLiquidar: false }>(
      API_PATHS.adminMgmt.clienteLancamentoPreview(contaModal.id),
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          valor: lancamentoForm.valor.trim(),
        }),
      },
      getStoredToken()
    );
    setLancamentoSaving(false);
    if (!previewRes.success) {
      setError(getApiErrorMessage(previewRes));
      return;
    }
    if (previewRes.data && 'podeLiquidar' in previewRes.data && previewRes.data.podeLiquidar) {
      setLiquidacaoPrompt(previewRes.data);
      return;
    }
    await saveLancamento(false);
  }

  async function removeLancamento(lancamento: ContaCorrenteLancamento) {
    if (!workspaceId || !contaModal) return;
    const msg = lancamento.faturaLiquidadaId
      ? 'Eliminar este lançamento? A fatura liquidada voltará ao estado pendente e o saldo será recalculado.'
      : 'Eliminar este lançamento? O saldo em aberto será recalculado.';
    const ok = await confirm(msg);
    if (!ok) return;
    const res = await apiFetch<ContaCorrenteData>(
      withWorkspaceQuery(
        API_PATHS.adminMgmt.clienteLancamentoById(contaModal.id, lancamento.id),
        workspaceId
      ),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.data) {
      setContaModal(res.data);
      load();
    } else setError(getApiErrorMessage(res));
  }

  function openCreate() {
    setForm({ nome: '', nif: '', email: '', telefone: '', morada: '' });
    setLookupQ('');
    setLookup(null);
    setModalOpen(true);
  }

  function applyLookup(item: { nome: string; nif: string | null; email?: string | null; telefone?: string | null }) {
    setForm((f) => ({
      ...f,
      nome: item.nome,
      nif: item.nif ?? '',
      email: item.email ?? f.email,
      telefone: item.telefone ?? f.telefone,
    }));
    setLookup(null);
    setLookupQ('');
  }

  async function importFromSource(source: 'crm' | 'billing', sourceId: string) {
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.clienteImport,
      {
        method: 'POST',
        body: JSON.stringify({ workspaceId, source, sourceId }),
      },
      getStoredToken()
    );
    setSaving(false);
    if (res.success) {
      setModalOpen(false);
      load();
    } else setError(getApiErrorMessage(res));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.clientes,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          nome: form.nome.trim(),
          nif: form.nif.trim() || null,
          email: form.email.trim() || null,
          telefone: form.telefone.trim() || null,
          morada: form.morada.trim() || null,
        }),
      },
      getStoredToken()
    );
    setSaving(false);
    if (res.success) {
      setModalOpen(false);
      load();
    } else setError(getApiErrorMessage(res));
  }

  async function remove(id: string, nome: string) {
    if (!workspaceId) return;
    const ok = await confirm(`Eliminar cliente ${nome}?`);
    if (!ok) return;
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.adminMgmt.clienteById(id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.success) {
      if (contaModal?.id === id) setContaModal(null);
      load();
    } else setError(getApiErrorMessage(res));
  }

  if (!workspaceId) return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Clientes</h2>
          <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" onClick={openCreate}>
            <Plus size={14} />
            Novo cliente
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum cliente registado.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">NIF</th>
                  <th className="px-3 py-2">Faturas</th>
                  <th className="px-3 py-2">Em aberto</th>
                  <th className="px-3 py-2 text-right">Acções</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-medium text-left hover:text-[var(--color-primary)] hover:underline"
                        onClick={() => void openContaCorrente(row.id)}
                      >
                        {row.nome}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.nif ?? '—'}</td>
                    <td className="px-3 py-2">{row.faturaCount}</td>
                    <td className="px-3 py-2">
                      {Number(row.saldoEmAberto) > 0 ? (
                        <span className="font-medium text-amber-700">
                          {formatAdminMgmtMoney(row.saldoEmAberto)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
                          title="Conta corrente"
                          onClick={() => void openContaCorrente(row.id)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                          title="Eliminar"
                          onClick={() => void remove(row.id, row.nome)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(contaModal)}
        onClose={() => setContaModal(null)}
        title="Conta corrente"
        panelClassName="max-w-2xl"
        scrollBody
      >
        {contaLoading && <p className="text-sm text-slate-500">A carregar…</p>}
        {contaModal && !contaLoading && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{contaModal.nome}</h3>
              {contaModal.nif && <p className="font-mono text-xs text-slate-500">{contaModal.nif}</p>}
            </div>

            <div className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Faturas em aberto</p>
                <p className="text-lg font-semibold text-slate-800">
                  {formatAdminMgmtMoney(contaModal.totalFaturasEmAberto) ?? '0,00€'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Abatimentos</p>
                <p className="text-lg font-semibold text-green-700">
                  {Number(contaModal.totalLancamentos) > 0
                    ? `−${formatAdminMgmtMoney(contaModal.totalLancamentos)}`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Saldo em aberto</p>
                <p className="text-lg font-semibold text-amber-700">
                  {formatAdminMgmtMoney(contaModal.saldoEmAberto) ?? '0,00€'}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <h4 className="text-sm font-semibold text-slate-900">Lançamentos manuais</h4>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  onClick={() => setLancamentoOpen((v) => !v)}
                >
                  <Plus size={12} />
                  Novo lançamento
                </button>
              </div>

              {liquidacaoPrompt && (
                <div className="space-y-3 border-b border-amber-100 bg-amber-50/80 p-3">
                  <p className="text-sm text-slate-800">
                    O valor de <strong>{formatAdminMgmtMoney(liquidacaoPrompt.valorTotal)}</strong> é suficiente
                    para liquidar a fatura{' '}
                    <strong className="font-mono">{liquidacaoPrompt.fatura.numero}</strong>
                    {liquidacaoPrompt.fatura.emAtraso ? ' (em atraso)' : ''} de{' '}
                    <strong>{formatAdminMgmtMoney(liquidacaoPrompt.valorFatura)}</strong>
                    {liquidacaoPrompt.fatura.dataVencimento
                      ? `, vencimento ${formatDatePt(liquidacaoPrompt.fatura.dataVencimento)}`
                      : ''}
                    .
                  </p>
                  <ul className="text-sm text-slate-700">
                    <li>• Liquidar fatura: {formatAdminMgmtMoney(liquidacaoPrompt.valorFatura)}</li>
                    <li>
                      • Remanescente na conta corrente:{' '}
                      {Number(liquidacaoPrompt.valorRemanescente) > 0
                        ? formatAdminMgmtMoney(liquidacaoPrompt.valorRemanescente)
                        : '0,00€'}
                    </li>
                  </ul>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => setLiquidacaoPrompt(null)}
                      disabled={lancamentoSaving}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => void saveLancamento(false)}
                      disabled={lancamentoSaving}
                    >
                      Só conta corrente
                    </button>
                    <button
                      type="button"
                      className="btn-primary text-xs"
                      onClick={() => void saveLancamento(true)}
                      disabled={lancamentoSaving}
                    >
                      {lancamentoSaving ? 'A guardar…' : 'Liquidar fatura'}
                    </button>
                  </div>
                </div>
              )}

              {lancamentoOpen && !liquidacaoPrompt && (
                <form onSubmit={(e) => void submitLancamento(e)} className="space-y-3 border-b border-slate-100 bg-slate-50/60 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">Valor *</label>
                      <input
                        className="input"
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={lancamentoForm.valor}
                        onChange={(e) => setLancamentoForm({ ...lancamentoForm, valor: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">Data</label>
                      <input
                        className="input"
                        type="date"
                        value={lancamentoForm.dataLancamento}
                        onChange={(e) => setLancamentoForm({ ...lancamentoForm, dataLancamento: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-600">Descrição</label>
                    <input
                      className="input"
                      placeholder="Ex.: Transferência bancária, pagamento parcial…"
                      value={lancamentoForm.descricao}
                      onChange={(e) => setLancamentoForm({ ...lancamentoForm, descricao: e.target.value })}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary text-xs" onClick={() => setLancamentoOpen(false)}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn-primary text-xs" disabled={lancamentoSaving}>
                      {lancamentoSaving ? 'A guardar…' : 'Registar abatimento'}
                    </button>
                  </div>
                </form>
              )}

              {contaModal.lancamentos.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">Nenhum lançamento manual.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {contaModal.lancamentos.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {formatAdminMgmtMoney(l.valor)}
                        </p>
                        <p className="text-xs text-green-700">{formatLancamentoDetalhe(l)}</p>
                        <p className="text-xs text-slate-500">
                          {formatDatePt(l.dataLancamento)}
                          {l.descricao ? ` · ${l.descricao}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                        title="Eliminar lançamento"
                        onClick={() => void removeLancamento(l)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-900">Faturas</h4>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all' as const, label: 'Todas' },
                { id: 'pendente' as const, label: 'Por pagar' },
                { id: 'atraso' as const, label: 'Em atraso' },
                { id: 'pago_mes' as const, label: 'Pagas este mês' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    contaFilter === f.id ? 'bg-[var(--color-primary)] text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                  onClick={() => setContaFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredFaturas.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum documento neste filtro.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                      <th className="px-3 py-2">N.º</th>
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFaturas.map((f) => (
                      <tr key={f.id} className="border-b border-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs">{f.numero}</div>
                          <div className="text-xs text-slate-400">{getAdminMgmtFaturaTipoLabel(f.tipoDocumento)}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={f.emAtraso ? 'font-medium text-red-700' : ''}>
                            {formatDatePt(f.dataVencimento)}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium">{formatAdminMgmtMoney(f.valorTotal)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              f.estadoPagamento === 'pago'
                                ? 'bg-green-100 text-green-800'
                                : f.emAtraso
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {getAdminMgmtFaturaPagamentoLabel(f.estadoPagamento)}
                          </span>
                          {f.estadoPagamento === 'pago' && f.dataPagamento && (
                            <div className="mt-0.5 text-xs text-slate-400">
                              {formatDatePt(f.dataPagamento)}
                              {f.metodoPagamento
                                ? ` · ${getAdminMgmtFaturaMetodoPagamentoLabel(f.metodoPagamento)}`
                                : ''}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <Link href={WEB_ROUTES.dashboard.adminMgmt.faturas} className="btn-secondary text-sm">
                Ir para faturas
              </Link>
              <button type="button" className="btn-primary text-sm" onClick={() => setContaModal(null)}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Novo cliente" panelClassName="max-w-lg" scrollBody>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-slate-600">Pesquisar existente (NIF ou nome)</label>
            <input
              className="input"
              value={lookupQ}
              onChange={(e) => setLookupQ(e.target.value)}
              placeholder="Ex.: 510100678 ou Timeless"
            />
            {lookup && (lookup.module.length > 0 || lookup.crm.length > 0 || lookup.billing.length > 0) && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-2 text-sm">
                {lookup.module.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full text-left hover:text-[var(--color-primary)]"
                      onClick={() => applyLookup(item)}
                    >
                      {item.nome} {item.nif ? `· ${item.nif}` : ''} <span className="text-xs text-slate-400">(módulo)</span>
                    </button>
                  </li>
                ))}
                {lookup.crm.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span>
                      {item.nome} {item.nif ? `· ${item.nif}` : ''}{' '}
                      <span className="text-xs text-slate-400">(CRM)</span>
                    </span>
                    <button
                      type="button"
                      className="text-xs text-[var(--color-primary)] hover:underline"
                      onClick={() => void importFromSource('crm', item.id)}
                    >
                      Importar
                    </button>
                  </li>
                ))}
                {lookup.billing.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <span>
                      {item.nome} {item.nif ? `· ${item.nif}` : ''}{' '}
                      <span className="text-xs text-slate-400">(Billing)</span>
                    </span>
                    <button
                      type="button"
                      className="text-xs text-[var(--color-primary)] hover:underline"
                      onClick={() => void importFromSource('billing', item.id)}
                    >
                      Importar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-600">Nome *</label>
            <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">NIF</label>
            <input className="input font-mono" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Telefone</label>
              <input className="input" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Morada</label>
            <textarea className="input min-h-[60px]" value={form.morada} onChange={(e) => setForm({ ...form, morada: e.target.value })} />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'A guardar…' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>

      {confirmDialog}
    </>
  );
}
