'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { BillingBreadcrumb } from '@/components/billing/billing-breadcrumb';
import { ListPagination } from '@/components/list-pagination';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface ProductCategory {
  category_id: number;
  parent_id: number;
  name: string;
  description?: string;
  num_categories?: number;
  num_products?: number;
}

interface CategoryListResult {
  items: ProductCategory[];
  total: number;
  page: number;
  limit: number;
}

export function BillingCategoriesPanel() {
  const searchParams = useSearchParams();
  const parentId = Number(searchParams.get('parentId') ?? 0) || 0;
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspaceContext();

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [parentCategory, setParentCategory] = useState<ProductCategory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductCategory | null>(null);
  const [form, setForm] = useState({ name: '', description: '', posEnabled: true });
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(() => {
    if (!workspaceId) return;
    apiFetch<CategoryListResult>(
      withWorkspaceQuery(API_PATHS.billing.productCategories, workspaceId, {
        parentId: String(parentId),
        q: search || undefined,
        page: String(page),
        limit: String(limit),
      }),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) {
        setCategories(res.data.items);
        setTotal(res.data.total);
      } else if (res.error) setError(res.error);
    });
  }, [workspaceId, parentId, search, page, limit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!workspaceId || parentId <= 0) {
      setParentCategory(null);
      return;
    }
    apiFetch<ProductCategory>(
      withWorkspaceQuery(API_PATHS.billing.productCategoryById(parentId), workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setParentCategory(res.data);
    });
  }, [workspaceId, parentId]);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '', posEnabled: true });
    setModalOpen(true);
  }

  function openEdit(cat: ProductCategory) {
    setEditing(cat);
    setForm({
      name: cat.name,
      description: cat.description ?? '',
      posEnabled: true,
    });
    setModalOpen(true);
  }

  async function saveCategory(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    const payload = {
      workspaceId,
      parentId,
      name: form.name,
      description: form.description,
      posEnabled: form.posEnabled,
    };
    const res = editing
      ? await apiFetch(
          API_PATHS.billing.productCategoryById(editing.category_id),
          { method: 'PATCH', body: JSON.stringify(payload) },
          getStoredToken()
        )
      : await apiFetch(API_PATHS.billing.productCategories, {
          method: 'POST',
          body: JSON.stringify(payload),
        }, getStoredToken());
    setLoading(false);
    if (res.success) {
      setSuccess(editing ? 'Categoria actualizada' : 'Categoria criada');
      setModalOpen(false);
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  async function removeCategory(cat: ProductCategory) {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Eliminar categoria',
      message: `Eliminar a categoria «${cat.name}»? Os artigos passam para a categoria órfã no Moloni.`,
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.productCategoryById(cat.category_id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Categoria eliminada');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  const breadcrumbItems =
    parentId > 0 && parentCategory
      ? [{ label: 'Categorias de artigos' }, { label: parentCategory.name }]
      : [{ label: 'Categorias de artigos' }];

  return (
    <div className="space-y-4">
      {confirmDialog}
      <BillingBreadcrumb items={breadcrumbItems} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {parentId > 0 && parentCategory
              ? `Subcategorias de ${parentCategory.name}`
              : 'Categorias de artigos'}
          </h2>
          <p className="text-sm text-slate-500">
            Nesta secção pode administrar as categorias de artigos no Moloni.
          </p>
        </div>
        <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {success && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{success}</p>
      )}

      <section className="card space-y-4">
        <form
          className="flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setSearch(searchInput.trim());
          }}
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-600">Pesquisa simples</label>
            <input
              className="input"
              placeholder="Insira palavras para pesquisar"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-secondary">
            Pesquisar
          </button>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={openCreate} disabled={!workspaceId}>
            <Plus size={16} />
            Nova categoria
          </button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3">Categorias disponíveis</th>
                <th className="px-4 py-3">Editar</th>
                <th className="px-4 py-3">Admin. categorias</th>
                <th className="px-4 py-3">Admin. artigos</th>
                <th className="px-4 py-3">Eliminar</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat.category_id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-800">{cat.name}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-[var(--color-primary)] hover:underline"
                      onClick={() => openEdit(cat)}
                    >
                      Editar
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`${WEB_ROUTES.dashboard.billing.produtosCategorias}?parentId=${cat.category_id}`}
                      className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"
                    >
                      <FolderTree size={14} />
                      Admin. categorias
                      {(cat.num_categories ?? 0) > 0 ? ` ${cat.num_categories}` : ''}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={WEB_ROUTES.dashboard.billing.produtosCategoriaArtigos(cat.category_id)}
                      className="text-[var(--color-primary)] hover:underline"
                    >
                      Admin. artigos
                      {(cat.num_products ?? 0) > 0 ? cat.num_products : ''}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-red-600 hover:underline"
                      onClick={() => void removeCategory(cat)}
                      disabled={loading}
                    >
                      <Trash2 size={14} />
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {!categories.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Nenhuma categoria encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ListPagination
          page={page}
          limit={limit}
          total={total}
          onPageChange={setPage}
          onLimitChange={setLimit}
        />
      </section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar categoria' : 'Nova categoria'}>
        <form onSubmit={(e) => void saveCategory(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-600">Nome *</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">Descrição</label>
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.posEnabled}
              onChange={(e) => setForm({ ...form, posEnabled: e.target.checked })}
            />
            Activar no POS
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              Guardar
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
