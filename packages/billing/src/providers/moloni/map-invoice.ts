import { computeLine } from '../../calculations';
import type { InvoiceDraft } from '../../types';
import type { InvoiceLineInput } from '../../types';
import type { MoloniDocumentDetail, MoloniDocumentProductRow } from './client';

export interface MoloniInvoicePayload {
  company_id: number;
  customer_id: number;
  document_set_id?: number;
  date: string;
  expiration_date?: string;
  your_reference?: string;
  our_reference?: string;
  notes?: string;
  status: number;
  financial_discount?: number;
  special_discount?: number;
  related_documents_notes?: string;
  delivery_method_id?: number;
  delivery_datetime?: string;
  delivery_departure_address?: string;
  delivery_departure_city?: string;
  delivery_departure_zip_code?: string;
  delivery_departure_country?: number;
  delivery_destination_address?: string;
  delivery_destination_city?: string;
  delivery_destination_zip_code?: string;
  delivery_destination_country?: number;
  vehicle_number_plate?: string;
  products: Array<{
    product_id?: number;
    name: string;
    summary?: string;
    qty: number;
    price: number;
    exemption_reason?: string;
    taxes?: Array<{ tax_id: number; value?: number; order?: number; cumulative?: number }>;
  }>;
}

/** Mapeia rascunho CMS → body Moloni invoices/insert */
export function mapDraftToMoloniInvoice(
  draft: InvoiceDraft,
  options: {
    companyId: number;
    customerId: number;
    documentSetId?: number;
    defaultTaxId?: number;
  }
): MoloniInvoicePayload {
  const meta = draft.metadata ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const issueDate = draft.issueDate?.slice(0, 10) ?? meta.issueDate?.slice(0, 10) ?? today;
  const expirationDate =
    meta.expirationDate?.slice(0, 10) ??
    draft.dueDate?.slice(0, 10) ??
    issueDate;

  const payload: MoloniInvoicePayload = {
    company_id: options.companyId,
    customer_id: options.customerId,
    document_set_id: draft.documentSetId ?? meta.documentSetId ?? options.documentSetId,
    date: issueDate,
    expiration_date: expirationDate,
    your_reference: draft.yourReference ?? meta.yourReference ?? '',
    our_reference: meta.ourReference ?? '',
    notes: draft.notes ?? '',
    status: 1,
    products: draft.lines.map((line) => {
      const computed = computeLine(line);
      const taxId = line.moloniTaxId ?? options.defaultTaxId;
      const vatRate = line.vatRate ?? 23;
      const needsExemption = vatRate === 0;
      const exemptionReason = line.moloniExemptionReason ?? (needsExemption ? 'M07' : undefined);

      if (!line.moloniProductId) {
        throw new Error(
          `Linha "${line.description}" sem product_id Moloni — selecione um artigo ou use emissão que cria artigo automático`
        );
      }

      return {
        product_id: line.moloniProductId,
        name: line.description,
        ...(line.summary?.trim()
          ? { summary: line.summary.trim().slice(0, 250) }
          : {}),
        qty: computed.quantity,
        price: computed.unitPrice,
        ...(exemptionReason ? { exemption_reason: exemptionReason } : {}),
        ...(taxId
          ? {
              taxes: [
                {
                  tax_id: taxId,
                  value: vatRate,
                  order: 1,
                  cumulative: 0,
                },
              ],
            }
          : {}),
      };
    }),
  };

  if (meta.financialDiscount != null) payload.financial_discount = meta.financialDiscount;
  if (meta.specialDiscount != null) payload.special_discount = meta.specialDiscount;
  if (meta.relatedDocumentsNotes) payload.related_documents_notes = meta.relatedDocumentsNotes;
  if (meta.deliveryMethodId) payload.delivery_method_id = meta.deliveryMethodId;
  if (meta.deliveryDatetime) payload.delivery_datetime = meta.deliveryDatetime.slice(0, 10);
  if (meta.deliveryDepartureAddress) payload.delivery_departure_address = meta.deliveryDepartureAddress;
  if (meta.deliveryDepartureCity) payload.delivery_departure_city = meta.deliveryDepartureCity;
  if (meta.deliveryDepartureZipCode) payload.delivery_departure_zip_code = meta.deliveryDepartureZipCode;
  if (meta.deliveryDepartureCountry) payload.delivery_departure_country = meta.deliveryDepartureCountry;
  if (meta.deliveryDestinationAddress) payload.delivery_destination_address = meta.deliveryDestinationAddress;
  if (meta.deliveryDestinationCity) payload.delivery_destination_city = meta.deliveryDestinationCity;
  if (meta.deliveryDestinationZipCode) payload.delivery_destination_zip_code = meta.deliveryDestinationZipCode;
  if (meta.deliveryDestinationCountry) payload.delivery_destination_country = meta.deliveryDestinationCountry;
  if (meta.vehicleNumberPlate) payload.vehicle_number_plate = meta.vehicleNumberPlate;

  return payload;
}

/** Moloni getOne products → linhas de rascunho CMS */
export function mapMoloniProductsToInvoiceLines(
  products: MoloniDocumentProductRow[]
): InvoiceLineInput[] {
  return products.map((product) => ({
    description: product.name,
    summary: product.summary?.trim() || undefined,
    quantity: Number(product.qty) || 1,
    unitPrice: Number(product.price) || 0,
    vatRate: product.taxes?.[0]?.value != null ? Number(product.taxes[0].value) : 0,
    moloniProductId: product.product_id,
    moloniTaxId: product.taxes?.[0]?.tax_id,
    productReference: product.reference || undefined,
    moloniExemptionReason: product.exemption_reason || undefined,
  }));
}

export function metadataFromMoloniDocument(
  doc: MoloniDocumentDetail
): InvoiceDraft['metadata'] {
  return {
    documentSetId: doc.document_set_id,
    issueDate: doc.date?.slice(0, 10),
    expirationDate: doc.expiration_date?.slice(0, 10) ?? undefined,
    yourReference: doc.your_reference || undefined,
    ourReference: doc.our_reference || undefined,
    financialDiscount: doc.financial_discount || undefined,
    specialDiscount: doc.special_discount || undefined,
    relatedDocumentsNotes: doc.related_documents_notes || undefined,
    deliveryMethodId: doc.delivery_method_id || undefined,
    deliveryDatetime: doc.delivery_datetime?.slice(0, 10) ?? undefined,
    deliveryDepartureAddress: doc.delivery_departure_address || undefined,
    deliveryDepartureCity: doc.delivery_departure_city || undefined,
    deliveryDepartureZipCode: doc.delivery_departure_zip_code || undefined,
    deliveryDepartureCountry: doc.delivery_departure_country || undefined,
    deliveryDestinationAddress: doc.delivery_destination_address || undefined,
    deliveryDestinationCity: doc.delivery_destination_city || undefined,
    deliveryDestinationZipCode: doc.delivery_destination_zip_code || undefined,
    deliveryDestinationCountry: doc.delivery_destination_country || undefined,
    vehicleNumberPlate: doc.vehicle_number_plate || undefined,
  };
}
