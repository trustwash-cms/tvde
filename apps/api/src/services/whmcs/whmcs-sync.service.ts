import { prisma } from '@tvde/database';
import { createBillingEntity } from '../billing-entity.service';
import { createInvoice, issueInvoiceToMoloni, sendInvoiceEmail } from '../billing.service';
import {
  createWhmcsClientFromStored,
  formatWhmcsErrorForStorage,
  getWhmcsConnection,
} from './whmcs-connection.service';
import type { WhmcsClientDetails, WhmcsInvoiceDetail } from './whmcs-api.client';
import { getEgressPublicIp } from '../../lib/egress-ip';

const FINAL_CONSUMER_VAT = '999999990';

function parseMoney(raw: string | number | undefined | null): number {
  if (raw == null) return 0;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parseWhmcsDate(raw: string | undefined | null): Date | null {
  if (!raw || raw.startsWith('0000')) return null;
  // WHMCS: YYYY-MM-DD or YYYY-MM-DD HH:mm:ss
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + (raw.length === 10 ? 'T12:00:00' : ''));
  return Number.isNaN(d.getTime()) ? null : d;
}

function lookbackDateIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.max(1, days));
  return d.toISOString().slice(0, 10);
}

function clientDisplayName(client: WhmcsClientDetails): string {
  const company = client.companyname?.trim();
  if (company) return company;
  const full = [client.firstname, client.lastname].filter(Boolean).join(' ').trim();
  return full || client.email?.trim() || 'Cliente WHMCS';
}

function clientVat(client: WhmcsClientDetails): { vat: string; isFinalConsumer: boolean } {
  const tax = (client.tax_id ?? '').replace(/\s/g, '').trim();
  if (tax && /^\d{9}$/.test(tax)) {
    return { vat: tax, isFinalConsumer: tax === FINAL_CONSUMER_VAT };
  }
  return { vat: FINAL_CONSUMER_VAT, isFinalConsumer: true };
}

function slugRef(description: string, fallbackId: number): string {
  const base = description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return (base || `WHMCS-${fallbackId}`).slice(0, 30);
}

export async function listWhmcsInvoiceMaps(
  workspaceId: string,
  tenantId: string,
  options?: { status?: string; limit?: number; offset?: number }
) {
  const where = {
    workspaceId,
    tenantId,
    ...(options?.status ? { status: options.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.whmcsInvoiceMap.findMany({
      where,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      include: {
        billingInvoice: {
          select: { id: true, number: true, status: true, total: true, externalId: true },
        },
      },
    }),
    prisma.whmcsInvoiceMap.count({ where }),
  ]);
  return { rows, total };
}

async function ensureEntityFromWhmcsClient(input: {
  tenantId: string;
  workspaceId: string;
  client: WhmcsClientDetails;
  whmcsClientId: number;
}) {
  const { vat, isFinalConsumer } = clientVat(input.client);
  const name = clientDisplayName(input.client);
  const { entity } = await createBillingEntity({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    name,
    vat,
    isFinalConsumer,
    email: input.client.email ?? null,
    phone: input.client.phonenumber ?? null,
    address: [input.client.address1, input.client.address2].filter(Boolean).join(', ') || null,
    city: input.client.city ?? null,
    zipCode: input.client.postcode ?? null,
    countryId: 1,
    pushToMoloni: true,
  });

  return entity;
}

/**
 * Processa uma fatura WHMCS Paid → draft CMS → issue Moloni (fatura-recibo) → gestão.
 */
export async function processWhmcsPaidInvoice(input: {
  workspaceId: string;
  tenantId: string;
  whmcsInvoiceId: number;
  force?: boolean;
}) {
  const conn = await getWhmcsConnection(input.workspaceId);
  if (!conn?.isActive) throw new Error('WHMCS desactivado ou não configurado');
  if (!conn.emitOnPaid && !input.force) {
    throw new Error('Emissão automática ao pagar está desactivada');
  }

  const existing = await prisma.whmcsInvoiceMap.findUnique({
    where: {
      workspaceId_whmcsInvoiceId: {
        workspaceId: input.workspaceId,
        whmcsInvoiceId: input.whmcsInvoiceId,
      },
    },
  });

  if (existing?.status === 'issued' && existing.billingInvoiceId && !input.force) {
    return { skipped: true as const, reason: 'already_issued', mapId: existing.id };
  }

  const map = await prisma.whmcsInvoiceMap.upsert({
    where: {
      workspaceId_whmcsInvoiceId: {
        workspaceId: input.workspaceId,
        whmcsInvoiceId: input.whmcsInvoiceId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      tenantId: input.tenantId,
      whmcsInvoiceId: input.whmcsInvoiceId,
      status: 'processing',
    },
    update: {
      status: 'processing',
      lastError: null,
    },
  });

  try {
    const { client, row } = await createWhmcsClientFromStored(input.workspaceId);
    const detail = await client.getInvoice(input.whmcsInvoiceId);
    if (String(detail.status).toLowerCase() !== 'paid') {
      throw new Error(`Fatura WHMCS #${input.whmcsInvoiceId} não está Paid (status=${detail.status})`);
    }

    const whmcsClientId = Number(detail.userid);
    const whmcsClient = await client.getClientDetails(whmcsClientId);
    const entity = await ensureEntityFromWhmcsClient({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      client: whmcsClient,
      whmcsClientId,
    });

    const rawLines = client.getInvoiceLines(detail);
    const taxRate = parseMoney(detail.taxrate) || 23;
    const lines =
      rawLines.length > 0
        ? rawLines
            .filter((l) => parseMoney(l.amount) !== 0 || (l.description ?? '').trim())
            .map((l) => {
              const amount = parseMoney(l.amount);
              const taxed = Number(l.taxed) === 1;
              const desc = (l.description || `Item WHMCS ${l.id}`).trim().slice(0, 250);
              return {
                description: desc,
                summary: `WHMCS #${detail.invoicenum || detail.id}`.slice(0, 250),
                quantity: 1,
                unitPrice: amount,
                vatRate: taxed ? taxRate : 0,
                productReference: slugRef(desc, l.id),
              };
            })
        : [
            {
              description: `Fatura WHMCS #${detail.invoicenum || detail.id}`,
              summary: undefined as string | undefined,
              quantity: 1,
              unitPrice: parseMoney(detail.total),
              vatRate: taxRate,
              productReference: `WHMCS-${detail.id}`.slice(0, 30),
            },
          ];

    if (lines.length === 0) {
      throw new Error('Fatura WHMCS sem linhas utilizáveis');
    }

    const paidAt = parseWhmcsDate(detail.datepaid) ?? new Date();
    const dueDate = parseWhmcsDate(detail.duedate) ?? paidAt;

    const draft = await createInvoice({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      billingEntityId: entity.id,
      documentType: row.documentType || 'invoice_receipt',
      lines,
      dueDate: dueDate.toISOString().slice(0, 10),
      issueDate: paidAt.toISOString().slice(0, 10),
      notes: `Origem WHMCS invoice #${detail.id}${detail.invoicenum ? ` (${detail.invoicenum})` : ''}`,
      documentSetId: row.documentSetId ?? undefined,
      metadata: {
        yourReference: `WHMCS-${detail.id}`,
      },
    });

    // Keep WHMCS ids on the draft for audit / dedupe diagnostics
    await prisma.invoice.update({
      where: { id: draft.id },
      data: {
        metadataJson: {
          yourReference: `WHMCS-${detail.id}`,
          whmcsInvoiceId: detail.id,
          whmcsInvoiceNum: detail.invoicenum || null,
          whmcsClientId,
        },
      },
    });

    const issued = await issueInvoiceToMoloni(draft.id, input.tenantId);

    if (row.sendEmailOnIssue) {
      try {
        const toEmail = entity.email?.trim() || whmcsClient.email?.trim();
        if (toEmail) {
          await sendInvoiceEmail(issued.id, input.tenantId, { toEmail });
        }
      } catch (emailErr) {
        console.warn(
          '[whmcs] email falhou após emissão',
          emailErr instanceof Error ? emailErr.message : emailErr
        );
      }
    }

    await prisma.whmcsInvoiceMap.update({
      where: { id: map.id },
      data: {
        status: 'issued',
        billingInvoiceId: issued.id,
        moloniExternalId: issued.externalId,
        whmcsInvoiceNum: detail.invoicenum || String(detail.id),
        whmcsClientId,
        amountTotal: parseMoney(detail.total),
        currency: detail.currencycode || 'EUR',
        paidAt,
        processedAt: new Date(),
        lastError: null,
      },
    });

    return {
      skipped: false as const,
      mapId: map.id,
      billingInvoiceId: issued.id,
      moloniExternalId: issued.externalId,
      number: issued.number,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao processar fatura WHMCS';
    await prisma.whmcsInvoiceMap.update({
      where: { id: map.id },
      data: {
        status: 'failed',
        lastError: message.slice(0, 2000),
        processedAt: new Date(),
      },
    });
    throw err;
  }
}

/**
 * Poll WHMCS Paid invoices and emit missing ones.
 */
export async function syncWhmcsPaidInvoices(options?: {
  workspaceId?: string;
  limitPerWorkspace?: number;
}) {
  const connections = await prisma.whmcsConnection.findMany({
    where: {
      isActive: true,
      emitOnPaid: true,
      ...(options?.workspaceId ? { workspaceId: options.workspaceId } : {}),
    },
  });

  const summary = {
    workspaces: 0,
    discovered: 0,
    issued: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const conn of connections) {
    summary.workspaces += 1;
    try {
      const { client } = await createWhmcsClientFromStored(conn.workspaceId);
      const from = lookbackDateIso(conn.pollLookbackDays);
      const { invoices } = await client.getPaidInvoices({
        limitStart: 0,
        limitNum: options?.limitPerWorkspace ?? 40,
        datepaidFrom: from,
      });

      await prisma.whmcsConnection.update({
        where: { id: conn.id },
        data: { lastPolledAt: new Date(), lastError: null },
      });

      for (const inv of invoices) {
        summary.discovered += 1;
        const existing = await prisma.whmcsInvoiceMap.findUnique({
          where: {
            workspaceId_whmcsInvoiceId: {
              workspaceId: conn.workspaceId,
              whmcsInvoiceId: inv.id,
            },
          },
        });
        if (existing?.status === 'issued') {
          summary.skipped += 1;
          continue;
        }
        if (existing?.status === 'processing') {
          summary.skipped += 1;
          continue;
        }

        try {
          const result = await processWhmcsPaidInvoice({
            workspaceId: conn.workspaceId,
            tenantId: conn.tenantId,
            whmcsInvoiceId: inv.id,
          });
          if (result.skipped) summary.skipped += 1;
          else summary.issued += 1;
        } catch (err) {
          summary.failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          summary.errors.push(`#${inv.id}: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const egressIp = await getEgressPublicIp();
      const stored = formatWhmcsErrorForStorage(msg, egressIp);
      summary.errors.push(`workspace ${conn.workspaceId}: ${stored}`);
      await prisma.whmcsConnection.update({
        where: { id: conn.id },
        data: { lastError: stored.slice(0, 2000), lastPolledAt: new Date() },
      });
    }
  }

  return summary;
}
