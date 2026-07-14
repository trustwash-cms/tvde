/** Tipos de domínio do módulo — sem dependências do CMS. */

export type BillingProviderId = 'local' | 'moloni';

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled' | 'failed';

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number;
  productId?: string;
  moloniProductId?: number;
  moloniTaxId?: number;
  /** Código de isenção Moloni (M01–M99) — obrigatório quando vatRate é 0 */
  moloniExemptionReason?: string;
}

/** Campos extra alinhados com Moloni invoices/insert */
export interface InvoiceMoloniMetadata {
  documentSetId?: number;
  issueDate?: string;
  expirationDate?: string;
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
}

export interface InvoiceLineComputed extends InvoiceLineInput {
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
}

export interface InvoiceTotals {
  subtotal: number;
  vatAmount: number;
  total: number;
}

export type MoloniDocumentTypeId =
  | 'invoice'
  | 'simplified_invoice'
  | 'invoice_receipt'
  | 'debit_note';

export interface InvoiceDraft {
  clientId: string;
  clientName?: string;
  clientNif?: string;
  clientEmail?: string;
  documentType?: MoloniDocumentTypeId;
  lines: InvoiceLineInput[];
  dueDate?: string;
  notes?: string;
  yourReference?: string;
  issueDate?: string;
  documentSetId?: number;
  metadata?: InvoiceMoloniMetadata;
}

export interface IssuedInvoiceResult {
  provider: BillingProviderId;
  externalId: string;
  documentNumber?: string;
  pdfUrl?: string;
  raw?: unknown;
}

export interface BillingProviderConfig {
  provider: BillingProviderId;
  accessToken?: string;
  companyId?: string | number;
  documentSetId?: string | number;
  documentType?: MoloniDocumentTypeId;
  moloniCustomerId?: number;
  moloniSupplierId?: number;
  defaultTaxId?: number;
  [key: string]: unknown;
}

export interface BillingProvider {
  readonly id: BillingProviderId;
  issueInvoice(draft: InvoiceDraft, config: BillingProviderConfig): Promise<IssuedInvoiceResult>;
}
