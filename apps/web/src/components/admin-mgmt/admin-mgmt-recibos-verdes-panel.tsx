'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import {
  PORTAL_DAS_FINANCAS_EMITIR_URL,
  formatAdminMgmtMoney,
  getAdminMgmtFaturaPagamentoLabel,
  hasMinRole,
  type Role,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { AdminMgmtRecibosVerdesImport } from '@/components/admin-mgmt/admin-mgmt-recibos-verdes-import';
import { AdminMgmtRecibosVerdesDraft } from '@/components/admin-mgmt/admin-mgmt-recibos-verdes-draft';
import { PortalConnectionPanel } from '@/components/portal/portal-connection-panel';

type ReciboVerdeRow = {
  id: string;
  prestadorNome: string;
  prestadorNif: string | null;
  numeroRecibo: string | null;
  dataEmissao: string;
  descricaoServico: string | null;
  valorBruto: string | null;
  taxaRetencaoIrs: string | null;
  valorRetencaoIrs: string | null;
  isentoSs: boolean;
  valorSs: string | null;
  valorLiquido: string | null;
  clienteAssociado: string | null;
};

type FaturaImportada = {
  id: string;
  numero: string;
  clienteNome: string;
  clienteNif: string | null;
  dataEmissao: string;
  valorTotal: string;
  estadoPagamento: string;
  tipoDocumento: string;
};

const EMPTY_FORM = {
  prestadorNome: '',
  prestadorNif: '',
  numeroRecibo: '',
  dataEmissao: '',
  descricaoServico: '',
  valorBruto: '',
  taxaRetencaoIrs: '',
  valorRetencaoIrs: '',
  isentoSs: false,
  valorSs: '',
  valorLiquido: '',
  clienteAssociado: '',
};

function formatDatePt(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return d && m && y ? `${d}/${m}/${y}` : value;
}

export function AdminMgmtRecibosVerdesPanel() {
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [role, setRole] = useState<Role | null>(null);
  const [rows, setRows] = useState<ReciboVerdeRow[]>([]);
  const [importados, setImportados] = useState<FaturaImportada[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([
      apiFetch<ReciboVerdeRow[]>(
        withWorkspaceQuery(API_PATHS.adminMgmt.recibosVerdes, workspaceId),
        {},
        getStoredToken()
      ),
      apiFetch<FaturaImportada[]>(
        withWorkspaceQuery(API_PATHS.adminMgmt.faturas, workspaceId),
        {},
        getStoredToken()
      ),
    ]).then(([recibosRes, faturasRes]) => {
      setLoading(false);
      if (recibosRes.data) setRows(recibosRes.data);
      else setError(getApiErrorMessage(recibosRes));
      if (faturasRes.data) {
        setImportados(faturasRes.data.filter((f) => f.tipoDocumento === 'recibo_verde'));
      }
    });
  }

  useEffect(() => {
    load();
  }, [workspaceId]);

  useEffect(() => {
    apiFetch<{ role: Role }>(API_PATHS.auth.me, {}, getStoredToken()).then((res) => {
      if (res.data?.role) setRole(res.data.role);
    });
  }, []);

  const canConnectPortal = role ? hasMinRole(role, 'superadmin') : false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.adminMgmt.recibosVerdes,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          ...form,
          prestadorNome: form.prestadorNome.trim(),
          prestadorNif: form.prestadorNif.trim() || null,
          numeroRecibo: form.numeroRecibo.trim() || null,
          descricaoServico: form.descricaoServico.trim() || null,
          clienteAssociado: form.clienteAssociado.trim() || null,
        }),
      },
      getStoredToken()
    );
    setSaving(false);
    if (res.success) {
      setModalOpen(false);
      setForm(EMPTY_FORM);
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function remove(row: ReciboVerdeRow) {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Eliminar recibo verde',
      message: `Eliminar o recibo ${row.numeroRecibo || row.prestadorNome}?`,
      confirmLabel: 'Eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.adminMgmt.reciboVerdeById(row.id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    if (res.success) load();
    else setError(getApiErrorMessage(res));
  }

  if (!workspaceId) {
    return <p className="text-sm text-slate-500">Seleccione um workspace.</p>;
  }

  return (
    <>
      {confirmDialog}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Recibos Verdes</h2>
          <div className="flex flex-wrap items-center gap-2">
            <AdminMgmtRecibosVerdesImport
              workspaceId={workspaceId}
              onImported={() => load()}
              onError={setError}
            />
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2 text-sm"
              onClick={() => setModalOpen(true)}
            >
              <Plus size={14} />
              Novo recibo
            </button>
          </div>
        </div>

        {canConnectPortal ? <PortalConnectionPanel portal="recibos_verdes" /> : null}

        <AdminMgmtRecibosVerdesDraft />

        <a
          href={PORTAL_DAS_FINANCAS_EMITIR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-[var(--color-primary)] hover:bg-white"
        >
          <div>
            <p className="text-sm font-medium text-slate-900">Página Emitir (AT)</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Abre Faturas e Recibos → Emitir. Conta ligada = sessão guardada. Fluxo TVDE (fatura
              real): Fatura-Recibo → data → Motivo «Pagamento dos bens ou dos serviços» → ADICIONAR
              (Serviço / Outro / IVA 0% Art.53.º) → Adquirente → EMITIR.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-white">
            Abrir no browser
            <ExternalLink size={14} />
          </span>
        </a>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : (
          <>
            {importados.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-700">Importados da AT</h3>
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                        <th className="px-3 py-2 font-medium">Referência</th>
                        <th className="px-3 py-2 font-medium">Cliente</th>
                        <th className="px-3 py-2 font-medium">Emissão</th>
                        <th className="px-3 py-2 font-medium">Total</th>
                        <th className="px-3 py-2 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importados.map((f) => (
                        <tr key={f.id} className="border-b border-slate-50">
                          <td className="px-3 py-2 font-mono text-xs text-slate-800">{f.numero}</td>
                          <td className="px-3 py-2">
                            <p>{f.clienteNome}</p>
                            {f.clienteNif ? (
                              <p className="text-xs text-slate-400">NIF {f.clienteNif}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatDatePt(f.dataEmissao)}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatAdminMgmtMoney(f.valorTotal) ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                f.estadoPagamento === 'pago'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {getAdminMgmtFaturaPagamentoLabel(f.estadoPagamento)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              {importados.length > 0 ? (
                <h3 className="text-sm font-medium text-slate-700">Registos manuais</h3>
              ) : null}
              {rows.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {importados.length > 0
                    ? 'Sem registos manuais.'
                    : 'Ainda sem recibos verdes neste workspace. Abra o Portal das Finanças, emita ou exporte, e importe o CSV — ou adicione um recibo manualmente.'}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-left text-slate-500">
                        <th className="px-3 py-2 font-medium">N.º / Prestador</th>
                        <th className="px-3 py-2 font-medium">Emissão</th>
                        <th className="px-3 py-2 font-medium">Cliente</th>
                        <th className="px-3 py-2 font-medium">Bruto</th>
                        <th className="px-3 py-2 font-medium">Líquido</th>
                        <th className="px-3 py-2 text-right font-medium">Acções</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="border-b border-slate-50">
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-900">
                              {row.numeroRecibo || 'Sem número'}
                            </p>
                            <p className="text-xs text-slate-500">
                              {row.prestadorNome}
                              {row.prestadorNif ? ` · NIF ${row.prestadorNif}` : ''}
                            </p>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                            {formatDatePt(row.dataEmissao)}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {row.clienteAssociado || '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatAdminMgmtMoney(row.valorBruto) ?? '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {formatAdminMgmtMoney(row.valorLiquido) ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                              title="Eliminar"
                              onClick={() => void remove(row)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => {
          if (saving) return;
          setModalOpen(false);
          setForm(EMPTY_FORM);
        }}
        title="Novo recibo verde"
        panelClassName="max-w-lg"
      >
        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Prestador</span>
            <input
              className="input w-full"
              required
              value={form.prestadorNome}
              onChange={(e) => setForm((f) => ({ ...f, prestadorNome: e.target.value }))}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">NIF prestador</span>
              <input
                className="input w-full"
                value={form.prestadorNif}
                onChange={(e) => setForm((f) => ({ ...f, prestadorNif: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">N.º recibo</span>
              <input
                className="input w-full"
                value={form.numeroRecibo}
                onChange={(e) => setForm((f) => ({ ...f, numeroRecibo: e.target.value }))}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Data de emissão</span>
            <input
              type="date"
              className="input w-full"
              required
              value={form.dataEmissao}
              onChange={(e) => setForm((f) => ({ ...f, dataEmissao: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Cliente associado</span>
            <input
              className="input w-full"
              value={form.clienteAssociado}
              onChange={(e) => setForm((f) => ({ ...f, clienteAssociado: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Descrição do serviço</span>
            <textarea
              className="input w-full"
              rows={2}
              value={form.descricaoServico}
              onChange={(e) => setForm((f) => ({ ...f, descricaoServico: e.target.value }))}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Valor bruto (€)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input w-full"
                value={form.valorBruto}
                onChange={(e) => setForm((f) => ({ ...f, valorBruto: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Valor líquido (€)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input w-full"
                value={form.valorLiquido}
                onChange={(e) => setForm((f) => ({ ...f, valorLiquido: e.target.value }))}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Retenção IRS (€)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input w-full"
                value={form.valorRetencaoIrs}
                onChange={(e) => setForm((f) => ({ ...f, valorRetencaoIrs: e.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Segurança Social (€)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input w-full"
                disabled={form.isentoSs}
                value={form.valorSs}
                onChange={(e) => setForm((f) => ({ ...f, valorSs: e.target.value }))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={form.isentoSs}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  isentoSs: e.target.checked,
                  valorSs: e.target.checked ? '' : f.valorSs,
                }))
              }
            />
            Isento de Segurança Social
          </label>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={() => {
                setModalOpen(false);
                setForm(EMPTY_FORM);
              }}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'A gravar…' : 'Gravar'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
