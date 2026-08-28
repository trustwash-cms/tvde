'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { API_PATHS } from '@tvde/shared';
import { Modal } from '@/components/modal';
import {
  apiFetch,
  getApiErrorMessage,
  getApiUrl,
  getStoredToken,
  refreshStoredAccessToken,
} from '@/lib/api';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import clsx from 'clsx';
import { Download, Pencil, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react';

type EntryType = 'credit' | 'debit';
type EntryStatus = 'open' | 'settled' | 'cancelled';

interface DriverOption {
  id: string;
  label: string;
  email: string | null;
}

interface Entry {
  id: string;
  driverUserId: string;
  driverLabel: string;
  description: string;
  amount: string;
  remainingBalance: string;
  type: EntryType;
  category: string | null;
  reference: string | null;
  status: EntryStatus;
  installmentEnabled: boolean;
  totalInstallments: number | null;
  installmentAmount: string | null;
  installmentsPaid: number;
  hasAttachment: boolean;
  attachmentFileName: string | null;
  paymentReportId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Summary {
  openBalance: string;
  openCount: number;
  accumulatedBalance: string;
  lastUpdate: { driverLabel: string; at: string } | null;
}

interface ListData {
  entries: Entry[];
  summary: Summary;
}

function formatMoney(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n);
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-PT', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<EntryStatus, string> = {
  open: 'Em aberto',
  settled: 'Liquidado',
  cancelled: 'Cancelado',
};

function installmentProgressLabel(entry: {
  status: EntryStatus;
  installmentEnabled: boolean;
  totalInstallments: number | null;
  installmentsPaid: number;
}): string | null {
  if (!entry.installmentEnabled || !entry.totalInstallments) return null;
  const total = entry.totalInstallments;
  const paid = entry.installmentsPaid;
  if (entry.status === 'settled' || paid >= total) {
    return `Parcelas ${total}/${total} liquidadas`;
  }
  return `Parcela ${paid + 1} de ${total}`;
}

export function ContaCorrentePanel({ initialDriverId }: { initialDriverId?: string }) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [driverId, setDriverId] = useState(initialDriverId ?? '');
  const [status, setStatus] = useState<'all' | EntryStatus>('open');
  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [saving, setSaving] = useState(false);
  const [removeAttachment, setRemoveAttachment] = useState(false);

  const [form, setForm] = useState({
    createDriverId: '',
    description: '',
    amount: '',
    type: 'credit' as EntryType,
    category: '',
    reference: '',
    installmentEnabled: false,
    totalInstallments: '2',
    installmentAmount: '',
  });
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (initialDriverId) setDriverId(initialDriverId);
  }, [initialDriverId]);

  useEffect(() => {
    apiFetch<DriverOption[]>(API_PATHS.contaCorrente.drivers, {}, getStoredToken()).then((res) => {
      if (res.data) setDrivers(res.data);
    });
  }, []);

  function load() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (driverId) params.set('driverUserId', driverId);
    if (status !== 'all') params.set('status', status);
    apiFetch<ListData>(`${API_PATHS.contaCorrente.list}?${params}`, {}, getStoredToken()).then(
      (res) => {
        setLoading(false);
        if (res.data) setData(res.data);
        else setError(getApiErrorMessage(res));
      }
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, status]);

  const installmentPreview = useMemo(() => {
    const amount = Number(form.amount.replace(',', '.'));
    const n = Number(form.totalInstallments);
    if (!(amount > 0) || !Number.isInteger(n) || n < 2) return '';
    if (form.installmentAmount.trim()) return form.installmentAmount;
    return (Math.round((amount / n) * 100) / 100).toFixed(2);
  }, [form.amount, form.totalInstallments, form.installmentAmount]);

  function resetForm() {
    setForm({
      createDriverId: driverId,
      description: '',
      amount: '',
      type: 'credit',
      category: '',
      reference: '',
      installmentEnabled: false,
      totalInstallments: '2',
      installmentAmount: '',
    });
    setFile(null);
    setRemoveAttachment(false);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingEntry(null);
    resetForm();
  }

  function openCreateModal() {
    setEditingEntry(null);
    resetForm();
    setError('');
    setModalOpen(true);
  }

  function openEditModal(entry: Entry) {
    setEditingEntry(entry);
    setForm({
      createDriverId: entry.driverUserId,
      description: entry.description,
      amount: entry.amount,
      type: entry.type,
      category: entry.category ?? '',
      reference: entry.reference ?? '',
      installmentEnabled: entry.installmentEnabled,
      totalInstallments: String(entry.totalInstallments ?? 2),
      installmentAmount: entry.installmentAmount ?? '',
    });
    setFile(null);
    setRemoveAttachment(false);
    setError('');
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (editingEntry) {
      await handleUpdate(editingEntry);
      return;
    }
    await handleCreate();
  }

  async function handleCreate() {
    const targetDriverId = driverId || form.createDriverId;
    if (!targetDriverId) {
      setError('Seleccione o motorista');
      return;
    }

    const description = form.description.trim();
    if (!description) {
      setError('Descrição é obrigatória');
      return;
    }

    const amount = Number(form.amount.replace(',', '.'));
    if (!(amount > 0)) {
      setError('Valor deve ser maior que zero');
      return;
    }

    const installmentOn = form.type === 'debit' && form.installmentEnabled;
    let totalInstallments: number | undefined;
    let installmentAmount: number | undefined;
    if (installmentOn) {
      totalInstallments = Number(form.totalInstallments);
      if (!Number.isInteger(totalInstallments) || totalInstallments < 2) {
        setError('Número de parcelas inválido (mínimo 2)');
        return;
      }
      const sliceRaw = (form.installmentAmount.trim() || installmentPreview).replace(',', '.');
      installmentAmount = Number(sliceRaw);
      if (!(installmentAmount > 0)) {
        setError('Valor por parcela inválido');
        return;
      }
    }

    setSaving(true);
    setError('');

    try {
      // Sem ficheiro: JSON (evita hang/multipart). Com ficheiro: FormData.
      if (!file) {
        const body: Record<string, unknown> = {
          driverUserId: targetDriverId,
          description,
          amount,
          type: form.type,
        };
        if (form.category.trim()) body.category = form.category.trim();
        if (form.reference.trim()) body.reference = form.reference.trim();
        if (installmentOn) {
          body.installmentEnabled = true;
          body.totalInstallments = totalInstallments;
          body.installmentAmount = installmentAmount;
        }

        const res = await apiFetch(API_PATHS.contaCorrente.list, {
          method: 'POST',
          body: JSON.stringify(body),
        }, getStoredToken());

        if (!res.success) {
          setError(getApiErrorMessage(res) || 'Não foi possível guardar o lançamento');
          return;
        }
      } else {
        let token = getStoredToken();
        const formData = new FormData();
        formData.append('driverUserId', targetDriverId);
        formData.append('description', description);
        formData.append('amount', String(amount));
        formData.append('type', form.type);
        if (form.category.trim()) formData.append('category', form.category.trim());
        if (form.reference.trim()) formData.append('reference', form.reference.trim());
        if (installmentOn && totalInstallments != null && installmentAmount != null) {
          formData.append('installmentEnabled', 'true');
          formData.append('totalInstallments', String(totalInstallments));
          formData.append('installmentAmount', String(installmentAmount));
        }
        formData.append('attachment', file);

        const postMultipart = async (accessToken: string | null) =>
          fetch(`${getApiUrl()}${API_PATHS.contaCorrente.list}`, {
            method: 'POST',
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: formData,
          });

        let res = await postMultipart(token);
        if (res.status === 401) {
          const refreshed = await refreshStoredAccessToken();
          if (refreshed) {
            token = refreshed;
            res = await postMultipart(token);
          }
        }

        const raw = await res.text();
        let parsed: { success?: boolean; error?: string; message?: string } = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = { success: false, error: raw.slice(0, 200) || `HTTP ${res.status}` };
        }
        if (!res.ok || !parsed.success) {
          setError(
            parsed.error || parsed.message || 'Não foi possível guardar o lançamento'
          );
          return;
        }
      }

      setModalOpen(false);
      resetForm();
      load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Não foi possível guardar o lançamento'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(entry: Entry) {
    const description = form.description.trim();
    if (!description) {
      setError('Descrição é obrigatória');
      return;
    }

    const financialLocked = entry.installmentsPaid > 0;
    let amount: number | undefined;
    let totalInstallments: number | undefined;
    let installmentAmount: number | undefined;
    const installmentOn = form.type === 'debit' && form.installmentEnabled;

    if (!financialLocked) {
      amount = Number(form.amount.replace(',', '.'));
      if (!(amount > 0)) {
        setError('Valor deve ser maior que zero');
        return;
      }
      if (installmentOn) {
        totalInstallments = Number(form.totalInstallments);
        if (!Number.isInteger(totalInstallments) || totalInstallments < 2) {
          setError('Número de parcelas inválido (mínimo 2)');
          return;
        }
        const sliceRaw = (form.installmentAmount.trim() || installmentPreview).replace(',', '.');
        installmentAmount = Number(sliceRaw);
        if (!(installmentAmount > 0)) {
          setError('Valor por parcela inválido');
          return;
        }
      }
    }

    setSaving(true);
    setError('');

    try {
      const url = `${getApiUrl()}${API_PATHS.contaCorrente.byId(entry.id)}`;

      if (file) {
        let token = getStoredToken();
        const formData = new FormData();
        formData.append('description', description);
        formData.append('category', form.category.trim());
        formData.append('reference', form.reference.trim());
        if (removeAttachment) formData.append('removeAttachment', 'true');
        if (!financialLocked && amount != null) {
          formData.append('amount', String(amount));
          formData.append('type', form.type);
          if (installmentOn && totalInstallments != null && installmentAmount != null) {
            formData.append('installmentEnabled', 'true');
            formData.append('totalInstallments', String(totalInstallments));
            formData.append('installmentAmount', String(installmentAmount));
          } else {
            formData.append('installmentEnabled', 'false');
          }
        }
        formData.append('attachment', file);

        const patchMultipart = async (accessToken: string | null) =>
          fetch(url, {
            method: 'PATCH',
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: formData,
          });

        let res = await patchMultipart(token);
        if (res.status === 401) {
          const refreshed = await refreshStoredAccessToken();
          if (refreshed) {
            token = refreshed;
            res = await patchMultipart(token);
          }
        }

        const raw = await res.text();
        let parsed: { success?: boolean; error?: string; message?: string } = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = { success: false, error: raw.slice(0, 200) || `HTTP ${res.status}` };
        }
        if (!res.ok || !parsed.success) {
          setError(parsed.error || parsed.message || 'Não foi possível actualizar o lançamento');
          return;
        }
      } else {
        const body: Record<string, unknown> = {
          description,
          category: form.category.trim() || null,
          reference: form.reference.trim() || null,
        };
        if (removeAttachment) body.removeAttachment = true;
        if (!financialLocked && amount != null) {
          body.amount = amount;
          body.type = form.type;
          if (installmentOn) {
            body.installmentEnabled = true;
            body.totalInstallments = totalInstallments;
            body.installmentAmount = installmentAmount;
          } else {
            body.installmentEnabled = false;
          }
        }

        const res = await apiFetch(API_PATHS.contaCorrente.byId(entry.id), {
          method: 'PATCH',
          body: JSON.stringify(body),
        }, getStoredToken());

        if (!res.success) {
          setError(getApiErrorMessage(res) || 'Não foi possível actualizar o lançamento');
          return;
        }
      }

      closeModal();
      load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Não foi possível actualizar o lançamento'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(entry: Entry) {
    const ok = await confirm({
      title: 'Cancelar lançamento?',
      message: 'O lançamento passará a estado Cancelado e deixará de entrar nos pagamentos.',
      confirmLabel: 'Cancelar lançamento',
      cancelLabel: 'Voltar',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await apiFetch(API_PATHS.contaCorrente.cancel(entry.id), { method: 'POST' }, getStoredToken());
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    load();
  }

  async function handleReopen(entry: Entry) {
    const ok = await confirm({
      title: 'Reabrir lançamento?',
      message:
        'O lançamento voltará a estado Em aberto e poderá ser aplicado novamente nos pagamentos.',
      confirmLabel: 'Reabrir',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await apiFetch(API_PATHS.contaCorrente.reopen(entry.id), { method: 'POST' }, getStoredToken());
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    load();
  }

  async function handleDelete(entry: Entry) {
    const linked = Boolean(entry.paymentReportId);
    const ok = await confirm({
      title: 'Eliminar lançamento?',
      message: linked
        ? 'Este lançamento foi aplicado num pagamento. Será removido permanentemente e desassociado do relatório.'
        : 'Esta acção não pode ser anulada.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await apiFetch(API_PATHS.contaCorrente.byId(entry.id), { method: 'DELETE' }, getStoredToken());
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    load();
  }

  async function downloadAttachment(entry: Entry) {
    const token = getStoredToken();
    const res = await fetch(
      `${getApiUrl()}${API_PATHS.contaCorrente.attachmentDownload(entry.id)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (!res.ok) {
      setError('Não foi possível descarregar o anexo');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.attachmentFileName || 'anexo';
    a.click();
    URL.revokeObjectURL(url);
  }

  const summary = data?.summary;
  const showAllDrivers = !driverId;
  const tableCols = showAllDrivers ? 8 : 7;
  const financialLocked = Boolean(editingEntry && editingEntry.installmentsPaid > 0);

  return (
    <>
      {confirmDialog}
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-2xl text-sm text-slate-500">
            Registe créditos e débitos ocasionais (pneu, adiantamentos, multas) e acompanhe o saldo
            em aberto de cada motorista.
          </p>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => openCreateModal()}
            >
            <Plus size={16} />
            Adicionar lançamento
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Motorista</span>
            <select
              className="input"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">Todos os motoristas</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Estado</span>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'all' | EntryStatus)}
            >
              <option value="open">Em aberto</option>
              <option value="settled">Liquidado</option>
              <option value="cancelled">Cancelado</option>
              <option value="all">Todos</option>
            </select>
          </label>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="card">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Saldo em aberto
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatMoney(summary?.openBalance ?? '0')}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {summary?.openCount ?? 0} registo{(summary?.openCount ?? 0) === 1 ? '' : 's'} em aberto
              {showAllDrivers ? ' (todos)' : ''}
            </p>
          </div>
          <div className="card">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Saldo acumulado
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatMoney(summary?.accumulatedBalance ?? '0')}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {showAllDrivers ? 'Todos os motoristas' : 'Inclui liquidados e cancelados'}
            </p>
          </div>
          <div className="card">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Última actualização
            </p>
            {summary?.lastUpdate ? (
              <>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {summary.lastUpdate.driverLabel}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(summary.lastUpdate.at)}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Sem movimentos</p>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {showAllDrivers ? (
                  <th className="px-4 py-3 font-medium">Motorista</th>
                ) : null}
                <th className="px-4 py-3 font-medium">Descrição</th>
                    <th className="px-4 py-3 font-medium">Valor</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Criado em</th>
                    <th className="px-4 py-3 font-medium">Referência</th>
                    <th className="px-4 py-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={tableCols} className="px-4 py-10 text-center text-slate-500">
                        A carregar…
                      </td>
                    </tr>
                  ) : !data?.entries.length ? (
                    <tr>
                      <td colSpan={tableCols} className="px-4 py-10 text-center text-slate-500">
                        Sem lançamentos para os filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    data.entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                        {showAllDrivers ? (
                          <td className="px-4 py-3 font-medium text-slate-900">{entry.driverLabel}</td>
                        ) : null}
                        <td className="max-w-xs px-4 py-3">
                          <p className="font-medium text-slate-900">{entry.description}</p>
                          {entry.category ? (
                            <p className="text-xs text-slate-500">{entry.category}</p>
                          ) : null}
                          {entry.installmentEnabled ? (
                            <p className="text-xs text-slate-500">
                              {installmentProgressLabel(entry)} ·{' '}
                              {formatMoney(entry.installmentAmount ?? '0')}/parcela
                              {entry.status === 'open' && Number(entry.remainingBalance) > 0 ? (
                                <> · Restante {formatMoney(entry.remainingBalance)}</>
                              ) : null}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-medium tabular-nums">
                          <p>{formatMoney(entry.amount)}</p>
                          {entry.status === 'open' || entry.installmentEnabled ? (
                            <p className="text-xs font-normal text-slate-500">
                              Saldo: {formatMoney(entry.remainingBalance)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              entry.type === 'credit'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                            )}
                          >
                            {entry.type === 'credit' ? 'Crédito' : 'Débito'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={clsx(
                              'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              entry.status === 'open' && 'bg-amber-50 text-amber-800',
                              entry.status === 'settled' && 'bg-slate-100 text-slate-700',
                              entry.status === 'cancelled' && 'bg-slate-50 text-slate-500'
                            )}
                          >
                            {STATUS_LABEL[entry.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{formatDateTime(entry.createdAt)}</td>
                        <td className="px-4 py-3 text-slate-600">{entry.reference || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {entry.hasAttachment ? (
                              <button
                                type="button"
                                title="Descarregar anexo"
                                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                                onClick={() => void downloadAttachment(entry)}
                              >
                                <Download size={16} />
                              </button>
                            ) : null}
                            {entry.status === 'open' ? (
                              <button
                                type="button"
                                title="Editar"
                                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
                                onClick={() => openEditModal(entry)}
                              >
                                <Pencil size={16} />
                              </button>
                            ) : null}
                            {entry.status === 'open' && entry.installmentsPaid === 0 ? (
                              <>
                                <button
                                  type="button"
                                  title="Cancelar"
                                  className="rounded-md p-1.5 text-amber-600 hover:bg-amber-50"
                                  onClick={() => void handleCancel(entry)}
                                >
                                  <XCircle size={16} />
                                </button>
                                <button
                                  type="button"
                                  title="Eliminar"
                                  className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                                  onClick={() => void handleDelete(entry)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            ) : null}
                            {entry.status === 'open' && entry.installmentsPaid > 0 ? (
                              <button
                                type="button"
                                title="Eliminar"
                                className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                                onClick={() => void handleDelete(entry)}
                              >
                                <Trash2 size={16} />
                              </button>
                            ) : null}
                            {entry.status === 'settled' ? (
                              <>
                                <button
                                  type="button"
                                  title="Reabrir"
                                  className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
                                  onClick={() => void handleReopen(entry)}
                                >
                                  <RotateCcw size={16} />
                                </button>
                                <button
                                  type="button"
                                  title="Eliminar"
                                  className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                                  onClick={() => void handleDelete(entry)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            ) : null}
                            {entry.status === 'cancelled' ? (
                              <button
                                type="button"
                                title="Eliminar"
                                className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                                onClick={() => void handleDelete(entry)}
                              >
                                <Trash2 size={16} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingEntry ? 'Editar lançamento' : 'Novo lançamento'}
        scrollBody
        showCloseButton
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={closeModal}
            >
              Cancelar
            </button>
            <button type="submit" form="conta-corrente-form" className="btn-primary" disabled={saving}>
              {saving ? 'A guardar…' : 'Guardar'}
            </button>
          </div>
        }
      >
        <form id="conta-corrente-form" className="space-y-4" onSubmit={handleSubmit}>
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          {financialLocked ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Este lançamento já tem parcelas deduzidas — só pode editar descrição, categoria,
              referência e anexo.
            </div>
          ) : null}
          {!driverId && !editingEntry ? (
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Motorista</span>
              <select
                className="input"
                required
                value={form.createDriverId}
                onChange={(e) => setForm((f) => ({ ...f, createDriverId: e.target.value }))}
              >
                <option value="">Seleccionar motorista…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Descrição</span>
            <textarea
              className="input min-h-[88px]"
              required
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Ex.: Pneu furado pago pelo motorista"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Valor (€)</span>
              <input
                className="input"
                required={!financialLocked}
                disabled={financialLocked}
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Valor positivo + tipo Crédito/Débito
              </span>
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Tipo</span>
              <select
                className="input"
                disabled={financialLocked}
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    type: e.target.value as EntryType,
                    installmentEnabled:
                      e.target.value === 'debit' ? f.installmentEnabled : false,
                  }))
                }
              >
                <option value="credit">Crédito (empresa deve ao motorista)</option>
                <option value="debit">Débito (motorista deve à empresa)</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Categoria (opcional)</span>
              <input
                className="input"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Ex.: Multa, Adiantamento"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Referência (opcional)</span>
              <input
                className="input"
                value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Anexar ficheiro (opcional)</span>
            {editingEntry?.hasAttachment && editingEntry.attachmentFileName ? (
              <p className="mb-2 text-xs text-slate-600">
                Anexo actual: {editingEntry.attachmentFileName}
              </p>
            ) : null}
            {editingEntry?.hasAttachment ? (
              <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={removeAttachment}
                  onChange={(e) => setRemoveAttachment(e.target.checked)}
                />
                Remover anexo actual
              </label>
            ) : null}
            <input
              type="file"
              className="input"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span className="mt-1 block text-xs text-slate-500">PDF, imagens ou documentos · máx. 10 MB</span>
          </label>

          {form.type === 'debit' && !financialLocked ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={form.installmentEnabled}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, installmentEnabled: e.target.checked }))
                  }
                />
                Permitir pagamento parcelado
              </label>
              {form.installmentEnabled ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-slate-700">Nº de parcelas</span>
                    <input
                      className="input"
                      type="number"
                      min={2}
                      value={form.totalInstallments}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, totalInstallments: e.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-slate-700">Valor por parcela (€)</span>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={form.installmentAmount}
                      placeholder={installmentPreview || '0.00'}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, installmentAmount: e.target.value }))
                      }
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
