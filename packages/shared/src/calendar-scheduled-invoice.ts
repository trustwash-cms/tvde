export const CALENDAR_EVENT_TYPES = ['appointment', 'invoice'] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_SCHEDULED_INVOICE_ENABLED_KEY = 'calendar_scheduled_invoice_enabled';
export const CALENDAR_SCHEDULED_INVOICE_CATEGORY_ID_KEY = 'calendar_scheduled_invoice_category_id';

/** Limite Moloni do campo Resumo em linhas de documento. */
export const INVOICE_LINE_SUMMARY_MAX_LENGTH = 250;

export interface CalendarScheduledInvoiceLine {
  description: string;
  /** Resumo Moloni (0–250 chars) — ex. período «mês A até mês B» */
  summary?: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number;
  moloniProductId?: number;
  /** Ref.ª Artigo Moloni (linha manual) — obrigatória se não houver moloniProductId */
  productReference?: string;
  moloniTaxId?: number;
  moloniExemptionReason?: string;
}

export interface CalendarScheduledInvoiceDraft {
  billingEntityId: string;
  clientEmail: string;
  lines: CalendarScheduledInvoiceLine[];
  documentType?: string;
  notes?: string;
  autoIssue: boolean;
  sendEmail: boolean;
}

export interface CalendarScheduledInvoiceSummary {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  scheduledAt: string;
  billingEntityId: string;
  invoiceId: string | null;
  errorMessage: string | null;
  emailSentAt: string | null;
  emailSent: boolean;
  emailErrorMessage: string | null;
  draft: CalendarScheduledInvoiceDraft;
  billingEntity?: {
    id: string;
    name: string;
    email: string | null;
  };
}
