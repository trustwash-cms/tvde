import type { CalendarScheduledInvoiceLine, MoloniDocumentType } from '@tvde/shared';
import {
  enrichInvoiceLinesWithMoloniProducts,
  resolveMoloniInvoiceDefaults,
} from '../billing-moloni-line-enrichment.service';

/** @deprecated Use resolveMoloniInvoiceDefaults — kept for calendar callers. */
export async function resolveScheduledInvoiceMoloniDefaults(
  workspaceId: string,
  documentType: MoloniDocumentType = 'invoice'
) {
  return resolveMoloniInvoiceDefaults(workspaceId, documentType);
}

/** Garante product_id/tax_id Moloni nas linhas de autofatura do calendário. */
export async function enrichScheduledInvoiceLines(
  workspaceId: string,
  lines: CalendarScheduledInvoiceLine[]
): Promise<CalendarScheduledInvoiceLine[]> {
  return enrichInvoiceLinesWithMoloniProducts(workspaceId, lines);
}
