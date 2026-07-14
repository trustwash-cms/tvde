'use client';

import { Plus, Trash2 } from 'lucide-react';
import { parseMoloniInvoiceErrorMessage } from '@tvde/shared';
import {
  BillingEntityPicker,
  type BillingEntityOption,
} from '@/components/billing/billing-entity-picker';
import type { CalendarScheduledInvoiceLine } from '@tvde/shared';

export interface CalendarInvoiceLineForm extends CalendarScheduledInvoiceLine {}

const MOLONI_EXEMPTION_OPTIONS = [
  { code: 'M07', label: 'M07 — Isento (art. 9º CIVA)' },
  { code: 'M16', label: 'M16 — Não confere direito a dedução' },
  { code: 'M10', label: 'M10 — Bens à consignação' },
  { code: 'M01', label: 'M01 — Exportação' },
] as const;

export function emptyInvoiceLine(): CalendarInvoiceLineForm {
  return { description: '', quantity: 1, unitPrice: 0, vatRate: 23 };
}

interface CalendarInvoiceEventFieldsProps {
  entities: BillingEntityOption[];
  billingEntityId: string;
  onBillingEntityChange: (id: string) => void;
  clientEmail: string;
  onClientEmailChange: (email: string) => void;
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
  theme?: 'light' | 'dark';
}

export function CalendarInvoiceEventFields({
  entities,
  billingEntityId,
  onBillingEntityChange,
  clientEmail,
  onClientEmailChange,
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
  theme = 'dark',
}: CalendarInvoiceEventFieldsProps) {
  const dark = theme === 'dark';
  const invoiceError = errorMessage ? parseMoloniInvoiceErrorMessage(errorMessage) : null;

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
          className={`rounded-lg border px-3 py-2 text-xs ${
            dark
              ? 'border-amber-500/40 bg-amber-950/30 text-amber-200'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <span className="font-medium">Fatura emitida, mas email falhou: </span>
          {emailErrorMessage}
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className={`text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-600'}`}>
            Linhas da fatura
          </label>
          {!readOnly && (
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={addLine}>
              <Plus size={14} className="mr-1 inline" />
              Linha
            </button>
          )}
        </div>
        {lines.map((line, index) => (
          <div
            key={index}
            className={`grid gap-2 rounded-lg border p-2 sm:grid-cols-12 ${
              dark ? 'border-slate-700/80 bg-slate-900/60' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="sm:col-span-5">
              <input
                className="input"
                value={line.description}
                disabled={readOnly}
                onChange={(e) => updateLine(index, { description: e.target.value })}
                placeholder="Descrição"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={line.quantity}
                disabled={readOnly}
                onChange={(e) => updateLine(index, { quantity: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="sm:col-span-2">
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={line.unitPrice}
                disabled={readOnly}
                onChange={(e) => updateLine(index, { unitPrice: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="sm:col-span-2">
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                step="1"
                value={line.vatRate ?? 23}
                disabled={readOnly}
                onChange={(e) => {
                  const vatRate = Number(e.target.value) || 0;
                  updateLine(index, {
                    vatRate,
                    moloniExemptionReason:
                      vatRate === 0 ? line.moloniExemptionReason ?? 'M07' : undefined,
                  });
                }}
              />
            </div>
            {(line.vatRate ?? 23) === 0 && (
              <div className="sm:col-span-12">
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
            {!readOnly && lines.length > 1 && (
              <div className="flex items-center sm:col-span-1">
                <button
                  type="button"
                  className={`rounded p-1 ${dark ? 'text-red-400 hover:bg-red-950/40' : 'text-red-600 hover:bg-red-50'}`}
                  onClick={() => removeLine(index)}
                  aria-label="Remover linha"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        ))}
        <p className={`text-[11px] ${dark ? 'text-slate-500' : 'text-slate-500'}`}>
          Quantidade · Preço unitário · IVA %
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
                Emite no Moloni com número oficial (ex. M/…)
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
                Fica no CMS — emita manualmente em Facturação
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
            Sem emissão Moloni — não é enviado email automático. Revise o rascunho em Facturação.
          </p>
        )}
      </div>
    </div>
  );
}
