'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle, Eye, FileText, Plus, Trash2, Bell, BellOff, RotateCcw, Search, X, FileSpreadsheet, FileDown } from 'lucide-react';
import {
  ADMIN_MGMT_FATURA_METODOS_PAGAMENTO,
  ADMIN_MGMT_FATURA_TIPOS,
  ADMIN_MGMT_MAX_FATURA_ANEXOS,
  formatAdminMgmtMoney,
  formatExVatInput,
  formatVatPriceInput,
  getAdminMgmtFaturaMetodoPagamentoLabel,
  getAdminMgmtFaturaPagamentoLabel,
  getAdminMgmtFaturaTipoLabel,
  priceExVatToIncVat,
  priceIncVatToExVat,
  roundMoney,
  type AdminMgmtFaturaAnexo,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { AdminMgmtRecibosVerdesImport } from '@/components/admin-mgmt/admin-mgmt-recibos-verdes-import';
import {
  exportFaturasToExcel,
  exportFaturasToPdf,
  faturaMatchesSearch,
} from '@/lib/admin-mgmt-fatura-export';

interface ClienteOption {
  id: string;
  nome: string;
  nif: string | null;
}

interface FaturaRow {
  id: string;
  clienteId: string;
  clienteNome: string;
  clienteNif: string | null;
  tipoDocumento: string;
  numero: string;
  dataEmissao: string;
  dataVencimento: string | null;
  descricaoResumo: string | null;
  valorTotal: string;
  estadoPagamento: string;
  dataPagamento: string | null;
  metodoPagamento: string | null;
  anexos: AdminMgmtFaturaAnexo[];
  anexoCount: number;
  notificarCliente: boolean;
  notas: string | null;
}

function formatDatePt(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return d && m && y ? `${d}/${m}/${y}` : value;
}

async function downloadAnexo(faturaId: string, anexo: AdminMgmtFaturaAnexo, workspaceId: string) {
  const token = getStoredToken();
  const url = `${getApiUrl()}${withWorkspaceQuery(
    API_PATHS.adminMgmt.faturaAnexoById(faturaId, anexo.id),
    workspaceId
  )}`;
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Falha ao descarregar');
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = anexo.fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

const enumOptions = (values: readonly string[], labels: Record<string, string>) =>
  values.map((v) => ({ value: v, label: labels[v] ?? v }));

function parseTaxaIva(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function computeValorIvaAmount(liquido: string, total: string): string | null {
  const ex = Number(liquido);
  const inc = Number(total);
  if (!Number.isFinite(ex) || !Number.isFinite(inc)) return null;
  return formatVatPriceInput(roundMoney(inc - ex));
}

export function AdminMgmtFaturasPanel() {
  const searchParams = useSearchParams();
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<FaturaRow[]>([]);
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [filterEstado, setFilterEstado] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewFatura, setViewFatura] = useState<FaturaRow | null>(null);
  const [paidModal, setPaidModal] = useState<FaturaRow | null>(null);
  const [pendingModal, setPendingModal] = useState<FaturaRow | null>(null);
  const [bulkPaidOpen, setBulkPaidOpen] = useState(false);
  const [bulkPendingOpen, setBulkPendingOpen] = useState(false);
  const [pendingPin, setPendingPin] = useState('');
  const [anexosModal, setAnexosModal] = useState<FaturaRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyOk, setNotifyOk] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anexoInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const [form, setForm] = useState({
    clienteId: '',
    tipoDocumento: 'fatura',
    numero: '',
    atcud: '',
    dataEmissao: '',
    dataVencimento: '',
    descricaoResumo: '',
    valorLiquido: '',
    taxaIva: '23',
    valorTotal: '',
    notificarCliente: false,
    notas: '',
  });

  const [paidForm, setPaidForm] = useState({
    dataPagamento: new Date().toISOString().slice(0, 10),
    metodoPagamento: 'transferencia',
  });

  const tipoLabels = Object.fromEntries(
    ADMIN_MGMT_FATURA_TIPOS.map((t) => [t, getAdminMgmtFaturaTipoLabel(t)])
  );
  const metodoLabels = Object.fromEntries(
    ADMIN_MGMT_FATURA_METODOS_PAGAMENTO.map((m) => [m, getAdminMgmtFaturaMetodoPagamentoLabel(m)])
  );

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    const params: Record<string, string> = {};
    if (filterEstado !== 'all') params.estadoPagamento = filterEstado;
    Promise.all([
      apiFetch<FaturaRow[]>(withWorkspaceQuery(API_PATHS.adminMgmt.faturas, workspaceId, params), {}, getStoredToken()),
      apiFetch<ClienteOption[]>(withWorkspaceQuery(API_PATHS.adminMgmt.clientes, workspaceId), {}, getStoredToken()),
    ]).then(([faturasRes, clientesRes]) => {
      setLoading(false);
      if (faturasRes.data) setRows(faturasRes.data);
      else setError(getApiErrorMessage(faturasRes));
      if (clientesRes.data) setClientes(clientesRes.data);
    });
  }

  useEffect(load, [workspaceId, filterEstado]);

  useEffect(() => {
    const estado = searchParams.get('estado');
    if (estado === 'pendente' || estado === 'pago') setFilterEstado(estado);
  }, [searchParams]);

  const filteredRows = useMemo(
    () => rows.filter((row) => faturaMatchesSearch(row, searchQuery)),
    [rows, searchQuery]
  );

  useEffect(() => {
    setSelectedIds(new Set());
  }, [filterEstado, searchQuery]);

  const selectedRows = useMemo(
    () => filteredRows.filter((row) => selectedIds.has(row.id)),
    [filteredRows, selectedIds]
  );

  const exportRows = selectedRows.length > 0 ? selectedRows : filteredRows;

  function applySearch(value: string) {
    setSearchQuery(value.trim());
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    applySearch(searchInput);
  }

  function toggleRowSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const visibleIds = filteredRows.map((row) => row.id);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...Array.from(prev), ...visibleIds]));
    }
  }

  async function handleExport(format: 'excel' | 'pdf') {
    if (exportRows.length === 0) {
      setError('Nenhuma fatura para exportar');
      return;
    }
    setExporting(format);
    setError('');
    try {
      if (format === 'excel') exportFaturasToExcel(exportRows);
      else await exportFaturasToPdf(exportRows);
    } catch {
      setError('Falha ao exportar faturas');
    } finally {
      setExporting(null);
    }
  }

  const pageAllSelected =
    filteredRows.length > 0 && filteredRows.every((row) => selectedIds.has(row.id));
  const selectedCount = selectedRows.length;

  function handleValorLiquidoChange(value: string) {
    if (value === '') {
      setForm((f) => ({ ...f, valorLiquido: '', valorTotal: '' }));
      return;
    }
    const ex = Number(value);
    if (!Number.isFinite(ex)) return;
    const rate = parseTaxaIva(form.taxaIva);
    setForm((f) => ({
      ...f,
      valorLiquido: value,
      valorTotal: formatVatPriceInput(priceExVatToIncVat(ex, rate)),
    }));
  }

  function handleValorTotalChange(value: string) {
    if (value === '') {
      setForm((f) => ({ ...f, valorTotal: '', valorLiquido: '' }));
      return;
    }
    const inc = Number(value);
    if (!Number.isFinite(inc)) return;
    const rate = parseTaxaIva(form.taxaIva);
    setForm((f) => ({
      ...f,
      valorTotal: value,
      valorLiquido: formatExVatInput(priceIncVatToExVat(inc, rate)),
    }));
  }

  function handleTaxaIvaChange(value: string) {
    const rate = parseTaxaIva(value);
    if (form.valorTotal !== '') {
      const inc = Number(form.valorTotal);
      if (Number.isFinite(inc)) {
        setForm((f) => ({
          ...f,
          taxaIva: value,
          valorLiquido: formatExVatInput(priceIncVatToExVat(inc, rate)),
        }));
        return;
      }
    }
    if (form.valorLiquido !== '') {
      const ex = Number(form.valorLiquido);
      if (Number.isFinite(ex)) {
        setForm((f) => ({
          ...f,
          taxaIva: value,
          valorTotal: formatVatPriceInput(priceExVatToIncVat(ex, rate)),
        }));
        return;
      }
    }
    setForm((f) => ({ ...f, taxaIva: value }));
  }

  function resetForm() {
    setForm({
      clienteId: clientes[0]?.id ?? '',
      tipoDocumento: 'fatura',
      numero: '',
      atcud: '',
      dataEmissao: new Date().toISOString().slice(0, 10),
      dataVencimento: '',
      descricaoResumo: '',
      valorLiquido: '',
      taxaIva: '23',
      valorTotal: '',
      notificarCliente: false,
      notas: '',
    });
    setPendingFiles([]);
  }

  function openCreate() {
    resetForm();
    setModalOpen(true);
  }

  async function uploadAnexoFile(faturaId: string, file: File) {
    if (!workspaceId) return false;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspaceId', workspaceId);
    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.adminMgmt.faturaAnexoUpload(faturaId)}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const raw = await res.text();
    let parsed: { success?: boolean; error?: string } = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { success: false, error: raw.slice(0, 200) };
    }
    if (!res.ok || !parsed.success) {
      setError(parsed.error ?? 'Falha ao carregar anexo');
      return false;
    }
    return true;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    const valorIva = computeValorIvaAmount(form.valorLiquido, form.valorTotal);
    const res = await apiFetch<{ id: string }>(
      API_PATHS.adminMgmt.faturas,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          clienteId: form.clienteId,
          tipoDocumento: form.tipoDocumento,
          numero: form.numero,
          atcud: form.atcud.trim() || null,
          dataEmissao: form.dataEmissao,
          dataVencimento: form.dataVencimento || null,
          descricaoResumo: form.descricaoResumo.trim() || null,
          valorLiquido: form.valorLiquido.trim() || null,
          valorIva,
          valorTotal: form.valorTotal.trim(),
          notificarCliente: form.notificarCliente,
          notas: form.notas.trim() || null,
        }),
      },
      getStoredToken()
    );
    if (!res.success || !res.data?.id) {
      setSaving(false);
      setError(getApiErrorMessage(res));
      return;
    }
    for (const file of pendingFiles) {
      const ok = await uploadAnexoFile(res.data.id, file);
      if (!ok) {
        setSaving(false);
        load();
        return;
      }
    }
    setSaving(false);
    setModalOpen(false);
    load();
  }

  async function submitPaid(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || !paidModal) return;
    setSaving(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.faturaMarkPaid(paidModal.id),
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          dataPagamento: paidForm.dataPagamento,
          metodoPagamento: paidForm.metodoPagamento,
        }),
      },
      getStoredToken()
    );
    setSaving(false);
    if (res.success) {
      setPaidModal(null);
      setViewFatura(null);
      load();
    } else setError(getApiErrorMessage(res));
  }

  async function submitBulkPaid(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || selectedRows.length === 0) return;
    setSaving(true);
    setBulkBusy(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.faturasBulkMarkPaid,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          ids: selectedRows.map((r) => r.id),
          dataPagamento: paidForm.dataPagamento,
          metodoPagamento: paidForm.metodoPagamento,
        }),
      },
      getStoredToken()
    );
    setSaving(false);
    setBulkBusy(false);
    if (res.success) {
      setBulkPaidOpen(false);
      setSelectedIds(new Set());
      load();
    } else setError(getApiErrorMessage(res));
  }

  async function submitMarkPending(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || !pendingModal) return;
    const pin = pendingPin.trim();
    if (!pin) {
      setError('Introduza o PIN de Segurança');
      return;
    }
    setSaving(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.faturaMarkPending(pendingModal.id),
      { method: 'POST', body: JSON.stringify({ workspaceId, pin }) },
      getStoredToken()
    );
    setSaving(false);
    if (res.success) {
      setPendingModal(null);
      setPendingPin('');
      setViewFatura(null);
      load();
    } else setError(getApiErrorMessage(res));
  }

  async function submitBulkMarkPending(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || selectedRows.length === 0) return;
    const pin = pendingPin.trim();
    if (!pin) {
      setError('Introduza o PIN de Segurança');
      return;
    }
    setSaving(true);
    setBulkBusy(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.faturasBulkMarkPending,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          ids: selectedRows.map((r) => r.id),
          pin,
        }),
      },
      getStoredToken()
    );
    setSaving(false);
    setBulkBusy(false);
    if (res.success) {
      setBulkPendingOpen(false);
      setPendingPin('');
      setSelectedIds(new Set());
      load();
    } else setError(getApiErrorMessage(res));
  }

  function openMarkPending(fatura: FaturaRow) {
    setPendingPin('');
    setError('');
    setPendingModal(fatura);
  }

  function openBulkPaid() {
    setPaidForm({
      dataPagamento: new Date().toISOString().slice(0, 10),
      metodoPagamento: 'transferencia',
    });
    setError('');
    setBulkPaidOpen(true);
  }

  function openBulkPending() {
    setPendingPin('');
    setError('');
    setBulkPendingOpen(true);
  }

  async function removeBulk() {
    if (!workspaceId || selectedRows.length === 0) return;
    const ok = await confirm({
      title: 'Eliminar faturas',
      message: `Eliminar ${selectedRows.length} fatura(s) seleccionada(s)? Esta acção não pode ser anulada.`,
      confirmLabel: 'Eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    setBulkBusy(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.faturasBulkDelete,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          ids: selectedRows.map((r) => r.id),
        }),
      },
      getStoredToken()
    );
    setBulkBusy(false);
    if (res.success) {
      setSelectedIds(new Set());
      load();
    } else setError(getApiErrorMessage(res));
  }

  async function toggleNotificarCliente(fatura: FaturaRow) {
    if (!workspaceId) return;
    const next = !fatura.notificarCliente;
    if (next && !fatura.dataVencimento) {
      setError('Defina uma data de vencimento antes de activar a notificação ao cliente.');
      return;
    }
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.faturaById(fatura.id),
      {
        method: 'PUT',
        body: JSON.stringify({ workspaceId, notificarCliente: next }),
      },
      getStoredToken()
    );
    if (res.success) {
      load();
      if (viewFatura?.id === fatura.id) {
        setViewFatura({ ...fatura, notificarCliente: next });
      }
    } else setError(getApiErrorMessage(res));
  }

  async function notifyCliente(fatura: FaturaRow) {
    if (!workspaceId) return;
    if (!fatura.dataVencimento) {
      setError('Defina uma data de vencimento antes de notificar o cliente.');
      return;
    }
    setError('');
    setNotifyOk('');
    setNotifyBusy(true);
    const res = await apiFetch<{
      email?: { sent?: boolean; to?: string };
      whatsapp?: { sent?: boolean };
      downloadIncluded?: boolean;
    }>(
      API_PATHS.adminMgmt.faturaNotifyClient(fatura.id),
      {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      },
      getStoredToken()
    );
    setNotifyBusy(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    const parts: string[] = [];
    if (res.data?.email?.sent) parts.push(`email${res.data.email.to ? ` (${res.data.email.to})` : ''}`);
    if (res.data?.whatsapp?.sent) parts.push('WhatsApp');
    const via = parts.length ? ` via ${parts.join(' e ')}` : '';
    const pdfNote = res.data?.downloadIncluded
      ? ' Inclui botão para descarregar o PDF (mesmo link das faturas).'
      : '';
    setNotifyOk(`Lembrete enviado${via}.${pdfNote}`);
    load();
    if (viewFatura?.id === fatura.id) {
      setViewFatura({ ...fatura, notificarCliente: true });
    }
  }

  async function remove(id: string, numero: string) {
    if (!workspaceId) return;
    const ok = await confirm(`Eliminar fatura ${numero}?`);
    if (!ok) return;
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.adminMgmt.faturaById(id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.success) load();
    else setError(getApiErrorMessage(res));
  }

  async function handleAnexoUpload(files: FileList | null) {
    if (!files?.length || !anexosModal || !workspaceId) return;
    const faturaId = anexosModal.id;
    const remaining = ADMIN_MGMT_MAX_FATURA_ANEXOS - anexosModal.anexoCount;
    for (const file of Array.from(files).slice(0, remaining)) {
      const ok = await uploadAnexoFile(faturaId, file);
      if (!ok) break;
    }
    if (anexoInputRef.current) anexoInputRef.current.value = '';
    const res = await apiFetch<FaturaRow[]>(
      withWorkspaceQuery(API_PATHS.adminMgmt.faturas, workspaceId),
      {},
      getStoredToken()
    );
    if (res.data) {
      setRows(res.data);
      const updated = res.data.find((r) => r.id === faturaId);
      if (updated) setAnexosModal(updated);
    }
  }

  function estadoBadge(estado: string) {
    const cls =
      estado === 'pago'
        ? 'bg-green-100 text-green-800'
        : estado === 'pendente'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-700';
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
        {getAdminMgmtFaturaPagamentoLabel(estado)}
      </span>
    );
  }

  if (!workspaceId) return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Faturas</h2>
          <div className="flex flex-wrap items-center gap-2">
            <AdminMgmtRecibosVerdesImport
              workspaceId={workspaceId}
              onImported={() => load()}
              onError={setError}
            />
            <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" onClick={openCreate}>
              <Plus size={14} />
              Nova fatura
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'pendente', label: 'Pendentes' },
            { id: 'pago', label: 'Pagas' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${
                filterEstado === f.id ? 'bg-[var(--color-primary)] text-white' : 'bg-slate-100 text-slate-700'
              }`}
              onClick={() => setFilterEstado(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[min(100%,20rem)] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input w-full pl-9 pr-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Pesquisar faturas (cliente, NIF, n.º, datas, valores, estado…)"
            />
            {(searchInput || searchQuery) && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => {
                  setSearchInput('');
                  applySearch('');
                }}
                aria-label="Limpar pesquisa"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button type="submit" className="btn-secondary text-sm">Pesquisar</button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 text-sm"
            disabled={exporting !== null || exportRows.length === 0}
            onClick={() => void handleExport('excel')}
          >
            <FileSpreadsheet size={14} />
            {exporting === 'excel' ? 'A exportar…' : 'Excel'}
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 text-sm"
            disabled={exporting !== null || exportRows.length === 0}
            onClick={() => void handleExport('pdf')}
          >
            <FileDown size={14} />
            {exporting === 'pdf' ? 'A exportar…' : 'PDF'}
          </button>
        </form>
        {searchQuery && (
          <p className="text-xs text-slate-500">
            Filtro activo: <span className="font-medium">&quot;{searchQuery}&quot;</span>
            {' · '}
            {filteredRows.length} de {rows.length} fatura(s)
          </p>
        )}

        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-sm font-medium text-slate-700">
              {selectedCount} seleccionada(s)
            </p>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
              disabled={bulkBusy || saving}
              onClick={openBulkPaid}
            >
              <CheckCircle size={13} />
              Marcar como pago
            </button>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
              disabled={bulkBusy || saving}
              onClick={openBulkPending}
            >
              <RotateCcw size={13} />
              Marcar como pendente
            </button>
            <button
              type="button"
              className="btn-danger inline-flex items-center gap-1.5 text-xs"
              disabled={bulkBusy || saving}
              onClick={() => void removeBulk()}
            >
              <Trash2 size={13} />
              Apagar
            </button>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
              disabled={exporting !== null || bulkBusy}
              onClick={() => void handleExport('excel')}
            >
              <FileSpreadsheet size={13} />
              Exportar Excel
            </button>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
              disabled={exporting !== null || bulkBusy}
              onClick={() => void handleExport('pdf')}
            >
              <FileDown size={13} />
              Exportar PDF
            </button>
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-700"
              disabled={bulkBusy}
              onClick={() => setSelectedIds(new Set())}
            >
              Limpar selecção
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {clientes.length === 0 && !loading && (
          <p className="text-sm text-amber-700">Crie pelo menos um cliente antes de registar faturas.</p>
        )}
        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma fatura registada.</p>
        ) : filteredRows.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma fatura corresponde à pesquisa.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={pageAllSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Seleccionar todas as faturas visíveis"
                    />
                  </th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">N.º</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Emissão</th>
                  <th className="px-3 py-2">Vencimento</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2" title="Alerta de vencimento no painel interno">Alerta</th>
                  <th className="px-3 py-2">PDF</th>
                  <th className="px-3 py-2 text-right">Acções</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleRowSelection(row.id)}
                        aria-label={`Seleccionar fatura ${row.numero}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.clienteNome}</div>
                      {row.clienteNif && <div className="font-mono text-xs text-slate-400">{row.clienteNif}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.numero}</td>
                    <td className="px-3 py-2">{getAdminMgmtFaturaTipoLabel(row.tipoDocumento)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDatePt(row.dataEmissao)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDatePt(row.dataVencimento)}</td>
                    <td className="px-3 py-2 font-medium">{formatAdminMgmtMoney(row.valorTotal)}</td>
                    <td className="px-3 py-2">{estadoBadge(row.estadoPagamento)}</td>
                    <td className="px-3 py-2">
                      {row.estadoPagamento !== 'pago' && row.dataVencimento ? (
                        <button
                          type="button"
                          className={`rounded-lg p-1.5 ${
                            row.notificarCliente
                              ? 'text-[var(--color-primary)] hover:bg-violet-50'
                              : 'text-slate-400 hover:bg-slate-100'
                          }`}
                          title={
                            row.notificarCliente
                              ? 'Notificação ao cliente activa — clique para desactivar'
                              : 'Activar notificação ao cliente no vencimento'
                          }
                          onClick={() => void toggleNotificarCliente(row)}
                        >
                          {row.notificarCliente ? <Bell size={14} /> : <BellOff size={14} />}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"
                        onClick={() => setAnexosModal(row)}
                      >
                        <FileText size={14} />
                        {row.anexoCount}/{ADMIN_MGMT_MAX_FATURA_ANEXOS}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
                          title="Ver"
                          onClick={() => setViewFatura(row)}
                        >
                          <Eye size={14} />
                        </button>
                        {row.estadoPagamento !== 'pago' && (
                          <button
                            type="button"
                            className="rounded-lg p-1.5 text-green-600 hover:bg-green-50"
                            title="Marcar pago"
                            onClick={() => {
                              setPaidForm({
                                dataPagamento: new Date().toISOString().slice(0, 10),
                                metodoPagamento: 'transferencia',
                              });
                              setPaidModal(row);
                            }}
                          >
                            <CheckCircle size={14} />
                          </button>
                        )}
                        {row.estadoPagamento === 'pago' && (
                          <button
                            type="button"
                            className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50"
                            title="Marcar pendente"
                            onClick={() => openMarkPending(row)}
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                          title="Eliminar"
                          onClick={() => void remove(row.id, row.numero)}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nova fatura" panelClassName="max-w-xl" scrollBody>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-slate-600">Cliente *</label>
            <select
              className="input"
              value={form.clienteId}
              onChange={(e) => setForm({ ...form, clienteId: e.target.value })}
              required
            >
              <option value="">Seleccionar…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}{c.nif ? ` · ${c.nif}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Tipo *</label>
              <select
                className="input"
                value={form.tipoDocumento}
                onChange={(e) => setForm({ ...form, tipoDocumento: e.target.value })}
              >
                {enumOptions(ADMIN_MGMT_FATURA_TIPOS, tipoLabels).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">N.º documento *</label>
              <input className="input font-mono text-sm" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} required placeholder="FT M/44" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Descrição</label>
            <input className="input" value={form.descricaoResumo} onChange={(e) => setForm({ ...form, descricaoResumo: e.target.value })} placeholder="Avença Abril, Servidor VPS…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Data emissão *</label>
              <input className="input" type="date" value={form.dataEmissao} onChange={(e) => setForm({ ...form, dataEmissao: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Data vencimento</label>
              <input
                className="input"
                type="date"
                value={form.dataVencimento}
                onChange={(e) =>
                  setForm({
                    ...form,
                    dataVencimento: e.target.value,
                    notificarCliente: e.target.value ? form.notificarCliente : false,
                  })
                }
              />
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.notificarCliente}
              disabled={!form.dataVencimento}
              onChange={(e) => setForm({ ...form, notificarCliente: e.target.checked })}
            />
            <span>
              <span className="font-medium text-slate-800">Alerta de vencimento</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Cria o vencimento no painel de alertas. No detalhe da fatura, «Notificar cliente» envia o lembrete por email (e WhatsApp, se o cliente tiver contacto).
              </span>
            </span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Valor líquido</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.valorLiquido}
                onChange={(e) => handleValorLiquidoChange(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">IVA (%)</label>
              <input
                className="input"
                type="number"
                min={0}
                step="1"
                value={form.taxaIva}
                onChange={(e) => handleTaxaIvaChange(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Total *</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.valorTotal}
                onChange={(e) => handleValorTotalChange(e.target.value)}
                required
              />
            </div>
          </div>
          {form.valorLiquido && form.valorTotal && (
            <p className="text-xs text-slate-500">
              IVA: {computeValorIvaAmount(form.valorLiquido, form.valorTotal)} €
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm text-slate-600">ATCUD</label>
            <input className="input font-mono text-xs" value={form.atcud} onChange={(e) => setForm({ ...form, atcud: e.target.value })} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm text-slate-600">PDF (máx. {ADMIN_MGMT_MAX_FATURA_ANEXOS})</label>
              {pendingFiles.length < ADMIN_MGMT_MAX_FATURA_ANEXOS && (
                <button type="button" className="text-xs text-[var(--color-primary)] hover:underline" onClick={() => fileInputRef.current?.click()}>
                  Adicionar
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="application/pdf"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setPendingFiles((prev) => [...prev, ...files].slice(0, ADMIN_MGMT_MAX_FATURA_ANEXOS));
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            {pendingFiles.length > 0 && (
              <ul className="text-sm text-slate-600">{pendingFiles.map((f) => <li key={f.name}>{f.name}</li>)}</ul>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving || !form.clienteId}>{saving ? 'A guardar…' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(viewFatura)}
        onClose={() => {
          setViewFatura(null);
          setNotifyOk('');
        }}
        title="Detalhe da fatura"
        panelClassName="max-w-lg"
        scrollBody
      >
        {viewFatura && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Cliente</dt>
              <dd className="font-medium">{viewFatura.clienteNome}</dd>
              <dt className="text-slate-500">N.º</dt>
              <dd className="font-mono">{viewFatura.numero}</dd>
              <dt className="text-slate-500">Tipo</dt>
              <dd>{getAdminMgmtFaturaTipoLabel(viewFatura.tipoDocumento)}</dd>
              <dt className="text-slate-500">Emissão</dt>
              <dd>{formatDatePt(viewFatura.dataEmissao)}</dd>
              <dt className="text-slate-500">Vencimento</dt>
              <dd>{formatDatePt(viewFatura.dataVencimento)}</dd>
              <dt className="text-slate-500">Total</dt>
              <dd className="font-medium">{formatAdminMgmtMoney(viewFatura.valorTotal)}</dd>
              <dt className="text-slate-500">Estado</dt>
              <dd>{estadoBadge(viewFatura.estadoPagamento)}</dd>
              {viewFatura.dataPagamento && (
                <>
                  <dt className="text-slate-500">Pagamento</dt>
                  <dd>
                    {formatDatePt(viewFatura.dataPagamento)}
                    {viewFatura.metodoPagamento
                      ? ` · ${getAdminMgmtFaturaMetodoPagamentoLabel(viewFatura.metodoPagamento)}`
                      : ''}
                  </dd>
                </>
              )}
              {viewFatura.descricaoResumo && (
                <>
                  <dt className="text-slate-500">Descrição</dt>
                  <dd>{viewFatura.descricaoResumo}</dd>
                </>
              )}
              {viewFatura.estadoPagamento !== 'pago' && viewFatura.dataVencimento && (
                <>
                  <dt className="text-slate-500">Alerta cliente</dt>
                  <dd>
                    {viewFatura.notificarCliente ? (
                      <span className="inline-flex items-center gap-1 text-[var(--color-primary)]">
                        <Bell size={14} /> Activo no vencimento
                      </span>
                    ) : (
                      <span className="text-slate-500">Inactivo</span>
                    )}
                  </dd>
                </>
              )}
            </dl>
            {notifyOk && viewFatura.estadoPagamento !== 'pago' && (
              <p className="text-sm text-emerald-700">{notifyOk}</p>
            )}
            {error && viewFatura.estadoPagamento !== 'pago' && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {viewFatura.estadoPagamento !== 'pago' && viewFatura.dataVencimento && (
                <>
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                    disabled={notifyBusy}
                    onClick={() => void notifyCliente(viewFatura)}
                  >
                    <Bell size={14} />
                    {notifyBusy ? 'A enviar…' : 'Notificar cliente'}
                  </button>
                  {viewFatura.notificarCliente && (
                    <button
                      type="button"
                      className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                      onClick={() => void toggleNotificarCliente(viewFatura)}
                    >
                      <BellOff size={14} />
                      Desactivar alerta
                    </button>
                  )}
                </>
              )}
              {viewFatura.estadoPagamento !== 'pago' ? (
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={() => {
                    setPaidModal(viewFatura);
                    setPaidForm({
                      dataPagamento: new Date().toISOString().slice(0, 10),
                      metodoPagamento: 'transferencia',
                    });
                  }}
                >
                  Marcar como pago
                </button>
              ) : (
                <button type="button" className="btn-secondary text-sm" onClick={() => openMarkPending(viewFatura)}>
                  Marcar pendente
                </button>
              )}
              <button type="button" className="btn-secondary text-sm" onClick={() => setAnexosModal(viewFatura)}>
                Ver PDFs
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(paidModal)} onClose={() => setPaidModal(null)} title="Marcar como pago" panelClassName="max-w-sm">
        {paidModal && (
          <form onSubmit={(e) => void submitPaid(e)} className="space-y-3">
            <p className="text-sm text-slate-600">
              {paidModal.numero} · {formatAdminMgmtMoney(paidModal.valorTotal)}
            </p>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Data pagamento *</label>
              <input className="input" type="date" value={paidForm.dataPagamento} onChange={(e) => setPaidForm({ ...paidForm, dataPagamento: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Método *</label>
              <select className="input" value={paidForm.metodoPagamento} onChange={(e) => setPaidForm({ ...paidForm, metodoPagamento: e.target.value })}>
                {enumOptions(ADMIN_MGMT_FATURA_METODOS_PAGAMENTO, metodoLabels).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setPaidModal(null)}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'A guardar…' : 'Confirmar'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={bulkPaidOpen}
        onClose={() => setBulkPaidOpen(false)}
        title="Marcar como pago"
        panelClassName="max-w-sm"
      >
        <form onSubmit={(e) => void submitBulkPaid(e)} className="space-y-3">
          <p className="text-sm text-slate-600">
            Aplicar a {selectedCount} fatura(s) seleccionada(s).
          </p>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Data pagamento *</label>
            <input
              className="input"
              type="date"
              value={paidForm.dataPagamento}
              onChange={(e) => setPaidForm({ ...paidForm, dataPagamento: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Método *</label>
            <select
              className="input"
              value={paidForm.metodoPagamento}
              onChange={(e) => setPaidForm({ ...paidForm, metodoPagamento: e.target.value })}
            >
              {enumOptions(ADMIN_MGMT_FATURA_METODOS_PAGAMENTO, metodoLabels).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setBulkPaidOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'A guardar…' : 'Confirmar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(pendingModal)} onClose={() => { setPendingModal(null); setPendingPin(''); }} title="Marcar como pendente" panelClassName="max-w-sm">
        {pendingModal && (
          <form onSubmit={(e) => void submitMarkPending(e)} className="space-y-3">
            <p className="text-sm text-slate-600">
              {pendingModal.numero} · {formatAdminMgmtMoney(pendingModal.valorTotal)}
            </p>
            <p className="text-xs text-amber-700">
              Esta acção reverte o estado de pagamento. Introduza o PIN de Segurança definido em Configurações.
            </p>
            <div>
              <label className="mb-1 block text-sm text-slate-600">PIN de Segurança *</label>
              <input
                className="input font-mono tracking-widest"
                type="password"
                inputMode="numeric"
                pattern="\d{4,12}"
                autoComplete="off"
                value={pendingPin}
                onChange={(e) => setPendingPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                required
                placeholder="••••"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => { setPendingModal(null); setPendingPin(''); }}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={saving || pendingPin.length < 4}>{saving ? 'A guardar…' : 'Confirmar'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={bulkPendingOpen}
        onClose={() => { setBulkPendingOpen(false); setPendingPin(''); }}
        title="Marcar como pendente"
        panelClassName="max-w-sm"
      >
        <form onSubmit={(e) => void submitBulkMarkPending(e)} className="space-y-3">
          <p className="text-sm text-slate-600">
            Reverter pagamento de {selectedCount} fatura(s) seleccionada(s).
          </p>
          <p className="text-xs text-amber-700">
            Esta acção reverte o estado de pagamento. Introduza o PIN de Segurança definido em Configurações.
          </p>
          <div>
            <label className="mb-1 block text-sm text-slate-600">PIN de Segurança *</label>
            <input
              className="input font-mono tracking-widest"
              type="password"
              inputMode="numeric"
              pattern="\d{4,12}"
              autoComplete="off"
              value={pendingPin}
              onChange={(e) => setPendingPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
              required
              placeholder="••••"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setBulkPendingOpen(false); setPendingPin(''); }}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving || pendingPin.length < 4}>
              {saving ? 'A guardar…' : 'Confirmar'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(anexosModal)} onClose={() => setAnexosModal(null)} title="Documentos PDF" panelClassName="max-w-md">
        {anexosModal && workspaceId && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{anexosModal.numero} · {anexosModal.clienteNome}</p>
            <ul className="space-y-2 rounded-lg border border-slate-100 p-2">
              {anexosModal.anexos.length === 0 && <li className="text-xs text-slate-400">Nenhum PDF anexado</li>}
              {anexosModal.anexos.map((anexo) => (
                <li key={anexo.id}>
                  <button
                    type="button"
                    className="text-sm text-[var(--color-primary)] hover:underline"
                    onClick={() => void downloadAnexo(anexosModal.id, anexo, workspaceId).catch(() => setError('Falha ao descarregar'))}
                  >
                    {anexo.fileName}
                  </button>
                </li>
              ))}
            </ul>
            {anexosModal.anexoCount < ADMIN_MGMT_MAX_FATURA_ANEXOS && (
              <>
                <input ref={anexoInputRef} type="file" className="hidden" accept="application/pdf" multiple onChange={(e) => void handleAnexoUpload(e.target.files)} />
                <button type="button" className="btn-secondary w-full text-sm" onClick={() => anexoInputRef.current?.click()}>
                  Adicionar PDF
                </button>
              </>
            )}
          </div>
        )}
      </Modal>

      {confirmDialog}
    </>
  );
}
