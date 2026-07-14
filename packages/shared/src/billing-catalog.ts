/** Catálogo Moloni — tipos de documento e entidades (UI + API). */

export type MoloniEntityType = 'customer' | 'supplier';

export type MoloniDocumentType =
  | 'invoice'
  | 'simplified_invoice'
  | 'invoice_receipt'
  | 'debit_note';

export interface BillingNavItem {
  href: string;
  label: string;
  documentType?: MoloniDocumentType;
}

export const BILLING_ENTITY_TYPES: Array<{
  id: MoloniEntityType;
  label: string;
  moloniTable: string;
}> = [
  { id: 'customer', label: 'Clientes', moloniTable: 'customers' },
  { id: 'supplier', label: 'Fornecedores', moloniTable: 'suppliers' },
];

export const BILLING_DOCUMENT_TYPES: Array<{
  id: MoloniDocumentType;
  label: string;
  moloniEndpoint: string;
  category: 'venda';
}> = [
  { id: 'invoice', label: 'Faturas', moloniEndpoint: 'invoices/insert', category: 'venda' },
  {
    id: 'simplified_invoice',
    label: 'Faturas Simplificadas',
    moloniEndpoint: 'simplifiedInvoices/insert',
    category: 'venda',
  },
  {
    id: 'invoice_receipt',
    label: 'Faturas-Recibo',
    moloniEndpoint: 'invoiceReceipts/insert',
    category: 'venda',
  },
  { id: 'debit_note', label: 'Notas de Débito', moloniEndpoint: 'debitNotes/insert', category: 'venda' },
];

export function getDocumentTypeLabel(id: MoloniDocumentType): string {
  return BILLING_DOCUMENT_TYPES.find((d) => d.id === id)?.label ?? id;
}

/** Página de criação/edição de rascunho por tipo de documento */
export function getBillingDocumentEditPath(
  documentType: MoloniDocumentType,
  draftId: string
): string {
  const pathByType: Record<MoloniDocumentType, string> = {
    invoice: '/dashboard/billing/faturas',
    simplified_invoice: '/dashboard/billing/faturas-simplificadas',
    invoice_receipt: '/dashboard/billing/faturas-recibo',
    debit_note: '/dashboard/billing/notas-debito',
  };
  return `${pathByType[documentType]}?draft=${encodeURIComponent(draftId)}`;
}
