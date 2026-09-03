'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Mail, Printer, RefreshCw, CheckCircle2 } from 'lucide-react';
import {
  PORTAL_DAS_FINANCAS_EMITIR_URL,
  formatAdminMgmtMoney,
  formatPtMoney,
  hasMinRole,
  type RecibosVerdesDraft,
  type Role,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { AdminMgmtRecibosVerdesImport } from '@/components/admin-mgmt/admin-mgmt-recibos-verdes-import';
import { AdminMgmtRecibosVerdesDraft } from '@/components/admin-mgmt/admin-mgmt-recibos-verdes-draft';
import { PortalConnectionPanel } from '@/components/portal/portal-connection-panel';
import {
  loadRecibosVerdesLocalDocs,
  upsertRecibosVerdesLocalDoc,
  type RecibosVerdesLocalDoc,
} from '@/lib/recibos-verdes-local';
import { downloadRecibosVerdesDraftPdf } from '@/lib/recibos-verdes-draft-pdf';

type ReciboVerdeRow = {
  id: string;
  prestadorNome: string;
  prestadorNif: string | null;
  numeroRecibo: string | null;
  dataEmissao: string;
  descricaoServico: string | null;
  valorBruto: string | null;
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
  descricaoResumo: string | null;
};

type ListItem = {
  key: string;
  source: 'local' | 'importado' | 'manual';
  referencia: string;
  tipoDocumento: string;
  clienteNome: string;
  situacao: 'emitido' | 'pago' | 'pendente' | 'rascunho';
  dataPrestacao: string;
  totalLabel: string;
  draft?: RecibosVerdesDraft;
  faturaId?: string;
  localDoc?: RecibosVerdesLocalDoc;
  emailHint?: string;
};

const PAGE_SIZE = 10;
const AT_BLUE = '#0073bb';

function formatDateIso(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

export function AdminMgmtRecibosVerdesPanel() {
  const { workspaceId } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [role, setRole] = useState<Role | null>(null);
  const [rows, setRows] = useState<ReciboVerdeRow[]>([]);
  const [importados, setImportados] = useState<FaturaImportada[]>([]);
  const [localDocs, setLocalDocs] = useState<RecibosVerdesLocalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [reuseSeed, setReuseSeed] = useState<RecibosVerdesDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  function refreshLocal() {
    if (!workspaceId) return;
    setLocalDocs(loadRecibosVerdesLocalDocs(workspaceId));
  }

  function load() {
    if (!workspaceId) return;
    setLoading(true);
    refreshLocal();
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

  const listItems = useMemo<ListItem[]>(() => {
    const local: ListItem[] = localDocs.map((d) => ({
      key: `local-${d.id}`,
      source: 'local',
      referencia: d.referencia,
      tipoDocumento: d.tipoDocumento,
      clienteNome: d.clienteNome || '—',
      situacao: d.situacao === 'pago' ? 'pago' : d.situacao === 'rascunho' ? 'rascunho' : 'emitido',
      dataPrestacao: d.dataPrestacao,
      totalLabel: `${formatPtMoney(d.total)} €`,
      draft: d.draft,
      localDoc: d,
    }));

    const imported: ListItem[] = importados.map((f) => ({
      key: `imp-${f.id}`,
      source: 'importado',
      referencia: f.numero,
      tipoDocumento: 'FATURA-RECIBO',
      clienteNome: f.clienteNome,
      situacao: f.estadoPagamento === 'pago' ? 'pago' : 'emitido',
      dataPrestacao: f.dataEmissao,
      totalLabel: formatAdminMgmtMoney(f.valorTotal) ?? '—',
      faturaId: f.id,
      emailHint: undefined,
    }));

    const manual: ListItem[] = rows.map((r) => ({
      key: `man-${r.id}`,
      source: 'manual',
      referencia: r.numeroRecibo || r.id.slice(0, 8),
      tipoDocumento: 'RECIBO VERDE',
      clienteNome: r.clienteAssociado || '—',
      situacao: 'emitido',
      dataPrestacao: r.dataEmissao,
      totalLabel: formatAdminMgmtMoney(r.valorLiquido ?? r.valorBruto) ?? '—',
    }));

    return [...local, ...imported, ...manual].sort((a, b) =>
      formatDateIso(b.dataPrestacao).localeCompare(formatDateIso(a.dataPrestacao))
    );
  }, [localDocs, importados, rows]);

  const totalPages = Math.max(1, Math.ceil(listItems.length / PAGE_SIZE));
  const pageItems = listItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function markPago(item: ListItem) {
    if (!workspaceId) return;
    if (item.source === 'importado' && item.faturaId) {
      const ok = await confirm({
        title: 'Marcar como pago',
        message: `Marcar ${item.referencia} como pago?`,
        confirmLabel: 'Pago',
      });
      if (!ok) return;
      const res = await apiFetch(
        API_PATHS.adminMgmt.faturaMarkPaid(item.faturaId),
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceId,
            dataPagamento: new Date().toISOString().slice(0, 10),
            metodoPagamento: 'transferencia',
          }),
        },
        getStoredToken()
      );
      if (res.success) load();
      else setError(getApiErrorMessage(res));
      return;
    }
    if (item.source === 'local' && item.localDoc) {
      upsertRecibosVerdesLocalDoc(workspaceId, { ...item.localDoc, situacao: 'pago' });
      refreshLocal();
    }
  }

  async function imprimir(item: ListItem) {
    if (item.draft) {
      await downloadRecibosVerdesDraftPdf(item.draft);
      return;
    }
    setError('Impressão disponível para rascunhos locais (Emitir PDF).');
  }

  function reutilizar(item: ListItem) {
    if (item.draft) {
      setReuseSeed(structuredClone(item.draft));
      setDraftKey((k) => k + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setError('Reutilizar disponível para documentos gerados neste rascunho.');
  }

  function emailDoc(item: ListItem) {
    const subject = encodeURIComponent(`${item.tipoDocumento} ${item.referencia}`);
    const body = encodeURIComponent(
      `Segue o documento ${item.referencia} (${item.tipoDocumento}) — total ${item.totalLabel}.`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
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
          <AdminMgmtRecibosVerdesImport
            workspaceId={workspaceId}
            onImported={() => load()}
            onError={setError}
          />
        </div>

        {canConnectPortal ? <PortalConnectionPanel portal="recibos_verdes" /> : null}

        <AdminMgmtRecibosVerdesDraft
          key={draftKey}
          workspaceId={workspaceId}
          initialDraft={reuseSeed}
          onLocalDocsChange={refreshLocal}
        />

        <a
          href={PORTAL_DAS_FINANCAS_EMITIR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-[var(--color-primary)] hover:bg-white"
        >
          <div>
            <p className="text-sm font-medium text-slate-900">Página Emitir (AT)</p>
            <p className="mt-0.5 text-sm text-slate-500">
              Abre Faturas e Recibos → Emitir. Conta ligada = sessão guardada.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-white">
            Abrir no browser
            <ExternalLink size={14} />
          </span>
        </a>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="overflow-hidden border bg-white" style={{ borderColor: '#d0d0d0' }}>
          <div
            className="px-3 py-2 text-[14px] font-bold text-white"
            style={{ backgroundColor: AT_BLUE }}
          >
            Documentos emitidos / importados
          </div>
          <div className="p-3">
            {loading ? (
              <p className="text-sm text-slate-500">A carregar…</p>
            ) : listItems.length === 0 ? (
              <p className="text-sm text-slate-500">
                Ainda sem documentos. Gere um rascunho (Emitir PDF) ou importe o CSV da AT.
              </p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between gap-2 text-[12px] text-slate-500">
                  <span>
                    {listItems.length} documento(s) · página {page}/{totalPages}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 disabled:opacity-40"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 disabled:opacity-40"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Seguinte
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[13px]">
                    <thead>
                      <tr className="text-left text-[#777]">
                        <th className="pb-2 font-medium">Referência</th>
                        <th className="pb-2 font-medium">Situação</th>
                        <th className="pb-2 font-medium">Data de Prestação</th>
                        <th className="pb-2 text-right font-medium">Total c/ Impostos</th>
                        <th className="pb-2 text-right font-medium">Ações</th>
                      </tr>
                      <tr>
                        <td colSpan={5} className="h-px" style={{ backgroundColor: AT_BLUE }} />
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((item) => (
                        <tr key={item.key} className="border-b border-slate-100">
                          <td className="py-3 pr-2 align-top">
                            <p className="font-bold" style={{ color: AT_BLUE }}>
                              {item.referencia}
                            </p>
                            <p className="font-bold uppercase text-[#333]">{item.tipoDocumento}</p>
                            <p className="text-[#333]">{item.clienteNome}</p>
                          </td>
                          <td className="py-3 pr-2 align-top">
                            <span
                              className={`inline-flex rounded px-2 py-0.5 text-[11px] font-bold uppercase ${
                                item.situacao === 'pago'
                                  ? 'border border-green-500 text-green-700'
                                  : item.situacao === 'rascunho'
                                    ? 'border border-amber-400 text-amber-700'
                                    : 'border border-green-500 text-green-700'
                              }`}
                            >
                              {item.situacao === 'pago'
                                ? 'Pago'
                                : item.situacao === 'rascunho'
                                  ? 'Rascunho'
                                  : 'Emitido'}
                            </span>
                          </td>
                          <td className="py-3 pr-2 align-top whitespace-nowrap">
                            {formatDateIso(item.dataPrestacao)}
                          </td>
                          <td className="py-3 pr-2 align-top text-right tabular-nums">
                            {item.totalLabel}
                          </td>
                          <td className="relative py-3 align-top text-right">
                            <div className="inline-flex overflow-hidden rounded border bg-[#f7f7f7]" style={{ borderColor: '#ccc' }}>
                              <button
                                type="button"
                                className="px-3 py-1 text-[12px] font-semibold uppercase"
                                onClick={() => setOpenMenu(openMenu === item.key ? null : item.key)}
                              >
                                Ver
                              </button>
                              <button
                                type="button"
                                className="border-l px-1.5 py-1"
                                style={{ borderColor: '#ccc' }}
                                onClick={() => setOpenMenu(openMenu === item.key ? null : item.key)}
                              >
                                <ChevronDown size={14} />
                              </button>
                            </div>
                            {openMenu === item.key ? (
                              <div
                                className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded border bg-white text-left shadow-lg"
                                style={{ borderColor: '#ccc' }}
                              >
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-slate-50"
                                  onClick={() => {
                                    setOpenMenu(null);
                                    reutilizar(item);
                                  }}
                                >
                                  <RefreshCw size={12} /> Reutilizar
                                </button>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-slate-50"
                                  onClick={() => {
                                    setOpenMenu(null);
                                    emailDoc(item);
                                  }}
                                >
                                  <Mail size={12} /> Email
                                </button>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-slate-50"
                                  onClick={() => {
                                    setOpenMenu(null);
                                    void imprimir(item);
                                  }}
                                >
                                  <Printer size={12} /> Imprimir
                                </button>
                                {item.situacao !== 'pago' ? (
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-slate-50"
                                    onClick={() => {
                                      setOpenMenu(null);
                                      void markPago(item);
                                    }}
                                  >
                                    <CheckCircle2 size={12} /> Pago
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
