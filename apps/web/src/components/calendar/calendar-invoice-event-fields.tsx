'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { parseMoloniInvoiceErrorMessage } from '@tvde/shared';
import {
  BillingEntityPicker,
  type BillingEntityOption,
} from '@/components/billing/billing-entity-picker';
import {
  BillingProductPicker,
  type BillingProductOption,
} from '@/components/billing/billing-product-picker';
import { SoftDecimalInput } from '@/components/soft-decimal-input';
import type { CalendarScheduledInvoiceLine } from '@tvde/shared';
import { INVOICE_LINE_SUMMARY_MAX_LENGTH } from '@tvde/shared';
import { API_PATHS, apiFetch, getApiErrorMessage, getStoredToken } from '@/lib/api';
import { withWorkspaceQuery } from '@/lib/workspace-query';

export interface CalendarInvoiceLineForm extends CalendarScheduledInvoiceLine {}

const MOLONI_EXEMPTION_OPTIONS = [
  { code: 'M07', label: 'M07 — Isento (art. 9º CIVA)' },
  { code: 'M16', label: 'M16 — Não confere direito a dedução' },
  { code: 'M10', label: 'M10 — Bens à consignação' },
  { code: 'M01', label: 'M01 — Exportação' },
] as const;

export function emptyInvoiceLine(): CalendarInvoiceLineForm {
  return {
    description: '',
    summary: '',
    quantity: 1,
    unitPrice: 0,
    vatRate: 23,
    productReference: '',
  };
}

interface CalendarInvoiceEventFieldsProps {
  workspaceId?: string | null;
  entities: BillingEntityOption[];
  billingEntityId: string;
  onBillingEntityChange: (id: string) => void;
  clientEmail: string;
  onClientEmailChange: (email: string) => void;
  yourReference: string;
  onYourReferenceChange: (value: string) => void;
  lines: CalendarInvoiceLineForm[];
  onLinesChange: (lines: CalendarInvoiceLineForm[]) => void;
  autoIssue: boolean;
  onAutoIssueChange: (value: boolean) => void;
  sendEmail: boolean;
  onSendEmailChange: (value: boolean) => void;
  readOnly?: boolean;
  statusLabel?: string | null;
  errorMessage?: string | null;
  emailSentAt?: string | null;
  emailSent?: boolean;
  emailErrorMessage?: string | null;
  scheduledInvoiceId?: string | null;
  onEmailResent?: (result: { emailSentAt: string }) => void;
  theme?: 'light' | 'dark';
}

export function CalendarInvoiceEventFields({
  workspaceId,
  entities,
  billingEntityId,
  onBillingEntityChange,
  clientEmail,
  onClientEmailChange,
  yourReference,
  onYourReferenceChange,
  lines,
  onLinesChange,
  autoIssue,
  onAutoIssueChange,
  sendEmail,
  onSendEmailChange,
  readOnly,
  statusLabel,
  errorMessage,
  emailSentAt,
  emailSent,
  emailErrorMessage,
  scheduledInvoiceId,
  onEmailResent,
  theme = 'dark',
}: CalendarInvoiceEventFieldsProps) {
  const dark = theme === 'dark';
  const invoiceError = errorMessage ? parseMoloniInvoiceErrorMessage(errorMessage) : null;
  const [products, setProducts] = useState<BillingProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const loadProducts = useCallback(
    (searchQ?: string) => {
      if (!workspaceId) return;
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
    [workspaceId]
  );

  useEffect(() => {
    if (!workspaceId || readOnly) return;
    loadProducts();
  }, [workspaceId, readOnly, loadProducts]);

  function updateLine(index: number, patch: Partial<CalendarInvoiceLineForm>) {
    onLinesChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    onLinesChange([...lines, emptyInvoiceLine()]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    onLinesChange(lines.filter((_, i) => i !== index));
  }

  function addProductLine(product: BillingProductOption) {
    const newLine: CalendarInvoiceLineForm = {
      description: product.name,
      summary: '',
      quantity: 1,
      unitPrice: product.price ?? 0,
      vatRate: 23,
      moloniProductId: product.productId,
      productReference: product.reference ?? '',
    };
    const emptyIdx = lines.findIndex(
      (l) => !l.description.trim() && !l.moloniProductId && !l.productReference?.trim()
    );
    if (emptyIdx >= 0) {
      onLinesChange(lines.map((line, i) => (i === emptyIdx ? newLine : line)));
    } else {
      onLinesChange([...lines, newLine]);
    }
  }

  async function resendInvoiceEmail() {
    if (!scheduledInvoiceId || !workspaceId) return;
    setResendError(null);
    setResendingEmail(true);
    const res = await apiFetch<{ emailSentAt: string }>(
      API_PATHS.calendar.scheduledInvoiceResendEmail(scheduledInvoiceId),
      {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          ...(clientEmail.trim() ? { toEmail: clientEmail.trim() } : {}),
        }),
      },
      getStoredToken()
    );
    setResendingEmail(false);
    if (!res.success || !res.data?.emailSentAt) {
      setResendError(getApiErrorMessage(res) || 'Falha ao reenviar email');
      return;
    }
    onEmailResent?.({ emailSentAt: res.data.emailSentAt });
  }

  return (
    <div
      className={
        dark
          ? 'calendar-invoice-fields-dark space-y-3 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3'
          : 'space-y-3 rounded-lg border border-amber-200/80 bg-amber-50/50 p-3'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`text-sm font-medium ${dark ? 'text-amber-200' : 'text-amber-900'}`}>
          Fatura agendada
        </p>
        {statusLabel && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              dark ? 'bg-amber-500/20 text-amber-200' : 'bg-white text-amber-800'
            }`}
          >
            {statusLabel}
          </span>
        )}
      </div>

      {invoiceError && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            dark
              ? 'border-red-500/40 bg-red-950/40 text-red-200'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <p>
            <span className="font-medium">Erro na emissão: </span>
            {invoiceError.summary}
          </p>
          {invoiceError.technical && (
            <details className="mt-2 opacity-90">
              <summary className="cursor-pointer font-medium">Detalhe técnico Moloni</summary>
              <p className="mt-1 font-mono break-all">{invoiceError.technical}</p>
            </details>
          )}
          <p className={`mt-2 ${dark ? 'text-red-300/80' : 'text-red-700/80'}`}>
            Verifique a série documental em Definições → Moloni.
          </p>
        </div>
      )}

      {emailSent && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            dark
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <span className="calendar-pro-invoice-pill__dot" aria-hidden />
          <span>
            <span className="font-medium">Email enviado</span>
            {emailSentAt && (
              <span className="opacity-80">
                {' '}
                · {new Date(emailSentAt).toLocaleString('pt-PT')}
              </span>
            )}
          </span>
        </div>
      )}

      {!emailSent && sendEmail && emailErrorMessage && (
        <div
          className={`space-y-2 rounded-lg border px-3 py-2 text-xs ${
            dark
              ? 'border-amber-500/40 bg-amber-950/30 text-amber-200'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <div>
            <span className="font-medium">Fatura emitida, mas email falhou: </span>
            {emailErrorMessage}
          </div>
          {emailErrorMessage.toLowerCase().includes('smtp') ||
          emailErrorMessage.toLowerCase().includes('ilegível') ||
          emailErrorMessage.toLowerCase().includes('authenticate') ? (
            <p className="opacity-90">
              Se a password SMTP ficou ilegível, volte a colá-la em Configurações → Moloni → Email de
              faturas, guarde, e depois reenvie.
            </p>
          ) : null}
          {scheduledInvoiceId && (
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              disabled={resendingEmail || !clientEmail.trim()}
              onClick={() => void resendInvoiceEmail()}
            >
              {resendingEmail ? 'A reenviar…' : 'Reenviar email da fatura'}
            </button>
          )}
          {resendError && <p className="text-red-600 dark:text-red-300">{resendError}</p>}
        </div>
      )}

      <div>
        <label className={`mb-1 block text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
          Cliente
        </label>
        <BillingEntityPicker
          entities={entities}
          value={billingEntityId}
          disabled={readOnly}
          theme={theme}
          onChange={(id) => onBillingEntityChange(id)}
        />
      </div>

      <div>
        <label className={`mb-1 block text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
          Email de notificação
        </label>
        <input
          className="input"
          type="email"
          value={clientEmail}
          disabled={readOnly}
          onChange={(e) => onClientEmailChange(e.target.value)}
          placeholder="cliente@example.com"
          required
        />
      </div>

      <div>
        <label className={`mb-1 block text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
          V/ Ref.ª
        </label>
        <input
          className="input"
          value={yourReference}
          disabled={readOnly}
          onChange={(e) => onYourReferenceChange(e.target.value)}
          placeholder="ex.: Avença Junho"
          maxLength={100}
          title="Referência do documento no Moloni (não é a Ref.ª Artigo da linha)"
        />
        <p className={`mt-1 text-[11px] ${dark ? 'text-slate-500' : 'text-slate-500'}`}>
          Aparece no PDF Moloni como V/ Ref.ª do documento. Diferente da Ref.ª Artigo em cada linha.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className={`text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
            Linhas da fatura
          </label>
          {!readOnly && (
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={addLine}>
              <Plus size={14} className="mr-1 inline" />
              Linha manual
            </button>
          )}
        </div>

        {!readOnly && workspaceId && (
          <div className="space-y-1">
            <label className={`block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
              Pesquisar artigo existente
            </label>
            <BillingProductPicker
              products={products}
              loading={productsLoading}
              onSearch={loadProducts}
              onSelect={addProductLine}
              disabled={readOnly}
              theme={theme}
            />
          </div>
        )}

        {lines.map((line, index) => (
          <div
            key={index}
            className={`space-y-2 rounded-lg border p-2 ${
              dark ? 'border-slate-700/80 bg-slate-900/60' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-1">
              {line.moloniProductId ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    dark ? 'bg-emerald-950/50 text-emerald-300' : 'bg-emerald-50 text-emerald-800'
                  }`}
                >
                  Catálogo{line.productReference ? ` · ${line.productReference}` : ''}
                </span>
              ) : (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    dark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  Novo artigo
                </span>
              )}
              {!readOnly && line.moloniProductId && (
                <button
                  type="button"
                  className={`text-[10px] underline ${dark ? 'text-slate-400' : 'text-slate-500'}`}
                  onClick={() =>
                    updateLine(index, { moloniProductId: undefined, productReference: '' })
                  }
                >
                  Converter em manual
                </button>
              )}
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-2">
                <div className="min-w-0">
                  <label
                    className={`mb-1 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}
                  >
                    Ref.ª Artigo
                  </label>
                  <input
                    className="input w-full font-mono text-xs"
                    value={line.productReference ?? ''}
                    disabled={readOnly || Boolean(line.moloniProductId)}
                    onChange={(e) =>
                      updateLine(index, {
                        productReference: e.target.value,
                        moloniProductId: undefined,
                      })
                    }
                    placeholder="SERV-01"
                    title="Código do artigo — distinto de V/ Ref.ª do documento"
                    required={!line.moloniProductId}
                  />
                </div>
                <div className="min-w-0">
                  <label
                    className={`mb-1 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}
                  >
                    Designação
                  </label>
                  <input
                    className="input w-full"
                    value={line.description}
                    disabled={readOnly}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    placeholder="Designação"
                    required
                  />
                </div>
              </div>
              <div>
                <label
                  className={`mb-1 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}
                >
                  Resumo
                  <span className={`ml-1 font-normal ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                    ({(line.summary ?? '').length}/{INVOICE_LINE_SUMMARY_MAX_LENGTH})
                  </span>
                </label>
                <input
                  className="input w-full"
                  value={line.summary ?? ''}
                  disabled={readOnly}
                  maxLength={INVOICE_LINE_SUMMARY_MAX_LENGTH}
                  onChange={(e) => updateLine(index, { summary: e.target.value })}
                  placeholder="Ex.: mês A até mês B"
                  title="Texto curto sob a designação no documento Moloni"
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                <div className="min-w-0">
                  <label
                    className={`mb-1 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}
                  >
                    Qtd
                  </label>
                  <SoftDecimalInput
                    className="input w-full"
                    value={line.quantity}
                    emptyAs={1}
                    min={0.01}
                    disabled={readOnly}
                    onValueChange={(quantity) => updateLine(index, { quantity })}
                    title="Quantidade"
                    aria-label="Quantidade"
                  />
                </div>
                <div className="min-w-0">
                  <label
                    className={`mb-1 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}
                  >
                    Preço
                  </label>
                  <SoftDecimalInput
                    className="input w-full"
                    value={line.unitPrice}
                    emptyAs={0}
                    min={0}
                    disabled={readOnly}
                    onValueChange={(unitPrice) => updateLine(index, { unitPrice })}
                    title="Preço unitário"
                    aria-label="Preço unitário"
                    placeholder="0"
                  />
                </div>
                <div className="min-w-0">
                  <label
                    className={`mb-1 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}
                  >
                    IVA %
                  </label>
                  <SoftDecimalInput
                    className="input w-full"
                    value={line.vatRate ?? 23}
                    emptyAs={0}
                    min={0}
                    max={100}
                    disabled={readOnly}
                    onValueChange={(vatRate) =>
                      updateLine(index, {
                        vatRate,
                        moloniExemptionReason:
                          vatRate === 0 ? line.moloniExemptionReason ?? 'M07' : undefined,
                      })
                    }
                    title="IVA %"
                    aria-label="IVA %"
                  />
                </div>
                {!readOnly && lines.length > 1 && (
                  <button
                    type="button"
                    className={`mb-0.5 shrink-0 rounded p-1.5 ${dark ? 'text-red-400 hover:bg-red-950/40' : 'text-red-600 hover:bg-red-50'}`}
                    onClick={() => removeLine(index)}
                    aria-label="Remover linha"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
            {(line.vatRate ?? 23) === 0 && (
              <div>
                <label className={`mb-1 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Motivo de isenção IVA (Moloni)
                </label>
                <select
                  className="input"
                  value={line.moloniExemptionReason ?? 'M07'}
                  disabled={readOnly}
                  onChange={(e) => updateLine(index, { moloniExemptionReason: e.target.value })}
                >
                  {MOLONI_EXEMPTION_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}
        <p className={`text-[11px] ${dark ? 'text-slate-500' : 'text-slate-500'}`}>
          A Ref.ª Artigo é um código curto e não é gerada a partir da designação.
        </p>
      </div>

      <div className="space-y-2">
        <p className={`text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
          Modo de emissão
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label
            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm transition-colors ${
              autoIssue
                ? dark
                  ? 'border-amber-400/60 bg-amber-950/30 text-amber-100'
                  : 'border-amber-400 bg-white text-amber-950'
                : dark
                  ? 'border-slate-700/80 bg-slate-900/40 text-slate-400'
                  : 'border-slate-200 bg-white text-slate-600'
            } ${readOnly ? 'cursor-default opacity-80' : ''}`}
          >
            <input
              type="radio"
              name="calendar-invoice-issue-mode"
              className="mt-0.5"
              checked={autoIssue}
              disabled={readOnly}
              onChange={() => onAutoIssueChange(true)}
            />
            <span>
              <span className="font-medium">Emitir fatura</span>
              <span className={`mt-0.5 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Na hora agendada emite no Moloni com número oficial (ex. M/…)
              </span>
            </span>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm transition-colors ${
              !autoIssue
                ? dark
                  ? 'border-amber-400/60 bg-amber-950/30 text-amber-100'
                  : 'border-amber-400 bg-white text-amber-950'
                : dark
                  ? 'border-slate-700/80 bg-slate-900/40 text-slate-400'
                  : 'border-slate-200 bg-white text-slate-600'
            } ${readOnly ? 'cursor-default opacity-80' : ''}`}
          >
            <input
              type="radio"
              name="calendar-invoice-issue-mode"
              className="mt-0.5"
              checked={!autoIssue}
              disabled={readOnly}
              onChange={() => onAutoIssueChange(false)}
            />
            <span>
              <span className="font-medium">Apenas rascunho</span>
              <span className={`mt-0.5 block text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Na hora agendada cria rascunho no CMS — emita depois em Facturação
              </span>
            </span>
          </label>
        </div>

        {autoIssue ? (
          <label
            className={`flex items-center gap-2 text-sm ${dark ? 'text-slate-300' : 'text-slate-700'}`}
          >
            <input
              type="checkbox"
              checked={sendEmail}
              disabled={readOnly}
              onChange={(e) => onSendEmailChange(e.target.checked)}
            />
            Enviar fatura por email ao cliente
          </label>
        ) : (
          <p className={`text-[11px] ${dark ? 'text-slate-500' : 'text-slate-500'}`}>
            Não cria o rascunho já ao guardar — só na data/hora do evento. Sem emissão Moloni nem email
            automático.
          </p>
        )}
      </div>
    </div>
  );
}
