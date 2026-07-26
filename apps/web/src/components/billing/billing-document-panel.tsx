'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { type MoloniDocumentType, getDocumentTypeLabel, WEB_ROUTES } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';
import { useWorkspaceContext } from '@/hooks/use-workspace-context';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { BillingEntityPicker } from '@/components/billing/billing-entity-picker';
import {
  BillingEntityFormFields,
  billingEntityFormPayload,
  emptyEntityForm,
  validateEntityForm,
  type BillingEntityFormValues,
} from '@/components/billing/billing-entity-form';
import {
  BillingProductPicker,
  type BillingProductOption,
} from '@/components/billing/billing-product-picker';
import { Modal } from '@/components/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { normalizePhone } from '@/lib/phone-format';

interface BillingEntity {
  id: string;
  name: string;
  vat: string | null;
  entityType: string;
  linkStatus: string;
}

interface CatalogItem {
  id: string;
  catalogType: string;
  externalId: string;
  label: string;
  dataJson?: { value?: number };
}

interface MoloniStatus {
  configured: boolean;
  connected: boolean;
  healthy: boolean;
  statusMessage: string;
  defaultProductCategoryId?: number | null;
}

interface InvoiceLineForm {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  moloniProductId?: number;
  moloniTaxId?: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyLine = (): InvoiceLineForm => ({
  description: '',
  quantity: 1,
  unitPrice: 0,
  vatRate: 23,
});

function isEmptyLine(line: InvoiceLineForm): boolean {
  return !line.description.trim() && line.unitPrice === 0 && !line.moloniProductId;
}

function filledLines(lines: InvoiceLineForm[]): InvoiceLineForm[] {
  return lines.filter((l) => l.description.trim());
}

function FormSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        <ChevronDown size={16} className={`text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-3 border-t border-slate-100 px-3 py-3">{children}</div>}
    </div>
  );
}

interface InvoiceDraftResponse {
  id: string;
  status: string;
  documentType: MoloniDocumentType;
  billingEntityId: string | null;
  notes: string | null;
  dueDate: string | null;
  metadataJson?: {
    issueDate?: string;
    expirationDate?: string;
    documentSetId?: number;
    yourReference?: string;
    ourReference?: string;
    financialDiscount?: number;
    specialDiscount?: number;
    relatedDocumentsNotes?: string;
    deliveryMethodId?: number;
    deliveryDatetime?: string;
    deliveryDepartureAddress?: string;
    deliveryDepartureCity?: string;
    deliveryDepartureZipCode?: string;
    deliveryDepartureCountry?: number;
    deliveryDestinationAddress?: string;
    deliveryDestinationCity?: string;
    deliveryDestinationZipCode?: string;
    deliveryDestinationCountry?: number;
    vehicleNumberPlate?: string;
  } | null;
  lines: Array<{
    description: string;
    quantity: string | number;
    unitPrice: string | number;
    vatRate: string | number;
    externalProductId: string | null;
    externalTaxId: string | null;
  }>;
  billingEntity?: BillingEntity | null;
}

function isoDate(value: string | null | undefined, fallback = todayIso()): string {
  if (!value) return fallback;
  return value.slice(0, 10);
}

function BillingDocumentPanelInner({ documentType }: { documentType: MoloniDocumentType }) {
  const searchParams = useSearchParams();
  const draftId = searchParams.get('draft');
  const loadedDraftRef = useRef<string | null>(null);

  const { workspaces, workspaceId, setWorkspaceId, loading: wsLoading } = useWorkspaceContext();

  const title = getDocumentTypeLabel(documentType);

  const [entities, setEntities] = useState<BillingEntity[]>([]);
  const [documentSets, setDocumentSets] = useState<CatalogItem[]>([]);
  const [taxes, setTaxes] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<BillingProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [moloni, setMoloni] = useState<MoloniStatus | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [createClientForm, setCreateClientForm] = useState<BillingEntityFormValues>(emptyEntityForm());
  const [pushClientOnCreate, setPushClientOnCreate] = useState(false);
  const [pinnedClient, setPinnedClient] = useState<BillingEntity | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const [form, setForm] = useState({
    billingEntityId: '',
    issueDate: todayIso(),
    expirationDate: todayIso(),
    documentSetId: '',
    yourReference: '',
    ourReference: '',
    financialDiscount: '' as number | '',
    specialDiscount: '' as number | '',
    relatedDocumentsNotes: '',
    deliveryMethodId: '',
    deliveryDatetime: '',
    deliveryDepartureAddress: '',
    deliveryDepartureCity: '',
    deliveryDepartureZipCode: '',
    deliveryDepartureCountry: '1',
    deliveryDestinationAddress: '',
    deliveryDestinationCity: '',
    deliveryDestinationZipCode: '',
    deliveryDestinationCountry: '1',
    vehicleNumberPlate: '',
    notes: '',
    lines: [emptyLine()],
  });

  const selectedSeries = documentSets.find((ds) => ds.externalId === form.documentSetId);

  const provisionalNumber = useMemo(() => {
    const seriesLabel = selectedSeries?.label?.trim() || 'M';
    const short = seriesLabel.split(/\s+/)[0] || seriesLabel;
    return `${short}/ (Provisório)`;
  }, [selectedSeries]);

  const loadProducts = useCallback(
    (searchQ?: string) => {
      if (!workspaceId || !moloni?.healthy) return;
      setProductsLoading(true);
      apiFetch<BillingProductOption[]>(
        withWorkspaceQuery(API_PATHS.billing.products, workspaceId, {
          q: searchQ?.trim() || undefined,
        }),
        {},
        getStoredToken()
      ).then((res) => {
        if (res.data) setProducts(res.data);
        setProductsLoading(false);
      });
    },
    [workspaceId, moloni?.healthy]
  );

  function loadEntities() {
    if (!workspaceId) return;
    const token = getStoredToken();
    apiFetch<BillingEntity[]>(
      withWorkspaceQuery(API_PATHS.billing.entities, workspaceId, {
        entityType: 'customer',
        status: 'active',
      }),
      {},
      token
    ).then((res) => {
      if (res.data) setEntities(res.data);
    });
  }

  function loadStatic() {
    if (!workspaceId) return;
    const token = getStoredToken();
    loadEntities();
    apiFetch<CatalogItem[]>(
      withWorkspaceQuery(API_PATHS.billing.catalog, workspaceId, { catalogType: 'document_set' }),
      {},
      token
    ).then((res) => {
      if (res.data) {
        setDocumentSets(res.data);
        if (!form.documentSetId && res.data[0]) {
          setForm((f) => ({ ...f, documentSetId: res.data![0].externalId }));
        }
      }
    });
    apiFetch<CatalogItem[]>(
      withWorkspaceQuery(API_PATHS.billing.catalog, workspaceId, { catalogType: 'tax' }),
      {},
      token
    ).then((res) => {
      if (res.data) setTaxes(res.data);
    });
    apiFetch<MoloniStatus>(
      withWorkspaceQuery(API_PATHS.billing.moloniStatus, workspaceId, { probe: '1' }),
      {},
      token
    ).then((res) => {
      if (res.data) setMoloni(res.data);
    });
  }

  useEffect(() => {
    setError('');
    loadStatic();
  }, [workspaceId, documentType]);

  async function syncCatalogSeries() {
    if (!workspaceId) return;
    setSyncingCatalog(true);
    setError('');
    const res = await apiFetch(
      withWorkspaceQuery(API_PATHS.billing.syncCatalog, workspaceId),
      { method: 'POST' },
      getStoredToken()
    );
    setSyncingCatalog(false);
    if (!res.success) {
      setError(getApiErrorMessage(res));
      return;
    }
    const data = res.data as { documentSets?: number; taxes?: number } | undefined;
    setSuccess(
      `Catálogo sincronizado: ${data?.documentSets ?? 0} séries, ${data?.taxes ?? 0} impostos.`
    );
    loadStatic();
  }

  useEffect(() => {
    if (moloni?.healthy) loadProducts();
  }, [moloni?.healthy, workspaceId, loadProducts]);

  useEffect(() => {
    if (!draftId || !workspaceId || loadedDraftRef.current === draftId) return;
    loadedDraftRef.current = draftId;
    setError('');
    apiFetch<InvoiceDraftResponse>(
      withWorkspaceQuery(API_PATHS.invoices.byId(draftId), workspaceId),
      {},
      getStoredToken()
    ).then((res) => {
      if (!res.data) {
        setError(res.error ?? 'Rascunho não encontrado');
        return;
      }
      if (res.data.status !== 'draft') {
        setError('Só rascunhos podem ser editados');
        return;
      }
      if (res.data.documentType && res.data.documentType !== documentType) {
        setError('Tipo de documento não corresponde a esta página');
        return;
      }

      setEditingDraftId(res.data.id);
      const meta = res.data.metadataJson ?? {};
      const entity = res.data.billingEntity;
      if (entity) {
        setPinnedClient(entity);
        setEntities((prev) => (prev.some((e) => e.id === entity.id) ? prev : [entity, ...prev]));
      }

      setForm({
        billingEntityId: res.data.billingEntityId ?? '',
        issueDate: isoDate(meta.issueDate),
        expirationDate: isoDate(meta.expirationDate ?? res.data.dueDate),
        documentSetId: meta.documentSetId != null ? String(meta.documentSetId) : '',
        yourReference: meta.yourReference ?? '',
        ourReference: meta.ourReference ?? '',
        financialDiscount: meta.financialDiscount ?? '',
        specialDiscount: meta.specialDiscount ?? '',
        relatedDocumentsNotes: meta.relatedDocumentsNotes ?? '',
        deliveryMethodId: meta.deliveryMethodId != null ? String(meta.deliveryMethodId) : '',
        deliveryDatetime: meta.deliveryDatetime ?? '',
        deliveryDepartureAddress: meta.deliveryDepartureAddress ?? '',
        deliveryDepartureCity: meta.deliveryDepartureCity ?? '',
        deliveryDepartureZipCode: meta.deliveryDepartureZipCode ?? '',
        deliveryDepartureCountry:
          meta.deliveryDepartureCountry != null ? String(meta.deliveryDepartureCountry) : '1',
        deliveryDestinationAddress: meta.deliveryDestinationAddress ?? '',
        deliveryDestinationCity: meta.deliveryDestinationCity ?? '',
        deliveryDestinationZipCode: meta.deliveryDestinationZipCode ?? '',
        deliveryDestinationCountry:
          meta.deliveryDestinationCountry != null ? String(meta.deliveryDestinationCountry) : '1',
        vehicleNumberPlate: meta.vehicleNumberPlate ?? '',
        notes: res.data.notes ?? '',
        lines: res.data.lines.length
          ? res.data.lines.map((line) => ({
              description: line.description,
              quantity: Number(line.quantity),
              unitPrice: Number(line.unitPrice),
              vatRate: Number(line.vatRate),
              moloniProductId: line.externalProductId ? Number(line.externalProductId) : undefined,
              moloniTaxId: line.externalTaxId ? Number(line.externalTaxId) : undefined,
            }))
          : [emptyLine()],
      });
      setSuccess('Rascunho carregado — pode editar e emitir');
    });
  }, [draftId, workspaceId, documentType]);

  function resetForm() {
    setEditingDraftId(null);
    setPinnedClient(null);
    setForm({
      billingEntityId: '',
      issueDate: todayIso(),
      expirationDate: todayIso(),
      documentSetId: documentSets[0]?.externalId ?? '',
      yourReference: '',
      ourReference: '',
      financialDiscount: '',
      specialDiscount: '',
      relatedDocumentsNotes: '',
      deliveryMethodId: '',
      deliveryDatetime: '',
      deliveryDepartureAddress: '',
      deliveryDepartureCity: '',
      deliveryDepartureZipCode: '',
      deliveryDepartureCountry: '1',
      deliveryDestinationAddress: '',
      deliveryDestinationCity: '',
      deliveryDestinationZipCode: '',
      deliveryDestinationCountry: '1',
      vehicleNumberPlate: '',
      notes: '',
      lines: [emptyLine()],
    });
  }

  function buildPayload() {
    const documentSetId = form.documentSetId ? Number(form.documentSetId) : undefined;
    return {
      billingEntityId: form.billingEntityId,
      issueDate: form.issueDate,
      documentSetId,
      dueDate: form.expirationDate,
      notes: form.notes,
      metadata: {
        documentSetId,
        issueDate: form.issueDate,
        expirationDate: form.expirationDate,
        yourReference: form.yourReference || undefined,
        ourReference: form.ourReference || undefined,
        financialDiscount: form.financialDiscount === '' ? undefined : Number(form.financialDiscount),
        specialDiscount: form.specialDiscount === '' ? undefined : Number(form.specialDiscount),
        relatedDocumentsNotes: form.relatedDocumentsNotes || undefined,
        deliveryMethodId: form.deliveryMethodId ? Number(form.deliveryMethodId) : undefined,
        deliveryDatetime: form.deliveryDatetime || undefined,
        deliveryDepartureAddress: form.deliveryDepartureAddress || undefined,
        deliveryDepartureCity: form.deliveryDepartureCity || undefined,
        deliveryDepartureZipCode: form.deliveryDepartureZipCode || undefined,
        deliveryDepartureCountry: form.deliveryDepartureCountry
          ? Number(form.deliveryDepartureCountry)
          : undefined,
        deliveryDestinationAddress: form.deliveryDestinationAddress || undefined,
        deliveryDestinationCity: form.deliveryDestinationCity || undefined,
        deliveryDestinationZipCode: form.deliveryDestinationZipCode || undefined,
        deliveryDestinationCountry: form.deliveryDestinationCountry
          ? Number(form.deliveryDestinationCountry)
          : undefined,
        vehicleNumberPlate: form.vehicleNumberPlate || undefined,
      },
      lines: filledLines(form.lines).map((line) => ({
        description: line.description.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        moloniProductId: line.moloniProductId,
        moloniTaxId: line.moloniTaxId,
      })),
    };
  }

  function validateInvoiceForm(): string | null {
    if (!form.billingEntityId) return 'Seleccione ou crie um cliente';
    const lines = filledLines(form.lines);
    if (lines.length === 0) return 'Adicione pelo menos um artigo';
    if (!form.documentSetId) return 'Seleccione a série do documento';
    for (const line of lines) {
      if (line.unitPrice < 0) return 'Preço inválido num artigo';
    }
    return null;
  }

  const hasManualLines = filledLines(form.lines).some((l) => !l.moloniProductId);
  const missingDefaultCategory =
    hasManualLines && moloni?.healthy && !moloni.defaultProductCategoryId;

  async function submitInvoice(mode: 'draft' | 'issue') {
    if (!workspaceId) {
      setError('Seleccione um workspace');
      return;
    }
    const validationError = validateInvoiceForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (mode === 'issue' && !moloni?.healthy) {
      setError('Moloni não ligado — configure em Definições → Moloni');
      return;
    }
    if (mode === 'issue' && hasManualLines && !moloni?.defaultProductCategoryId) {
      setError(
        'Linha manual sem categoria Moloni — seleccione uma categoria por defeito em Configurações → Moloni'
      );
      return;
    }
    if (mode === 'issue') {
      const ok = await confirm({
        title: 'Emitir documento',
        message: `Emitir ${title.toLowerCase()} no Moloni?`,
      });
      if (!ok) return;
    }

    setError('');
    setLoading(true);
    const token = getStoredToken();
    const payload = {
      ...buildPayload(),
      workspaceId,
      documentType,
      entityType: 'customer' as const,
    };

    let invoiceId = editingDraftId;

    if (editingDraftId) {
      const updateRes = await apiFetch<{ id: string }>(
        API_PATHS.invoices.byId(editingDraftId),
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
        token
      );
      if (!updateRes.success) {
        setLoading(false);
        setError(getApiErrorMessage(updateRes));
        return;
      }
      if (mode === 'draft') {
        setLoading(false);
        setSuccess('Rascunho guardado');
        return;
      }
    } else {
      const createRes = await apiFetch<{ id: string }>(
        API_PATHS.invoices.list,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        token
      );

      if (!createRes.success || !createRes.data?.id) {
        setLoading(false);
        setError(getApiErrorMessage(createRes));
        return;
      }

      invoiceId = createRes.data.id;

      if (mode === 'draft') {
        setLoading(false);
        setSuccess('Rascunho guardado');
        resetForm();
        return;
      }
    }

    const issueRes = await apiFetch(
      API_PATHS.invoices.issue(invoiceId!),
      { method: 'POST' },
      token
    );
    setLoading(false);

    if (issueRes.success) {
      setSuccess(`${title} emitida no Moloni`);
      resetForm();
    } else {
      setError(`${getApiErrorMessage(issueRes)} (rascunho ficou guardado)`);
    }
  }

  function handleCreateDraft(e: FormEvent) {
    e.preventDefault();
    void submitInvoice('draft');
  }

  function openCreateClientModal() {
    setCreateClientForm(emptyEntityForm());
    setPushClientOnCreate(false);
    setCreateClientOpen(true);
    setError('');
  }

  function onClientCreated(
    entity: { id: string; name: string; vat: string | null; linkStatus?: string },
    reused: boolean
  ) {
    const entry: BillingEntity = {
      id: entity.id,
      name: entity.name,
      vat: entity.vat,
      entityType: 'customer',
      linkStatus: entity.linkStatus ?? 'unlinked',
    };
    setPinnedClient(entry);
    setEntities((prev) => {
      const rest = prev.filter((e) => e.id !== entry.id);
      return [entry, ...rest];
    });
    setForm((f) => ({ ...f, billingEntityId: entity.id }));
    setCreateClientOpen(false);
    setSuccess(
      reused
        ? `Cliente «${entity.name}» (${entity.vat}) já existia — seleccionado`
        : `Cliente «${entity.name}» (${entity.vat}) criado — seleccionado`
    );
    loadEntities();
  }

  async function saveCreateClient() {
    if (!workspaceId) return;
    const validationError = validateEntityForm(createClientForm);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setLoading(true);
    const payload = billingEntityFormPayload(createClientForm, 'customer');
    const res = await apiFetch<{
      id: string;
      name: string;
      vat: string | null;
      linkStatus?: string;
    }>(
      API_PATHS.billing.entities,
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          ...payload,
          phone: normalizePhone(payload.phone),
          pushToMoloni: pushClientOnCreate,
        }),
      },
      getStoredToken()
    );
    setLoading(false);
    if (res.success && res.data?.id) {
      onClientCreated(res.data, Boolean(res.message?.includes('já existia')));
    } else {
      setError(getApiErrorMessage(res));
    }
  }

  function addProductLine(product: BillingProductOption) {
    const newLine: InvoiceLineForm = {
      description: product.name,
      quantity: 1,
      unitPrice: product.price ?? 0,
      vatRate: 23,
      moloniProductId: product.productId,
    };
    setForm((f) => {
      const emptyIdx = f.lines.findIndex(isEmptyLine);
      if (emptyIdx >= 0) {
        const lines = [...f.lines];
        lines[emptyIdx] = newLine;
        return { ...f, lines };
      }
      return { ...f, lines: [...f.lines, newLine] };
    });
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}
      {missingDefaultCategory && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Categoria Moloni por defeito em falta</p>
          <p className="mt-1 text-xs">
            Tem linhas manuais sem artigo Moloni. Antes de emitir, escolha a categoria por defeito em{' '}
            <Link href={WEB_ROUTES.dashboard.settings.moloni} className="underline">
              Configurações → Moloni
            </Link>
            .
          </p>
        </div>
      )}

      <WorkspaceSelector workspaces={workspaces} workspaceId={workspaceId} onChange={setWorkspaceId} />

      {!wsLoading && !workspaceId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Seleccione um workspace.
        </div>
      )}

      <section className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Criar {title}</h2>
            <p className="text-sm text-slate-500">
              Formulário alinhado com o Moloni — emissão sem papel activa ao emitir.
            </p>
          </div>
          {moloni?.healthy && <span className="text-xs text-green-700">Moloni ligado</span>}
        </div>

        <form onSubmit={handleCreateDraft} className="space-y-4" noValidate>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {title} N.º (Provisório)
              </label>
              <input className="input bg-slate-50" value={provisionalNumber} readOnly />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Data de emissão</label>
              <input
                className="input"
                type="date"
                value={form.issueDate}
                onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
                required
                disabled={!workspaceId}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Série</label>
              <select
                className="input"
                value={form.documentSetId}
                onChange={(e) => setForm({ ...form, documentSetId: e.target.value })}
                required
                disabled={!workspaceId || documentSets.length === 0}
              >
                {documentSets.length === 0 ? (
                  <option value="">Sem séries — sincronize o catálogo</option>
                ) : (
                  documentSets.map((ds) => (
                    <option key={ds.id} value={ds.externalId}>
                      {ds.label}
                    </option>
                  ))
                )}
              </select>
              {documentSets.length === 0 && workspaceId && (
                <p className="mt-1.5 text-xs text-amber-800">
                  As séries vêm do catálogo Moloni local.{' '}
                  {moloni?.connected ? (
                    <>
                      <button
                        type="button"
                        className="font-medium underline"
                        disabled={syncingCatalog}
                        onClick={() => void syncCatalogSeries()}
                      >
                        {syncingCatalog ? 'A sincronizar…' : 'Sincronizar séries agora'}
                      </button>
                      {' · '}
                    </>
                  ) : null}
                  <Link href={WEB_ROUTES.dashboard.settings.moloni} className="font-medium underline">
                    Configurações → Moloni
                  </Link>
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Emissão de fatura sem papel — ao emitir no Moloni o documento é comunicado à AT.
            Para data de disponibilização diferente, use o campo Observações.
          </p>

          <FormSection title="Clientes" defaultOpen>
            <BillingEntityPicker
              entities={entities}
              value={form.billingEntityId}
              pinnedEntity={pinnedClient}
              onChange={(id) => {
                setForm({ ...form, billingEntityId: id });
                if (!id) setPinnedClient(null);
              }}
              disabled={!workspaceId}
              required
            />
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={!workspaceId || loading}
              onClick={openCreateClientModal}
            >
              Novo cliente
            </button>
          </FormSection>

          <FormSection title="Dados financeiros">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-600">Data de vencimento</label>
                <input
                  className="input"
                  type="date"
                  value={form.expirationDate}
                  onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                  disabled={!workspaceId}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">V/ referência</label>
                <input
                  className="input"
                  value={form.yourReference}
                  onChange={(e) => setForm({ ...form, yourReference: e.target.value })}
                  disabled={!workspaceId}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">N/ referência</label>
                <input
                  className="input"
                  value={form.ourReference}
                  onChange={(e) => setForm({ ...form, ourReference: e.target.value })}
                  disabled={!workspaceId}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Desconto financeiro (%)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.financialDiscount}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      financialDiscount: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                  disabled={!workspaceId}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Desconto especial (€)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.specialDiscount}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      specialDiscount: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                  disabled={!workspaceId}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Documentos relacionados">
            <textarea
              className="input min-h-[72px]"
              placeholder="Notas sobre documentos associados (guias, etc.)"
              value={form.relatedDocumentsNotes}
              onChange={(e) => setForm({ ...form, relatedDocumentsNotes: e.target.value })}
              disabled={!workspaceId}
            />
          </FormSection>

          <FormSection title="Artigos" defaultOpen>
            {moloni?.healthy ? (
              <BillingProductPicker
                products={products}
                loading={productsLoading}
                onSearch={loadProducts}
                onSelect={addProductLine}
                disabled={!workspaceId}
              />
            ) : (
              <p className="text-xs text-slate-500">Ligue o Moloni para pesquisar artigos.</p>
            )}

            {form.lines.map((line, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-slate-100 p-3 md:grid-cols-6">
                <input
                  className="input md:col-span-2"
                  placeholder="Descrição"
                  value={line.description}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...lines[i], description: e.target.value };
                    setForm({ ...form, lines });
                  }}
                disabled={!workspaceId}
              />
              <input
                className="input"
                type="number"
                min={1}
                placeholder="Qtd"
                  value={line.quantity}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...lines[i], quantity: Number(e.target.value) };
                    setForm({ ...form, lines });
                  }}
                  disabled={!workspaceId}
                />
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="Preço"
                  value={line.unitPrice}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...lines[i], unitPrice: Number(e.target.value) };
                    setForm({ ...form, lines });
                  }}
                disabled={!workspaceId}
              />
                <select
                  className="input"
                  value={line.moloniTaxId ?? ''}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = {
                      ...lines[i],
                      moloniTaxId: e.target.value ? Number(e.target.value) : undefined,
                      vatRate: taxes.find((t) => t.externalId === e.target.value)?.dataJson?.value ?? lines[i].vatRate,
                    };
                    setForm({ ...form, lines });
                  }}
                  disabled={!workspaceId}
                >
                  <option value="">IVA padrão</option>
                  {taxes.map((t) => (
                    <option key={t.id} value={t.externalId}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={!workspaceId || form.lines.length <= 1}
                  onClick={() =>
                    setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) })
                  }
                >
                  Remover
                </button>
              </div>
            ))}

            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={!workspaceId}
              onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}
            >
              + Linha manual
            </button>
          </FormSection>

          <FormSection title="Entrega e Transporte">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-600">Método entrega (ID Moloni)</label>
                <input
                  className="input"
                  value={form.deliveryMethodId}
                  onChange={(e) => setForm({ ...form, deliveryMethodId: e.target.value })}
                  disabled={!workspaceId}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Data/hora entrega</label>
                <input
                  className="input"
                  type="date"
                  value={form.deliveryDatetime}
                  onChange={(e) => setForm({ ...form, deliveryDatetime: e.target.value })}
                  disabled={!workspaceId}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-600">Matrícula</label>
                <input
                  className="input"
                  value={form.vehicleNumberPlate}
                  onChange={(e) => setForm({ ...form, vehicleNumberPlate: e.target.value })}
                  disabled={!workspaceId}
                />
              </div>
            </div>
            <p className="text-xs font-medium text-slate-600">Morada de carga</p>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="input"
                placeholder="Morada"
                value={form.deliveryDepartureAddress}
                onChange={(e) => setForm({ ...form, deliveryDepartureAddress: e.target.value })}
                disabled={!workspaceId}
              />
              <input
                className="input"
                placeholder="Localidade"
                value={form.deliveryDepartureCity}
                onChange={(e) => setForm({ ...form, deliveryDepartureCity: e.target.value })}
                disabled={!workspaceId}
              />
              <input
                className="input"
                placeholder="Código postal"
                value={form.deliveryDepartureZipCode}
                onChange={(e) => setForm({ ...form, deliveryDepartureZipCode: e.target.value })}
                disabled={!workspaceId}
              />
              <input
                className="input"
                placeholder="País (ID, 1=PT)"
                value={form.deliveryDepartureCountry}
                onChange={(e) => setForm({ ...form, deliveryDepartureCountry: e.target.value })}
                disabled={!workspaceId}
              />
            </div>
            <p className="text-xs font-medium text-slate-600">Morada de descarga</p>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="input"
                placeholder="Morada"
                value={form.deliveryDestinationAddress}
                onChange={(e) => setForm({ ...form, deliveryDestinationAddress: e.target.value })}
                disabled={!workspaceId}
              />
              <input
                className="input"
                placeholder="Localidade"
                value={form.deliveryDestinationCity}
                onChange={(e) => setForm({ ...form, deliveryDestinationCity: e.target.value })}
                disabled={!workspaceId}
              />
              <input
                className="input"
                placeholder="Código postal"
                value={form.deliveryDestinationZipCode}
                onChange={(e) => setForm({ ...form, deliveryDestinationZipCode: e.target.value })}
                disabled={!workspaceId}
              />
              <input
                className="input"
                placeholder="País (ID, 1=PT)"
                value={form.deliveryDestinationCountry}
                onChange={(e) => setForm({ ...form, deliveryDestinationCountry: e.target.value })}
                disabled={!workspaceId}
              />
            </div>
          </FormSection>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Observações</label>
            <textarea
              className="input min-h-[80px]"
              placeholder="Nota: minimize a utilização de dados pessoais."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              disabled={!workspaceId}
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              className="btn-primary"
              disabled={loading || !workspaceId || !moloni?.healthy}
              onClick={() => void submitInvoice('issue')}
            >
              Emitir no Moloni
            </button>
            <button type="submit" className="btn-secondary" disabled={loading || !workspaceId}>
              Guardar rascunho
            </button>
          </div>
        </form>
      </section>

      <Modal
        open={createClientOpen}
        onClose={() => setCreateClientOpen(false)}
        title="Novo cliente"
        panelClassName="max-w-2xl"
      >
        <p className="mb-4 text-sm text-slate-500">
          Campos alinhados com o Moloni (geral + contactos). O cliente fica seleccionado na fatura
          após criar.
        </p>
        <BillingEntityFormFields
          form={createClientForm}
          onChange={setCreateClientForm}
          disabled={loading}
        />
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={pushClientOnCreate}
            onChange={(e) => setPushClientOnCreate(e.target.checked)}
            disabled={loading}
          />
          Enviar ao Moloni agora (senão envia ao emitir a fatura)
        </label>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setCreateClientOpen(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={loading || !workspaceId}
            onClick={() => void saveCreateClient()}
          >
            {loading ? 'A guardar…' : 'Usar na fatura'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function BillingDocumentPanel({ documentType }: { documentType: MoloniDocumentType }) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">A carregar documento…</p>}>
      <BillingDocumentPanelInner documentType={documentType} />
    </Suspense>
  );
}
