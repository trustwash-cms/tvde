import type { BillingProvider, BillingProviderConfig, InvoiceDraft, IssuedInvoiceResult } from '../../types';
import { MoloniClient } from './client';
import type { MoloniConnection } from './config';
import { mapDraftToMoloniInvoice } from './map-invoice';

export class MoloniBillingProvider implements BillingProvider {
  readonly id = 'moloni' as const;

  constructor(private readonly connection: MoloniConnection) {}

  async issueInvoice(
    draft: InvoiceDraft,
    config: BillingProviderConfig
  ): Promise<IssuedInvoiceResult> {
    const customerId = config.moloniCustomerId as number | undefined;
    const supplierId = config.moloniSupplierId as number | undefined;
    const partyId = customerId ?? supplierId;

    if (!partyId) {
      throw new Error('customer_id ou supplier_id Moloni em falta — sincronize a entidade primeiro');
    }

    const client = new MoloniClient(this.connection.accessToken);
    const payload = mapDraftToMoloniInvoice(draft, {
      companyId: this.connection.companyId,
      customerId: partyId,
      documentSetId: draft.documentSetId ?? draft.metadata?.documentSetId ?? this.connection.documentSetId,
      defaultTaxId: config.defaultTaxId as number | undefined,
    });

    const documentType = draft.documentType ?? config.documentType ?? 'invoice';
    const result = await client.insertDocument(
      documentType,
      payload as unknown as Record<string, unknown>
    );

    return {
      provider: 'moloni',
      externalId: String(result.document_id ?? ''),
      documentNumber: result.number,
      raw: result,
    };
  }
}
