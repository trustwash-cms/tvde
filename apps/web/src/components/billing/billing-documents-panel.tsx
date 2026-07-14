'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Copy, FileDown, Mail, Pencil, Trash2 } from 'lucide-react';
import {
  BILLING_DOCUMENT_TYPES,
  getBillingDocumentEditPath,
  getDocumentTypeLabel,
  type MoloniDocumentType,
} from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getApiUrl, getStoredToken } from '@/lib/api';
import { withSearchQuery } from '@/lib/list-search';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import ListPageSearch from '@/components/list-page-search';
import { ListPagination } from '@/components/list-pagination';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface Invoice {
  id: string;
  number: string;
  status: string;
  documentType: MoloniDocumentType;
  externalId: string | null;
  total: string;
  issuedAt: string | null;
  createdAt: string;
  emailSentAt: string | null;
  client: { id: string; name: string; nif: string | null; email: string | null } | null;
  billingEntity: { id: string; name: string; vat: string | null; email: string | null } | null;
}

interface InvoiceListResult {
  items: Invoice[];
  total: number;
  page: number;
  limit: number;
}

interface MoloniStatus {
  configured: boolean;
  connected: boolean;
  healthy: boolean;
  statusMessage: string;
}

function partyName(inv: Invoice) {
  return inv.billingEntity?.name ?? inv.client?.name ?? '—';
}

function invoiceRecipientEmail(inv: Invoice): string | null {
  const email = inv.billingEntity?.email?.trim() || inv.client?.email?.trim();
  return email || null;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    issued: 'bg-green-100 text-green-800',
    paid: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
  };
  return map[status] ?? 'bg-slate-100 text-slate-700';
}

function formatInvoiceDate(issuedAt: string | null, createdAt: string) {
  const value = issuedAt ?? createdAt;
  return new Date(value).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function canDuplicate(inv: Invoice): boolean {
  return (
    (inv.status === 'issued' || inv.status === 'paid') &&
    Boolean(inv.billingEntity || inv.client)
  );
}

export function BillingDocumentsPanel({
  documentTypeFilter,
}: {
  /** Quando definido, lista só esse tipo (legado por página de venda). */
  documentTypeFilter?: MoloniDocumentType;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get('q');
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const { confirm, confirmDialog } = useConfirmDialog();

  const [typeFilter, setTypeFilter] = useState<MoloniDocumentType | ''>(documentTypeFilter ?? '');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [moloni, setMoloni] = useState<MoloniStatus | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const effectiveType = documentTypeFilter ?? (typeFilter || undefined);
  const showTypeColumn = !documentTypeFilter;
  const draftCount = invoices.filter((i) => i.status === 'draft').length;

  const loadInvoices = useCallback(() => {
    if (!workspaceId) return;
    const token = getStoredToken();
    apiFetch<InvoiceListResult>(
      withWorkspaceQuery(
        withSearchQuery(API_PATHS.invoices.list, q),
        workspaceId,
        {
          ...(effectiveType ? { documentType: effectiveType } : {}),
          page: String(page),
          limit: String(limit),
        }
      ),
      {},
      token
    ).then((res) => {
      if (res.data) {
        setInvoices(res.data.items);
        setInvoiceTotal(res.data.total);
      } else if (res.error) setError(res.error);
    });
  }, [workspaceId, q, effectiveType, page, limit]);

  useEffect(() => {
    setPage(0);
  }, [q, workspaceId, effectiveType]);

  useEffect(() => {
    if (!workspaceId) return;
    apiFetch<MoloniStatus>(
      withWorkspaceQuery(API_PATHS.billing.moloniStatus, workspaceId, { probe: '1' }),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setMoloni(res.data);
    });
  }, [workspaceId]);

  useEffect(() => {
    setError('');
    loadInvoices();
  }, [loadInvoices]);

  async function issueInvoice(id: string, documentType: MoloniDocumentType) {
    const label = getDocumentTypeLabel(documentType);
    const ok = await confirm({
      title: 'Emitir documento',
      message: `Emitir este documento (${label}) no Moloni?`,
    });
    if (!ok) return;
    setError('');
    setLoading(true);
    const res = await apiFetch(API_PATHS.invoices.issue(id), { method: 'POST' }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess('Documento emitido no Moloni');
      loadInvoices();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function duplicateDocument(inv: Invoice) {
    if (!workspaceId) return;
    setError('');
    setSuccess('');
    setDuplicatingId(inv.id);
    const res = await apiFetch<{ id: string; documentType: MoloniDocumentType }>(
      API_PATHS.invoices.duplicate(inv.id),
      { method: 'POST' },
      getStoredToken()
    );
    setDuplicatingId(null);
    if (res.success && res.data?.id) {
      router.push(getBillingDocumentEditPath(res.data.documentType, res.data.id));
      return;
    }
    setError(getApiErrorMessage(res));
  }

  async function deleteDraft(inv: Invoice) {
    const ok = await confirm({
      title: 'Apagar rascunho',
      message: `Apagar o rascunho ${inv.number}? Esta acção não pode ser desfeita.`,
    });
    if (!ok) return;
    setError('');
    setSuccess('');
    setDeletingId(inv.id);
    const res = await apiFetch(API_PATHS.invoices.byId(inv.id), { method: 'DELETE' }, getStoredToken());
    setDeletingId(null);
    if (res.success) {
      setSuccess('Rascunho apagado');
      loadInvoices();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function downloadPdf(id: string) {
    setError('');
    const token = getStoredToken();
    try {
      const res = await fetch(`${getApiUrl()}${API_PATHS.invoices.pdf(id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(err?.error ?? `Erro HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      if (!blob.type.includes('pdf') && !(await blob.slice(0, 5).text()).startsWith('%PDF')) {
        setError('O Moloni não devolveu um PDF válido');
        return;
      }
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `documento-${id}.pdf`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Falha ao descarregar o PDF');
    }
  }

  async function sendInvoiceEmail(inv: Invoice) {
    const to = invoiceRecipientEmail(inv);
    if (!to) return;

    if (inv.emailSentAt) {
      const ok = await confirm({
        title: 'Reenviar email',
        message: 'Esta fatura já foi enviada por email. Deseja reenviar?',
      });
      if (!ok) return;
    }

    setError('');
    setSuccess('');
    setSendingEmailId(inv.id);
    const res = await apiFetch<{ id: string; emailSentAt: string }>(
      API_PATHS.invoices.sendEmail(inv.id),
      { method: 'POST' },
      getStoredToken()
    );
    setSendingEmailId(null);

    if (res.success && res.data?.emailSentAt) {
      setInvoices((prev) =>
        prev.map((row) =>
          row.id === inv.id ? { ...row, emailSentAt: res.data!.emailSentAt } : row
        )
      );
      setSuccess(res.message ?? 'Documento enviado por email');
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

      <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />

      {!wsLoading && !workspaceId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seleccione um workspace.
        </div>
      )}

      <section className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Documentos</h2>
            <p className="text-sm text-slate-500">
              {invoiceTotal} documento{invoiceTotal === 1 ? '' : 's'}
              {draftCount > 0 ? ` · ${draftCount} rascunho${draftCount > 1 ? 's' : ''} nesta página` : ''}
            </p>
          </div>
          {showTypeColumn && (
            <select
              className="input max-w-xs text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as MoloniDocumentType | '')}
            >
              <option value="">Todos os tipos</option>
              {BILLING_DOCUMENT_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <ListPageSearch placeholder="Pesquisar documentos…" />

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3">Número</th>
                {showTypeColumn && <th className="px-4 py-3">Tipo</th>}
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{inv.number}</td>
                  {showTypeColumn && (
                    <td className="px-4 py-3 text-slate-600">
                      {getDocumentTypeLabel(inv.documentType)}
                    </td>
                  )}
                  <td className="px-4 py-3">{partyName(inv)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatInvoiceDate(inv.issuedAt, inv.createdAt)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{Number(inv.total).toFixed(2)} €</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge(inv.status)}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      {inv.status !== 'draft' && inv.externalId && invoiceRecipientEmail(inv) && (
                        <button
                          type="button"
                          className={`rounded-lg border p-2 transition disabled:opacity-50 ${
                            inv.emailSentAt
                              ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                              : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100'
                          }`}
                          title={
                            inv.emailSentAt
                              ? `Reenviar por email (${invoiceRecipientEmail(inv)})`
                              : `Enviar por email (${invoiceRecipientEmail(inv)})`
                          }
                          disabled={loading || sendingEmailId === inv.id}
                          onClick={() => void sendInvoiceEmail(inv)}
                        >
                          <Mail size={14} />
                        </button>
                      )}
                      {canDuplicate(inv) && (
                        <button
                          type="button"
                          className="btn-secondary p-2"
                          title="Duplicar como rascunho"
                          disabled={loading || duplicatingId === inv.id}
                          onClick={() => void duplicateDocument(inv)}
                        >
                          <Copy size={14} />
                        </button>
                      )}
                      {inv.status !== 'draft' && inv.externalId && (
                        <button
                          type="button"
                          className="btn-secondary p-2"
                          title="Descarregar PDF"
                          onClick={() => void downloadPdf(inv.id)}
                        >
                          <FileDown size={14} />
                        </button>
                      )}
                      {inv.status === 'draft' && (
                        <>
                          <Link
                            href={getBillingDocumentEditPath(inv.documentType, inv.id)}
                            className="btn-secondary p-2"
                            title="Editar rascunho"
                          >
                            <Pencil size={14} />
                          </Link>
                          {moloni?.healthy && (
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              disabled={loading || deletingId === inv.id}
                              onClick={() => void issueInvoice(inv.id, inv.documentType)}
                            >
                              Emitir
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                            title="Apagar rascunho"
                            disabled={loading || deletingId === inv.id}
                            onClick={() => void deleteDraft(inv)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoices.length === 0 && workspaceId && (
            <p className="px-4 py-8 text-sm text-slate-500">Sem documentos.</p>
          )}
        </div>

        <ListPagination
          page={page}
          limit={limit}
          total={invoiceTotal}
          onPageChange={setPage}
          onLimitChange={setLimit}
        />
      </section>
    </div>
  );
}
