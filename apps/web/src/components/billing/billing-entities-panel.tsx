'use client';

import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  CloudUpload,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { WEB_ROUTES, BILLING_ENTITY_TYPES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import ListPageSearch from '@/components/list-page-search';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { formatDisplayPhone, normalizePhone } from '@/lib/phone-format';
import {
  BillingEntityFormFields,
  billingEntityFormPayload,
  emptyEntityForm,
  entityFormFromRecord,
  validateEntityForm,
  type BillingEntityFormValues,
} from '@/components/billing/billing-entity-form';

interface BillingEntity {
  id: string;
  name: string;
  vat: string | null;
  email: string | null;
  phone: string | null;
  addressJson?: unknown;
  entityType: string;
  externalId: string | null;
  linkStatus: string;
  syncStatus: string;
  status: string;
  cmsClient: { id: string; name: string; nif: string | null } | null;
  conflicts: Array<{ id: string; field: string }>;
  _count?: { invoices: number };
}

interface BillingConflict {
  id: string;
  field: string;
  cmsValue: string | null;
  moloniValue: string | null;
  status: string;
  entity: { id: string; name: string; entityType: string; vat: string | null };
}

interface CmsClient {
  id: string;
  name: string;
  nif: string | null;
}

function IconActionButton({
  label,
  onClick,
  disabled,
  variant = 'default',
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  children: ReactNode;
}) {
  const styles = {
    default: 'text-slate-600 hover:bg-slate-100',
    primary: 'text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]',
    danger: 'text-red-600 hover:bg-red-50',
  };

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg p-2 transition disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export function BillingEntitiesPanel() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q')?.trim() ?? '';
  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();
  const [entities, setEntities] = useState<BillingEntity[]>([]);
  const [conflicts, setConflicts] = useState<BillingConflict[]>([]);
  const [cmsClients, setCmsClients] = useState<CmsClient[]>([]);
  const [activeTab, setActiveTab] = useState<'customer' | 'supplier'>('customer');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmEntity, setConfirmEntity] = useState<BillingEntity | null>(null);
  const [editEntity, setEditEntity] = useState<BillingEntity | null>(null);
  const [editForm, setEditForm] = useState<BillingEntityFormValues>(emptyEntityForm());
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<BillingEntityFormValues>(emptyEntityForm());
  const [pushOnCreate, setPushOnCreate] = useState(true);
  const [selectedCmsClientId, setSelectedCmsClientId] = useState('');
  const { confirm, confirmDialog } = useConfirmDialog();

  function load() {
    if (!workspaceId) return;
    const token = getStoredToken();

    apiFetch<BillingEntity[]>(
      withWorkspaceQuery(API_PATHS.billing.entities, workspaceId, {
        entityType: activeTab,
        status: showArchived ? 'all' : 'active',
        q: q.length >= 2 ? q : undefined,
      }),
      {},
      token
    ).then((res) => {
      if (res.data) setEntities(res.data);
    });

    apiFetch<BillingConflict[]>(
      withWorkspaceQuery(API_PATHS.billing.conflicts, workspaceId),
      {},
      token
    ).then((res) => {
      if (res.data) setConflicts(res.data);
    });

    apiFetch<CmsClient[]>(withWorkspaceQuery(API_PATHS.clients.list, workspaceId), {}, token).then(
      (res) => {
        if (res.data) setCmsClients(res.data);
      }
    );

  }

  useEffect(() => {
    setError('');
    load();
  }, [workspaceId, activeTab, showArchived, q]);

  async function purgeArchived() {
    if (!workspaceId) return;
    const n = filtered.filter((e) => e.status === 'archived').length;
    const ok = await confirm({
      title: 'Eliminar arquivadas',
      message: `Eliminar ${n} entidade(s) arquivada(s) do CMS? Não apaga no Moloni. Use isto para remover dados de teste importados por engano.`,
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.purgeArchived, workspaceId, { entityType: activeTab }),
      { method: 'POST' },
      token
    );
    setLoading(false);
    if (res.success) {
      setSuccess(res.message ?? 'Arquivadas removidas do CMS');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function archiveOne(id: string, name: string) {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Arquivar entidade',
      message: `Arquivar «${name}»? Oculta da app; não apaga no Moloni.`,
    });
    if (!ok) return;
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.entityArchive(id), workspaceId),
      { method: 'POST' },
      token
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Entidade arquivada');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function restoreOne(id: string) {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.entityRestore(id), workspaceId),
      { method: 'POST' },
      token
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Entidade restaurada');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function deleteOne(id: string, name: string) {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Eliminar entidade',
      message: `Eliminar «${name}» do CMS? Só é possível sem facturas emitidas. O registo no Moloni não é apagado.`,
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.entityById(id), workspaceId),
      { method: 'DELETE' },
      token
    );
    setLoading(false);
    if (res.success) {
      setSuccess(res.message ?? 'Entidade eliminada');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function confirmLink() {
    if (!workspaceId || !confirmEntity || !selectedCmsClientId) return;
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.entityConfirmLink(confirmEntity.id), workspaceId),
      {
        method: 'POST',
        body: JSON.stringify({ cmsClientId: selectedCmsClientId, workspaceId }),
      },
      token
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Ligação confirmada');
      setConfirmEntity(null);
      setSelectedCmsClientId('');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function pushToMoloni(entity: BillingEntity) {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.entityPush(entity.id), workspaceId),
      { method: 'POST' },
      token
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Dados enviados ao Moloni');
      setEditEntity(null);
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  function openCreate() {
    setCreateForm(emptyEntityForm());
    setPushOnCreate(true);
    setCreateOpen(true);
    setError('');
  }

  async function saveCreate() {
    if (!workspaceId) return;
    const validationError = validateEntityForm(createForm);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const payload = billingEntityFormPayload(createForm, activeTab);
    const res = await apiFetch(
      API_PATHS.billing.entities,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          ...payload,
          phone: normalizePhone(payload.phone),
          pushToMoloni: pushOnCreate,
        }),
      },
      token
    );
    setLoading(false);
    if (res.success) {
      setCreateOpen(false);
      setSuccess(
        pushOnCreate
          ? `${entityMeta?.label ?? 'Entidade'} criado e enviado ao Moloni`
          : res.message ?? `${entityMeta?.label ?? 'Entidade'} criado`
      );
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || !editEntity) return;
    const validationError = validateEntityForm(editForm);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const payload = billingEntityFormPayload(editForm, activeTab);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.entityById(editEntity.id), workspaceId),
      {
        method: 'PATCH',
        body: JSON.stringify({
          workspaceId,
          ...payload,
          phone: normalizePhone(payload.phone),
        }),
      },
      token
    );
    setLoading(false);
    if (res.success) {
      const updated = res.data as BillingEntity | undefined;
      const needsPush = updated?.syncStatus === 'pending_push' && updated?.externalId;
      setSuccess(
        needsPush
          ? 'Guardado no CMS — clique «Enviar ao Moloni» para actualizar lá.'
          : 'Dados actualizados'
      );
      if (needsPush && updated) {
        setEditEntity({ ...editEntity, ...updated, syncStatus: 'pending_push' });
      } else {
        setEditEntity(null);
      }
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function resolveConflict(conflictId: string, resolution: 'cms' | 'moloni' | 'dismiss') {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    const token = getStoredToken();
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.conflictResolve(conflictId), workspaceId),
      {
        method: 'POST',
        body: JSON.stringify({ resolution, workspaceId }),
      },
      token
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Conflito resolvido');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  function openConfirm(entity: BillingEntity) {
    setConfirmEntity(entity);
    const match = cmsClients.find(
      (c) => entity.vat && c.nif && c.nif.replace(/\s/g, '') === entity.vat.replace(/\s/g, '')
    );
    setSelectedCmsClientId(match?.id ?? entity.cmsClient?.id ?? '');
  }

  function openEdit(entity: BillingEntity) {
    setEditEntity(entity);
    const base = entityFormFromRecord(entity);
    setEditForm({ ...base, phone: formatDisplayPhone(entity.phone) });
  }

  function entityHasIssuedInvoices(entity: BillingEntity): boolean {
    return (entity._count?.invoices ?? 0) > 0;
  }

  const entityMeta = BILLING_ENTITY_TYPES.find((e) => e.id === activeTab);
  const filtered = entities.filter((e) => e.entityType === activeTab);
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

      {conflicts.length > 0 && (
        <section className="card space-y-3 border-amber-200 bg-amber-50/50">
          <h3 className="text-sm font-semibold text-amber-900">Conflitos abertos ({conflicts.length})</h3>
          <div className="space-y-2">
            {conflicts.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{c.entity.name}</span>
                  <span className="text-slate-500"> · {c.field}</span>
                  <div className="text-xs text-slate-500">
                    CRM: {c.cmsValue ?? '—'} · Moloni: {c.moloniValue ?? '—'}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={() => resolveConflict(c.id, 'cms')}>Usar CRM</button>
                  <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={() => resolveConflict(c.id, 'moloni')}>Usar Moloni</button>
                  <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={() => resolveConflict(c.id, 'dismiss')}>Ignorar</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Entidades de facturação</h2>
          <p className="text-sm text-slate-500">
            Clientes e fornecedores fiscais (Moloni) — estrutura própria, independente do módulo{' '}
            <Link href={WEB_ROUTES.dashboard.clients} className="text-[var(--color-primary)] underline">
              Clientes
            </Link>{' '}
            (CRM). Crie clientes ao emitir faturas ou importe do Moloni em{' '}
            <Link href={WEB_ROUTES.dashboard.settings.moloni} className="text-[var(--color-primary)] underline">
              Configurações → Moloni
            </Link>
            . Arquivar ou eliminar aqui só afecta o CMS, não o Moloni.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap gap-2">
            {BILLING_ENTITY_TYPES.map((e) => (
              <button
                key={e.id}
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  activeTab === e.id
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
                onClick={() => setActiveTab(e.id)}
              >
                {e.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-1.5 text-sm"
              disabled={!workspaceId || loading}
              onClick={openCreate}
            >
              <Plus size={16} />
              Novo {activeTab === 'customer' ? 'cliente' : 'fornecedor'}
            </button>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Mostrar arquivados
            </label>
            {showArchived && filtered.some((e) => e.status === 'archived') && (
              <button
                type="button"
                className="btn-secondary text-xs text-red-700"
                disabled={loading}
                onClick={purgeArchived}
              >
                Eliminar arquivadas do CMS
              </button>
            )}
          </div>
        </div>

        <ListPageSearch placeholder="Pesquisar por nome, email, NIF ou telefone…" />

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">NIF</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Acções</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  className={`border-b last:border-0 ${e.status === 'archived' ? 'bg-slate-50 opacity-70' : ''}`}
                >
                  <td className="px-4 py-3">
                    {e.name}
                    {e.status === 'archived' && (
                      <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase">Arquivado</span>
                    )}
                    {e.status === 'active' && e.syncStatus === 'pending_push' && e.externalId && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                        Pendente Moloni
                      </span>
                    )}
                    {e.linkStatus === 'pending_confirm' && e.status === 'active' && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                        Confirmar NIF
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{e.vat ?? '—'}</td>
                  <td className="px-4 py-3">{e.email ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDisplayPhone(e.phone) || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="inline-flex flex-nowrap items-center gap-0.5">
                      {e.linkStatus === 'pending_confirm' && e.status === 'active' && (
                        <IconActionButton label="Confirmar ligação CRM" onClick={() => openConfirm(e)}>
                          <Link2 size={16} />
                        </IconActionButton>
                      )}
                      {e.status === 'active' && e.syncStatus === 'pending_push' && e.externalId && (
                        <IconActionButton
                          label="Enviar ao Moloni"
                          variant="primary"
                          disabled={loading}
                          onClick={() => pushToMoloni(e)}
                        >
                          <CloudUpload size={16} />
                        </IconActionButton>
                      )}
                      {e.status === 'active' && (
                        <>
                          <IconActionButton label="Editar" onClick={() => openEdit(e)}>
                            <Pencil size={16} />
                          </IconActionButton>
                          <IconActionButton label="Arquivar" onClick={() => archiveOne(e.id, e.name)}>
                            <Archive size={16} />
                          </IconActionButton>
                          {e.linkStatus === 'unlinked' && (
                            <IconActionButton
                              label="Eliminar"
                              variant="danger"
                              onClick={() => deleteOne(e.id, e.name)}
                            >
                              <Trash2 size={16} />
                            </IconActionButton>
                          )}
                        </>
                      )}
                      {e.status === 'archived' && (
                        <IconActionButton label="Restaurar" onClick={() => restoreOne(e.id)}>
                          <ArchiveRestore size={16} />
                        </IconActionButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && workspaceId && (
            <p className="px-4 py-8 text-sm text-slate-500">
              {q.length >= 2
                ? `Nenhum resultado para «${q}».`
                : showArchived
                  ? 'Sem entidades neste separador.'
                  : `Sem ${activeTab === 'customer' ? 'clientes' : 'fornecedores'} activos — clique «Novo ${activeTab === 'customer' ? 'cliente' : 'fornecedor'}» ou importe do Moloni.`}
            </p>
          )}
        </div>
      </section>

      {confirmEntity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Confirmar ligação por NIF</h3>
            <p className="text-sm text-slate-600">
              Entidade Moloni <strong>{confirmEntity.name}</strong>
              {confirmEntity.vat ? ` (${confirmEntity.vat})` : ''}
            </p>
            <select className="input" value={selectedCmsClientId} onChange={(ev) => setSelectedCmsClientId(ev.target.value)}>
              <option value="">Seleccionar cliente CRM</option>
              {cmsClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.nif ? ` (${c.nif})` : ''}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setConfirmEntity(null); setSelectedCmsClientId(''); }}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" disabled={!selectedCmsClientId || loading} onClick={confirmLink}>
                Confirmar ligação
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Novo ${activeTab === 'customer' ? 'cliente' : 'fornecedor'}`}
        panelClassName="max-w-2xl"
      >
        <p className="mb-4 text-sm text-slate-500">
          Campos alinhados com o Moloni (geral + contactos). O código interno Moloni é atribuído ao
          enviar.
        </p>
        <BillingEntityFormFields
          form={createForm}
          onChange={setCreateForm}
          disabled={loading}
        />
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={pushOnCreate}
            onChange={(e) => setPushOnCreate(e.target.checked)}
            disabled={loading}
          />
          Enviar ao Moloni após criar
        </label>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" disabled={loading} onClick={() => void saveCreate()}>
            {loading ? 'A guardar…' : 'Criar'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!editEntity}
        onClose={() => setEditEntity(null)}
        title="Editar entidade"
        panelClassName="max-w-2xl"
      >
        {editEntity && (
          <form className="space-y-4" onSubmit={saveEdit}>
            <BillingEntityFormFields
              form={editForm}
              onChange={setEditForm}
              vatReadOnly={entityHasIssuedInvoices(editEntity)}
              disabled={loading}
            />
            {entityHasIssuedInvoices(editEntity) && (
              <p className="text-xs text-slate-500">NIF bloqueado — já existem faturas emitidas.</p>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" className="btn-secondary" onClick={() => setEditEntity(null)}>
                Cancelar
              </button>
              {editEntity.externalId && editEntity.syncStatus === 'pending_push' && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={loading}
                  onClick={() => pushToMoloni(editEntity)}
                >
                  Enviar ao Moloni
                </button>
              )}
              <button type="submit" className="btn-secondary" disabled={loading}>
                Guardar
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
