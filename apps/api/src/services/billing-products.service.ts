import { MoloniClient } from '@tvde/billing';
import { ensureMoloniAccessToken } from './moloni-connection.service';

const PAGE_SIZE = 50;

async function fetchAllPages<T>(
  fetchPage: (offset: number, qty: number) => Promise<T[]>,
  qty = PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, qty);
    if (!page.length) break;
    all.push(...page);
    if (page.length < qty) break;
    offset += 1;
  }
  return all;
}

function paginate<T>(items: T[], page: number, limit: number) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const start = page * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    total: items.length,
    page,
    limit: safeLimit,
  };
}

function filterByQuery<T extends { name?: string }>(items: T[], q?: string) {
  const needle = q?.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.name?.toLowerCase().includes(needle));
}

async function moloni(workspaceId: string) {
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');
  return { companyId: row.companyId, client: moloniClient };
}

export async function listProductCategories(
  workspaceId: string,
  parentId = 0,
  q?: string,
  page = 0,
  limit = 10
) {
  const { companyId, client } = await moloni(workspaceId);
  const all = await fetchAllPages((offset, qty) =>
    client.getAllProductCategories(companyId, parentId, offset, qty)
  );
  const filtered = filterByQuery(all, q);
  return paginate(filtered, page, limit);
}

export async function getProductCategory(workspaceId: string, categoryId: number) {
  const { companyId, client } = await moloni(workspaceId);
  return client.getProductCategory(companyId, categoryId);
}

export async function createProductCategory(
  workspaceId: string,
  input: { parentId: number; name: string; description?: string; posEnabled?: boolean }
) {
  const { companyId, client } = await moloni(workspaceId);
  const result = await client.insertProductCategory({
    company_id: companyId,
    parent_id: input.parentId,
    name: input.name,
    description: input.description ?? '',
    pos_enabled: input.posEnabled ? 1 : 0,
  });
  if (!result.category_id) throw new Error('Falha ao criar categoria');
  return client.getProductCategory(companyId, result.category_id);
}

export async function updateProductCategory(
  workspaceId: string,
  categoryId: number,
  input: { name: string; description?: string; posEnabled?: boolean }
) {
  const { companyId, client } = await moloni(workspaceId);
  await client.updateProductCategory({
    company_id: companyId,
    category_id: categoryId,
    name: input.name,
    description: input.description ?? '',
    pos_enabled: input.posEnabled ? 1 : 0,
  });
  return client.getProductCategory(companyId, categoryId);
}

export async function deleteProductCategory(workspaceId: string, categoryId: number) {
  const { companyId, client } = await moloni(workspaceId);
  await client.deleteProductCategory(companyId, categoryId);
}

export async function listCategoryProducts(
  workspaceId: string,
  categoryId: number,
  q?: string,
  page = 0,
  limit = 10
) {
  const { companyId, client } = await moloni(workspaceId);
  const all = await fetchAllPages((offset, qty) =>
    client.getAllProducts(companyId, categoryId, offset, qty, 1)
  );
  const needle = q?.trim().toLowerCase();
  const filtered = needle
    ? all.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.reference?.toLowerCase().includes(needle) ?? false) ||
          (p.ean?.toLowerCase().includes(needle) ?? false)
      )
    : all;
  return paginate(filtered, page, limit);
}

export async function getMoloniProduct(workspaceId: string, productId: number) {
  const { companyId, client } = await moloni(workspaceId);
  return client.getProduct(companyId, productId, 1);
}

export async function getProductFormOptions(workspaceId: string) {
  const { companyId, client } = await moloni(workspaceId);
  const [units, taxes, nextRef] = await Promise.all([
    client.getMeasurementUnits(companyId),
    client.getTaxes(companyId),
    client.getNextProductReference(companyId).catch(() => ({ reference: '' })),
  ]);
  return {
    units,
    taxes,
    nextReference: nextRef.reference ?? '',
    productTypes: [
      { id: 1, label: 'Produto' },
      { id: 2, label: 'Serviço' },
      { id: 3, label: 'Outros' },
      { id: 4, label: 'Impostos, taxas e encargos parafiscais' },
    ],
  };
}

function defaultTaxId(taxes: Awaited<ReturnType<MoloniClient['getTaxes']>>) {
  const vat23 = taxes.find((t) => t.value === 23);
  if (vat23) return vat23.tax_id;
  return taxes[0]?.tax_id;
}

export async function createMoloniProduct(
  workspaceId: string,
  input: {
    categoryId: number;
    type: number;
    name: string;
    reference: string;
    price: number;
    unitId: number;
    taxId?: number;
    exemptionReason?: string;
    ean?: string;
    summary?: string;
    notes?: string;
    posFavorite?: boolean;
    hasStock?: boolean;
    stock?: number;
    active?: boolean;
  }
) {
  const { companyId, client } = await moloni(workspaceId);
  const taxes = await client.getTaxes(companyId);
  const taxId = input.taxId ?? defaultTaxId(taxes);
  if (!taxId) throw new Error('Nenhum imposto configurado no Moloni');
  const taxValue = taxes.find((t) => t.tax_id === taxId)?.value ?? 0;

  const summary = [input.summary?.trim(), input.notes?.trim()].filter(Boolean).join('\n\n');

  const result = await client.insertProduct({
    company_id: companyId,
    category_id: input.categoryId,
    type: input.type,
    name: input.name,
    reference: input.reference,
    ean: input.ean ?? '',
    summary,
    price: input.price,
    unit_id: input.unitId,
    has_stock: input.hasStock ? 1 : 0,
    stock: input.hasStock ? (input.stock ?? 0) : 0,
    pos_favorite: input.posFavorite ? 1 : 0,
    visibility_id: input.active === false ? 0 : 1,
    ...(input.exemptionReason || taxValue === 0
      ? { exemption_reason: input.exemptionReason ?? 'M07' }
      : {}),
    taxes: [{ tax_id: taxId, value: taxValue, order: 1, cumulative: 0 }],
  });

  if (!result.product_id) throw new Error('Falha ao criar artigo');
  return client.getProduct(companyId, result.product_id, 1);
}

export async function updateMoloniProduct(
  workspaceId: string,
  productId: number,
  input: {
    categoryId: number;
    type: number;
    name: string;
    reference: string;
    price: number;
    unitId: number;
    taxId?: number;
    ean?: string;
    summary?: string;
    notes?: string;
    posFavorite?: boolean;
    hasStock?: boolean;
    stock?: number;
    active?: boolean;
  }
) {
  const { companyId, client } = await moloni(workspaceId);
  const taxes = await client.getTaxes(companyId);
  const taxId = input.taxId ?? defaultTaxId(taxes);
  if (!taxId) throw new Error('Nenhum imposto configurado no Moloni');

  const summary = [input.summary?.trim(), input.notes?.trim()].filter(Boolean).join('\n\n');

  await client.updateProduct({
    company_id: companyId,
    product_id: productId,
    category_id: input.categoryId,
    type: input.type,
    name: input.name,
    reference: input.reference,
    ean: input.ean ?? '',
    summary,
    price: input.price,
    unit_id: input.unitId,
    has_stock: input.hasStock ? 1 : 0,
    stock: input.hasStock ? (input.stock ?? 0) : 0,
    pos_favorite: input.posFavorite ? 1 : 0,
    visibility_id: input.active === false ? 0 : 1,
    taxes: [{ tax_id: taxId, value: 0, order: 1, cumulative: 0 }],
  });

  return client.getProduct(companyId, productId, 1);
}

export async function duplicateMoloniProduct(workspaceId: string, productId: number) {
  const { companyId, client } = await moloni(workspaceId);
  const source = await client.getProduct(companyId, productId, 1);
  const nextRef = await client.getNextProductReference(companyId);
  const taxId = source.taxes?.[0]?.tax_id;

  const result = await client.insertProduct({
    company_id: companyId,
    category_id: source.category_id ?? 0,
    type: source.type ?? 2,
    name: `${source.name} (cópia)`,
    reference: nextRef.reference || `${source.reference}-COPY`,
    ean: source.ean ?? '',
    summary: source.summary ?? '',
    price: source.price ?? 0,
    unit_id: source.unit_id ?? source.measurement_unit?.unit_id ?? 1,
    has_stock: 0,
    stock: 0,
    pos_favorite: source.pos_favorite ?? 0,
    visibility_id: 1,
    ...(taxId
      ? { taxes: [{ tax_id: taxId, value: 0, order: 1, cumulative: 0 }] }
      : {}),
  });

  if (!result.product_id) throw new Error('Falha ao duplicar artigo');
  return client.getProduct(companyId, result.product_id, 1);
}

export async function deleteMoloniProduct(workspaceId: string, productId: number) {
  const { companyId, client } = await moloni(workspaceId);
  await client.deleteProduct(companyId, productId);
}

export function computeProductTaxAmount(product: {
  price?: number;
  taxes?: Array<{ value?: number; tax?: { value?: number } }>;
}) {
  const price = product.price ?? 0;
  let vatRate = 0;
  for (const row of product.taxes ?? []) {
    const rate = row.tax?.value ?? row.value ?? 0;
    if (rate > 0) vatRate += rate;
  }
  return (price * vatRate) / 100;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
}
