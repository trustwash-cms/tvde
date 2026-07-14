'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { BillingBreadcrumb } from '@/components/billing/billing-breadcrumb';

interface ProductCategory {
  category_id: number;
  name: string;
}

interface FormOptions {
  units: Array<{ unit_id: number; name: string; short_name: string }>;
  taxes: Array<{ tax_id: number; name: string; value: number }>;
  nextReference: string;
  productTypes: Array<{ id: number; label: string }>;
}

interface MoloniProduct {
  product_id: number;
  type?: number;
  name: string;
  reference?: string;
  ean?: string;
  summary?: string;
  price?: number;
  unit_id?: number;
  pos_favorite?: number;
  visibility_id?: number;
  taxes?: Array<{ tax_id: number }>;
}

function splitSummaryNotes(summary?: string) {
  if (!summary?.trim()) return { summary: '', notes: '' };
  const parts = summary.split('\n\n');
  if (parts.length <= 1) return { summary: summary.trim(), notes: '' };
  return { summary: parts[0]?.trim() ?? '', notes: parts.slice(1).join('\n\n').trim() };
}

export function BillingProductFormPanel({
  categoryId,
  productId,
}: {
  categoryId: number;
  productId?: number;
}) {
  const router = useRouter();
  const isEdit = productId != null;
  const { workspaces, workspaceId, setWorkspaceId } = useWorkspaceContext();

  const [category, setCategory] = useState<ProductCategory | null>(null);
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    active: true,
    type: 2,
    reference: '',
    ean: '',
    name: '',
    summary: '',
    price: '',
    taxId: '',
    posFavorite: false,
    unitId: '',
    notes: '',
  });

  useEffect(() => {
    if (!workspaceId) return;

    apiFetch<ProductCategory>(
      withWorkspaceQuery(API_PATHS.billing.productCategoryById(categoryId), workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) setCategory(res.data);
    });

    apiFetch<FormOptions>(
      withWorkspaceQuery(API_PATHS.billing.moloniProductFormOptions, workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (res.data) {
        setOptions(res.data);
        if (!isEdit) {
          setForm((f) => ({
            ...f,
            reference: res.data!.nextReference || f.reference,
            unitId: String(res.data!.units[0]?.unit_id ?? ''),
            taxId: String(res.data!.taxes.find((t) => t.value === 23)?.tax_id ?? res.data!.taxes[0]?.tax_id ?? ''),
          }));
        }
      }
    });

    if (isEdit && productId) {
      apiFetch<MoloniProduct>(
        withWorkspaceQuery(API_PATHS.billing.moloniProductById(productId), workspaceId),
        {},
        getStoredToken()
      ).then((res) => {
        if (res.data) {
          const { summary, notes } = splitSummaryNotes(res.data.summary);
          setForm({
            active: res.data.visibility_id !== 0,
            type: res.data.type ?? 2,
            reference: res.data.reference ?? '',
            ean: res.data.ean ?? '',
            name: res.data.name,
            summary,
            notes,
            price: String(res.data.price ?? 0),
            taxId: String(res.data.taxes?.[0]?.tax_id ?? ''),
            posFavorite: res.data.pos_favorite === 1,
            unitId: String(res.data.unit_id ?? ''),
          });
        }
      });
    }
  }, [workspaceId, categoryId, productId, isEdit]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setLoading(true);
    setError('');

    const payload = {
      workspaceId,
      categoryId,
      type: Number(form.type),
      name: form.name.trim(),
      reference: form.reference.trim(),
      price: Number(form.price),
      unitId: Number(form.unitId),
      taxId: form.taxId ? Number(form.taxId) : undefined,
      ean: form.ean.trim(),
      summary: form.summary.trim(),
      notes: form.notes.trim(),
      posFavorite: form.posFavorite,
      hasStock: false,
      active: form.active,
    };

    const res = isEdit
      ? await apiFetch(
          API_PATHS.billing.moloniProductById(productId!),
          { method: 'PATCH', body: JSON.stringify(payload) },
          getStoredToken()
        )
      : await apiFetch(
          API_PATHS.billing.moloniProducts,
          { method: 'POST', body: JSON.stringify(payload) },
          getStoredToken()
        );

    setLoading(false);
    if (res.success) {
      router.push(WEB_ROUTES.dashboard.billing.produtosCategoriaArtigos(categoryId));
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  const breadcrumbItems = useMemo(() => {
    const items: Array<{ label: string; href?: string }> = [
      { label: 'Categorias de artigos', href: WEB_ROUTES.dashboard.billing.produtosCategorias },
    ];
    if (category) {
      items.push({
        label: `[${category.name}]`,
        href: WEB_ROUTES.dashboard.billing.produtosCategoriaArtigos(categoryId),
      });
      items.push({ label: 'Artigos', href: WEB_ROUTES.dashboard.billing.produtosCategoriaArtigos(categoryId) });
    }
    items.push({ label: isEdit ? 'Editar artigo' : 'Novo artigo' });
    return items;
  }, [category, categoryId, isEdit]);

  return (
    <div className="space-y-4">
      <BillingBreadcrumb items={breadcrumbItems} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Artigos de {category?.name ?? '…'}
          </h2>
          <p className="text-sm text-slate-500">
            {isEdit
              ? `Editar artigo na categoria ${category?.name ?? ''}.`
              : `Inserir um novo artigo na categoria ${category?.name ?? ''}.`}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Campos marcados com (*) são obrigatórios.
          </p>
        </div>
        <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <form onSubmit={(e) => void submit(e)} className="card space-y-6">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Informação geral</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Visibilidade *</label>
              <select
                className="input"
                value={form.active ? '1' : '0'}
                onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}
              >
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Categoria *</label>
              <input className="input bg-slate-50" value={category?.name ?? ''} readOnly />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Tipo *</label>
              <select
                className="input"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: Number(e.target.value) })}
                required
              >
                <option value="">Escolha uma opção</option>
                {options?.productTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Referência *</label>
              {options?.nextReference && !isEdit && (
                <p className="mb-1 text-xs text-slate-400">Último código sugerido: {options.nextReference}</p>
              )}
              <input
                className="input font-mono text-sm"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">EAN (Código de barras)</label>
              <input
                className="input"
                value={form.ean}
                onChange={(e) => setForm({ ...form, ean: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-slate-600">Designação *</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-slate-600">Resumo</label>
              <textarea
                className="input min-h-[80px]"
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Preço sem impostos *</label>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">IVA *</label>
              <select
                className="input"
                value={form.taxId}
                onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                required
              >
                <option value="">Escolha imposto</option>
                {options?.taxes.map((t) => (
                  <option key={t.tax_id} value={t.tax_id}>
                    {t.name} ({t.value}%)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Unidade *</label>
              <select
                className="input"
                value={form.unitId}
                onChange={(e) => setForm({ ...form, unitId: e.target.value })}
                required
              >
                <option value="">Escolha uma opção</option>
                {options?.units.map((u) => (
                  <option key={u.unit_id} value={u.unit_id}>
                    {u.name} ({u.short_name})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.posFavorite}
                  onChange={(e) => setForm({ ...form, posFavorite: e.target.checked })}
                />
                Favorito no POS
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-slate-600">Observações</label>
              <textarea
                className="input min-h-[100px]"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Link
            href={WEB_ROUTES.dashboard.billing.produtosCategoriaArtigos(categoryId)}
            className="btn-secondary"
          >
            Cancelar
          </Link>
          <button type="submit" className="btn-primary" disabled={loading || !workspaceId}>
            {isEdit ? 'Guardar alterações' : 'Criar artigo'}
          </button>
        </div>
      </form>
    </div>
  );
}
