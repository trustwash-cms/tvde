'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { WEB_ROUTES, type CatalogImportResult } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { BillingBreadcrumb } from '@/components/billing/billing-breadcrumb';
import { ListPagination } from '@/components/list-pagination';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { CatalogCsvImport } from '@/components/catalog-csv-import';

interface ProductCategory {
  category_id: number;
  name: string;
  parent_id?: number;
}

interface MoloniProduct {
  product_id: number;
  name: string;
  reference?: string;
  price?: number;
  vatAmount?: number;
  grossPrice?: number;
  stock?: number;
  measurement_unit?: { short_name?: string };
}

interface ProductListResult {
  items: MoloniProduct[];
  total: number;
  page: number;
  limit: number;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
}

export function BillingCategoryArticlesPanel({ categoryId }: { categoryId: number }) {
  const router = useRouter();
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspaceContext();

  const [category, setCategory] = useState<ProductCategory | null>(null);
  const [products, setProducts] = useState<MoloniProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(() => {
    if (!workspaceId) return;
    apiFetch<ProductListResult>(
      withWorkspaceQuery(API_PATHS.billing.productCategoryProducts(categoryId), workspaceId, {
        q: search || undefined,
        page: String(page),
        limit: String(limit),
      }),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) {
        setProducts(res.data.items);
        setTotal(res.data.total);
      } else if (res.error) setError(res.error);
    });
  }, [workspaceId, categoryId, search, page, limit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!workspaceId) return;
    apiFetch<ProductCategory>(
      withWorkspaceQuery(API_PATHS.billing.productCategoryById(categoryId), workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setCategory(res.data);
    });
  }, [workspaceId, categoryId]);

  async function duplicateProduct(productId: number) {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    const res = await apiFetch(
      API_PATHS.billing.moloniProductDuplicate(productId),
      { method: 'POST', body: JSON.stringify({ workspaceId }) },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Artigo duplicado');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  function handleImported(result: CatalogImportResult) {
    setError('');
    const errorPreview = result.errors
      .slice(0, 3)
      .map((item) => `Linha ${item.line}: ${item.message}`)
      .join(' · ');
    if (result.created > 0) {
      setSuccess(
        `Importados ${result.created} artigo(s)${result.failed ? ` · ${result.failed} com erro` : ''}.`
      );
      load();
    } else {
      setSuccess('');
    }
    if (result.failed > 0) {
      setError(errorPreview || `Nenhum artigo importado (${result.failed} linhas com erro).`);
    }
  }

  async function removeProduct(product: MoloniProduct) {
    if (!workspaceId) return;
    const ok = await confirm({
      title: 'Eliminar artigo',
      message: `Eliminar o artigo «${product.name}»?`,
      variant: 'danger',
    });
    if (!ok) return;
    setLoading(true);
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.moloniProductById(product.product_id), workspaceId),
      { method: 'DELETE' },
      getStoredToken()
    );
    setLoading(false);
    if (res.success) {
      setSuccess('Artigo eliminado');
      load();
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  const breadcrumbItems = useMemo(() => {
    const items: Array<{ label: string; href?: string }> = [
      { label: 'Categorias de artigos', href: WEB_ROUTES.dashboard.billing.produtosCategorias },
    ];
    if (category) {
      items.push({ label: `[${category.name}]`, href: WEB_ROUTES.dashboard.billing.produtosCategoriaArtigos(categoryId) });
    }
    items.push({ label: 'Artigos' });
    return items;
  }, [category, categoryId]);

  return (
    <div className="space-y-4">
      {confirmDialog}
      <BillingBreadcrumb items={breadcrumbItems} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Artigos de {category?.name ?? '…'}
          </h2>
          <p className="text-sm text-slate-500">
            Nesta secção pode administrar os artigos na categoria {category?.name ?? ''}.
            Importação em lote via CSV (no Excel: Guardar como → CSV UTF-8).
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
          <CatalogCsvImport
            workspaceId={workspaceId}
            uploadPath={API_PATHS.billing.productCategoryProductsImport(categoryId)}
            templateFileName="artigos-faturacao-modelo.csv"
            disabled={loading}
            onImported={handleImported}
            onError={setError}
          />
          <Link
            href={WEB_ROUTES.dashboard.billing.produtosCategoriaArtigoNovo(categoryId)}
            className="btn-primary inline-flex items-center gap-1.5"
          >
            <Plus size={16} />
            Novo artigo
          </Link>
        </form>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-3">Designação</th>
                <th className="px-3 py-3">Referência</th>
                <th className="px-3 py-3 whitespace-nowrap">Preço sem IVA</th>
                <th className="px-3 py-3 whitespace-nowrap">Valor IVA</th>
                <th className="px-3 py-3 whitespace-nowrap">Preço c/ impostos</th>
                <th className="px-3 py-3">Stock</th>
                <th className="px-3 py-3">Unidade</th>
                <th className="px-3 py-3">Editar</th>
                <th className="px-3 py-3">Duplicar</th>
                <th className="px-3 py-3">Eliminar</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_id} className="border-b last:border-0">
                  <td className="px-3 py-3">{p.name}</td>
                  <td className="px-3 py-3 font-mono text-xs">{p.reference ?? '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatMoney(p.price ?? 0)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatMoney(p.vatAmount ?? 0)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{formatMoney(p.grossPrice ?? p.price ?? 0)}</td>
                  <td className="px-3 py-3">{p.stock != null && p.stock > 0 ? p.stock : '---'}</td>
                  <td className="px-3 py-3">{p.measurement_unit?.short_name ?? 'Uni.'}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"
                      onClick={() =>
                        router.push(
                          WEB_ROUTES.dashboard.billing.produtosCategoriaArtigoEditar(categoryId, p.product_id)
                        )
                      }
                    >
                      <Pencil size={14} />
                      Editar
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-slate-600 hover:underline"
                      disabled={loading}
                      onClick={() => void duplicateProduct(p.product_id)}
                    >
                      <Copy size={14} />
                      Duplicar
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-red-600 hover:underline"
                      disabled={loading}
                      onClick={() => void removeProduct(p)}
                    >
                      <Trash2 size={14} />
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {!products.length && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                    Nenhum artigo nesta categoria.
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
    </div>
  );
}
