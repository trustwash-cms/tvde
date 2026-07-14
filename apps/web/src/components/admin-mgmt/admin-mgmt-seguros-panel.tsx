'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Eye, FileText, Plus, Trash2, X } from 'lucide-react';
import {
  ADMIN_MGMT_MAX_APOlices,
  ADMIN_MGMT_SEGURO_PERIODICIDADES,
  ADMIN_MGMT_SEGURO_PAGAMENTO_STATUSES,
  type AdminMgmtApoliceFile,
  formatPortugueseLicensePlate,
  isAdminMgmtSeguroTipoAutomovel,
  validatePortugueseLicensePlate,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface SeguroRow {
  id: string;
  seguradora: string;
  tipoProduto: string;
  matricula: string | null;
  numeroApolice: string | null;
  dataInicioPeriodo: string | null;
  dataFimPeriodo: string | null;
  periodicidadePagamento: string;
  totalPago: string | null;
  statusPagamento: string;
  notas: string | null;
  apolices: AdminMgmtApoliceFile[];
  apoliceCount: number;
}

interface SettingsData {
  seguradoras: string[];
  tiposProduto: string[];
}

const APOlice_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

function formatDatePt(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  if (!day || !month || !year) return value;
  return `${day}/${month}/${year}`;
}

function rowLabel(row: SeguroRow): string {
  return [row.seguradora, row.tipoProduto, row.matricula, row.dataFimPeriodo].filter(Boolean).join(' · ');
}

async function downloadApolice(seguroId: string, apolice: AdminMgmtApoliceFile, workspaceId: string) {
  const token = getStoredToken();
  const url = `${getApiUrl()}${withWorkspaceQuery(
    API_PATHS.adminMgmt.seguroApoliceById(seguroId, apolice.id),
    workspaceId
  )}`;
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Falha ao descarregar');
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = apolice.fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function AdminMgmtSegurosPanel() {
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<SeguroRow[]>([]);
  const [settings, setSettings] = useState<SettingsData>({ seguradoras: [], tiposProduto: [] });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewSeguro, setViewSeguro] = useState<SeguroRow | null>(null);
  const [apolicesModalSeguro, setApolicesModalSeguro] = useState<SeguroRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apoliceInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    seguradora: '',
    tipoProduto: '',
    matricula: '',
    numeroApolice: '',
    dataInicioPeriodo: '',
    dataFimPeriodo: '',
    periodicidadePagamento: 'anual',
    totalPago: '',
    statusPagamento: 'pendente',
    notas: '',
  });
  const [pendingApolices, setPendingApolices] = useState<File[]>([]);
  const [matriculaError, setMatriculaError] = useState('');

  const showMatricula = isAdminMgmtSeguroTipoAutomovel(form.tipoProduto);

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([
      apiFetch<SeguroRow[]>(withWorkspaceQuery(API_PATHS.adminMgmt.seguros, workspaceId), {}, getStoredToken()),
      apiFetch<SettingsData>(withWorkspaceQuery(API_PATHS.adminMgmt.settings, workspaceId), {}, getStoredToken()),
    ]).then(([segurosRes, settingsRes]) => {
      setLoading(false);
      if (segurosRes.data) setRows(segurosRes.data);
      else setError(getApiErrorMessage(segurosRes));
      if (settingsRes.data) setSettings(settingsRes.data);
    });
  }

  useEffect(load, [workspaceId]);

  function resetForm() {
    setForm({
      seguradora: '',
      tipoProduto: settings.tiposProduto[0] ?? '',
      matricula: '',
      numeroApolice: '',
      dataInicioPeriodo: '',
      dataFimPeriodo: '',
      periodicidadePagamento: 'anual',
      totalPago: '',
      statusPagamento: 'pendente',
      notas: '',
    });
    setPendingApolices([]);
    setMatriculaError('');
  }

  function openCreateModal() {
    resetForm();
    setModalOpen(true);
  }

  function handleMatriculaChange(value: string) {
    const formatted = formatPortugueseLicensePlate(value);
    setForm((f) => ({ ...f, matricula: formatted }));
    setMatriculaError(
      formatted && !validatePortugueseLicensePlate(formatted)
        ? 'Formato inválido — use XX-XX-XX'
        : ''
    );
  }

  async function uploadApoliceFile(seguroId: string, file: File) {
    if (!workspaceId) return false;
    if (file.size > MAX_BYTES) {
      setError('Cada ficheiro pode ter no máximo 10 MB');
      return false;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspaceId', workspaceId);
    const token = getStoredToken();
    const res = await fetch(`${getApiUrl()}${API_PATHS.adminMgmt.seguroApoliceUpload(seguroId)}`, {
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
      setError(parsed.error ?? 'Falha ao carregar apólice');
      return false;
    }
    return true;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    if (showMatricula && !validatePortugueseLicensePlate(form.matricula)) {
      setMatriculaError('Matrícula obrigatória — formato XX-XX-XX');
      return;
    }
    if (pendingApolices.length > ADMIN_MGMT_MAX_APOlices) {
      setError(`Máximo ${ADMIN_MGMT_MAX_APOlices} apólices`);
      return;
    }

    setSaving(true);
    setError('');
    const payload = {
      workspaceId,
      seguradora: form.seguradora.trim(),
      tipoProduto: form.tipoProduto.trim(),
      matricula: showMatricula ? form.matricula.trim() : null,
      numeroApolice: form.numeroApolice.trim() || null,
      dataInicioPeriodo: form.dataInicioPeriodo || null,
      dataFimPeriodo: form.dataFimPeriodo,
      periodicidadePagamento: form.periodicidadePagamento,
      totalPago: form.totalPago.trim() || null,
      statusPagamento: form.statusPagamento,
      notas: form.notas.trim() || null,
    };

    const res = await apiFetch<{ id: string }>(
      API_PATHS.adminMgmt.seguros,
      { method: 'POST', body: JSON.stringify(payload) },
      getStoredToken()
    );

    if (!res.success || !res.data?.id) {
      setSaving(false);
      setError(getApiErrorMessage(res));
      return;
    }

    for (const file of pendingApolices) {
      const ok = await uploadApoliceFile(res.data.id, file);
      if (!ok) {
        setSaving(false);
        load();
        return;
      }
    }

    setSaving(false);
    setModalOpen(false);
    resetForm();
    load();
  }

  async function remove(id: string, label: string) {
    if (!workspaceId) return;
    const ok = await confirm(`Eliminar ${label}?`);
    if (!ok) return;
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.adminMgmt.seguroById(id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.success) load();
    else setError(getApiErrorMessage(res));
  }

  async function handleApoliceUpload(files: FileList | null) {
    if (!files?.length || !apolicesModalSeguro || !workspaceId) return;
    const seguroId = apolicesModalSeguro.id;
    const remaining = ADMIN_MGMT_MAX_APOlices - apolicesModalSeguro.apoliceCount;
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length < files.length) {
      setError(`Máximo ${ADMIN_MGMT_MAX_APOlices} apólices por seguro`);
    }
    for (const file of toUpload) {
      const ok = await uploadApoliceFile(seguroId, file);
      if (!ok) break;
    }
    if (apoliceInputRef.current) apoliceInputRef.current.value = '';
    const res = await apiFetch<SeguroRow[]>(
      withWorkspaceQuery(API_PATHS.adminMgmt.seguros, workspaceId),
      {},
      getStoredToken()
    );
    if (res.data) {
      setRows(res.data);
      const updated = res.data.find((r) => r.id === seguroId);
      if (updated) setApolicesModalSeguro(updated);
    }
  }

  async function removeApolice(seguroId: string, apoliceId: string) {
    if (!workspaceId) return;
    const ok = await confirm('Eliminar esta apólice?');
    if (!ok) return;
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.adminMgmt.seguroApoliceById(seguroId, apoliceId), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.success) {
      load();
      setApolicesModalSeguro((current) =>
        current
          ? {
              ...current,
              apolices: current.apolices.filter((a) => a.id !== apoliceId),
              apoliceCount: current.apoliceCount - 1,
            }
          : null
      );
    } else setError(getApiErrorMessage(res));
  }

  if (!workspaceId) return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Seguros</h2>
          <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" onClick={openCreateModal}>
            <Plus size={14} />
            Novo seguro
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum seguro registado.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                  <th className="px-3 py-2">Seguradora</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Matrícula</th>
                  <th className="px-3 py-2">Vencimento</th>
                  <th className="px-3 py-2">Apólices</th>
                  <th className="px-3 py-2 text-right">Acções</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{row.seguradora}</td>
                    <td className="px-3 py-2">{row.tipoProduto}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.matricula ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDatePt(row.dataFimPeriodo)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"
                        onClick={() => setApolicesModalSeguro(row)}
                      >
                        <FileText size={14} />
                        {row.apoliceCount}/{ADMIN_MGMT_MAX_APOlices}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
                          title="Ver"
                          onClick={() => setViewSeguro(row)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                          title="Eliminar"
                          onClick={() => void remove(row.id, rowLabel(row))}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Novo seguro" panelClassName="max-w-xl" scrollBody>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-slate-600">Seguradora *</label>
            <select
              className="input"
              value={form.seguradora}
              onChange={(e) => setForm({ ...form, seguradora: e.target.value })}
              required
            >
              <option value="">Seleccionar…</option>
              {settings.seguradoras.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {settings.seguradoras.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">Configure seguradoras em Configurações.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-600">Tipo de produto *</label>
            <select
              className="input"
              value={form.tipoProduto}
              onChange={(e) =>
                setForm({
                  ...form,
                  tipoProduto: e.target.value,
                  matricula: isAdminMgmtSeguroTipoAutomovel(e.target.value) ? form.matricula : '',
                })
              }
              required
            >
              <option value="">Seleccionar…</option>
              {settings.tiposProduto.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {showMatricula && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">Matrícula *</label>
              <input
                className="input font-mono uppercase"
                value={form.matricula}
                onChange={(e) => handleMatriculaChange(e.target.value)}
                placeholder="XX-XX-XX"
                maxLength={8}
                required
              />
              {matriculaError && <p className="mt-1 text-xs text-red-600">{matriculaError}</p>}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm text-slate-600">N.º apólice</label>
            <input
              className="input"
              value={form.numeroApolice}
              onChange={(e) => setForm({ ...form, numeroApolice: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Início período</label>
              <input
                className="input"
                type="date"
                value={form.dataInicioPeriodo}
                onChange={(e) => setForm({ ...form, dataInicioPeriodo: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Fim período *</label>
              <input
                className="input"
                type="date"
                value={form.dataFimPeriodo}
                onChange={(e) => setForm({ ...form, dataFimPeriodo: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Periodicidade</label>
              <select
                className="input"
                value={form.periodicidadePagamento}
                onChange={(e) => setForm({ ...form, periodicidadePagamento: e.target.value })}
              >
                {ADMIN_MGMT_SEGURO_PERIODICIDADES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Total pago (€)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.totalPago}
                onChange={(e) => setForm({ ...form, totalPago: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-600">Estado pagamento</label>
            <select
              className="input"
              value={form.statusPagamento}
              onChange={(e) => setForm({ ...form, statusPagamento: e.target.value })}
            >
              {ADMIN_MGMT_SEGURO_PAGAMENTO_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-600">Notas</label>
            <textarea
              className="input min-h-[60px]"
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm text-slate-600">
                Apólices (máx. {ADMIN_MGMT_MAX_APOlices}) — PDF, PNG, JPEG, WebP
              </label>
              {pendingApolices.length < ADMIN_MGMT_MAX_APOlices && (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Adicionar
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={APOlice_ACCEPT}
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                const combined = [...pendingApolices, ...files].slice(0, ADMIN_MGMT_MAX_APOlices);
                setPendingApolices(combined);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            <ul className="space-y-1 rounded-lg border border-slate-100 p-2 text-sm">
              {pendingApolices.length === 0 && (
                <li className="text-xs text-slate-400">Sem ficheiros seleccionados</li>
              )}
              {pendingApolices.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    onClick={() => setPendingApolices(pendingApolices.filter((_, i) => i !== index))}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'A guardar…' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(viewSeguro)}
        onClose={() => setViewSeguro(null)}
        title="Detalhe do seguro"
        panelClassName="max-w-lg"
        scrollBody
      >
        {viewSeguro && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Seguradora</dt>
              <dd className="font-medium text-slate-900">{viewSeguro.seguradora}</dd>
              <dt className="text-slate-500">Tipo de produto</dt>
              <dd>{viewSeguro.tipoProduto}</dd>
              <dt className="text-slate-500">Matrícula</dt>
              <dd className="font-mono">{viewSeguro.matricula ?? '—'}</dd>
              <dt className="text-slate-500">N.º apólice</dt>
              <dd>{viewSeguro.numeroApolice ?? '—'}</dd>
              <dt className="text-slate-500">Início período</dt>
              <dd>{formatDatePt(viewSeguro.dataInicioPeriodo)}</dd>
              <dt className="text-slate-500">Vencimento</dt>
              <dd className="font-medium">{formatDatePt(viewSeguro.dataFimPeriodo)}</dd>
              <dt className="text-slate-500">Periodicidade</dt>
              <dd>{viewSeguro.periodicidadePagamento}</dd>
              <dt className="text-slate-500">Total pago</dt>
              <dd>{viewSeguro.totalPago ? `${viewSeguro.totalPago} €` : '—'}</dd>
              <dt className="text-slate-500">Estado pagamento</dt>
              <dd>{viewSeguro.statusPagamento}</dd>
              {viewSeguro.notas && (
                <>
                  <dt className="text-slate-500">Notas</dt>
                  <dd className="whitespace-pre-wrap">{viewSeguro.notas}</dd>
                </>
              )}
            </dl>

            <div className="border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-700">
                  Apólices ({viewSeguro.apoliceCount}/{ADMIN_MGMT_MAX_APOlices})
                </h3>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                  onClick={() => {
                    setViewSeguro(null);
                    setApolicesModalSeguro(viewSeguro);
                  }}
                >
                  Gerir apólices
                </button>
              </div>
              {viewSeguro.apolices.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhuma apólice anexada</p>
              ) : (
                <ul className="space-y-1">
                  {viewSeguro.apolices.map((apolice) => (
                    <li key={apolice.id}>
                      <button
                        type="button"
                        className="text-sm text-[var(--color-primary)] hover:underline"
                        onClick={() =>
                          void downloadApolice(viewSeguro.id, apolice, workspaceId).catch(() =>
                            setError('Falha ao descarregar')
                          )
                        }
                      >
                        {apolice.fileName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(apolicesModalSeguro)}
        onClose={() => setApolicesModalSeguro(null)}
        title="Apólices"
        panelClassName="max-w-md"
      >
        {apolicesModalSeguro && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{rowLabel(apolicesModalSeguro)}</p>
            <ul className="space-y-2 rounded-lg border border-slate-100 p-2">
              {apolicesModalSeguro.apolices.length === 0 && (
                <li className="text-xs text-slate-400">Nenhuma apólice anexada</li>
              )}
              {apolicesModalSeguro.apolices.map((apolice) => (
                <li key={apolice.id} className="flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    className="truncate text-left text-[var(--color-primary)] hover:underline"
                    onClick={() =>
                      void downloadApolice(apolicesModalSeguro.id, apolice, workspaceId).catch(() =>
                        setError('Falha ao descarregar')
                      )
                    }
                  >
                    {apolice.fileName}
                  </button>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    onClick={() => void removeApolice(apolicesModalSeguro.id, apolice.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {apolicesModalSeguro.apoliceCount < ADMIN_MGMT_MAX_APOlices && (
              <>
                <input
                  ref={apoliceInputRef}
                  type="file"
                  className="hidden"
                  accept={APOlice_ACCEPT}
                  multiple
                  onChange={(e) => void handleApoliceUpload(e.target.files)}
                />
                <button
                  type="button"
                  className="btn-secondary w-full text-sm"
                  onClick={() => apoliceInputRef.current?.click()}
                >
                  Adicionar apólice
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
