/**
 * Proxy de leitura WHMCS (CRM) — sem persistência local.
 */
import { getEgressPublicIp } from '../../lib/egress-ip';
import { createWhmcsClientFromStored } from './whmcs-connection.service';
import {
  parseWhmcsAuthFailedError,
  parseWhmcsInvalidIpError,
} from './whmcs-ip-access';
import { WhmcsApiClient, whmcsAdminLinks } from './whmcs-api.client';

export class WhmcsPortalError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WhmcsPortalError';
    this.status = status;
    this.payload = payload;
  }
}

function formatClientLabel(details: {
  firstname?: string;
  lastname?: string;
  companyname?: string;
  id?: number;
  userid?: number;
}): string {
  const name = [details.firstname, details.lastname].filter(Boolean).join(' ').trim();
  const company = (details.companyname || '').trim();
  if (name && company) return `${name} (${company})`;
  if (name) return name;
  if (company) return company;
  const id = details.userid ?? details.id;
  return id ? `Cliente #${id}` : 'Cliente';
}

/** Resolve nomes de clientes para IDs únicos (GetClientsDetails em paralelo). */
async function resolveClientLabels(
  client: WhmcsApiClient,
  userIds: number[]
): Promise<Map<number, { clientName: string; clientCompany: string }>> {
  const unique = [...new Set(userIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map<number, { clientName: string; clientCompany: string }>();
  await Promise.all(
    unique.map(async (id) => {
      try {
        const d = await client.getClientDetails(id);
        map.set(id, {
          clientName: formatClientLabel(d),
          clientCompany: (d.companyname || '').trim(),
        });
      } catch {
        map.set(id, { clientName: `Cliente #${id}`, clientCompany: '' });
      }
    })
  );
  return map;
}

async function withClient(workspaceId: string) {
  try {
    const { row, client } = await createWhmcsClientFromStored(workspaceId);
    return { row, client, links: whmcsAdminLinks(row.apiUrl) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'WHMCS não disponível';
    throw new WhmcsPortalError(400, message);
  }
}

async function wrapWhmcsCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha WHMCS';
    const egressIp = await getEgressPublicIp();
    const ipBlocked = parseWhmcsInvalidIpError(message, egressIp);
    if (ipBlocked) {
      throw new WhmcsPortalError(400, ipBlocked.hint, {
        whmcsIpBlocked: true,
        blockedIp: ipBlocked.blockedIp,
        hint: ipBlocked.hint,
        egressIp,
      });
    }
    const authFailed = parseWhmcsAuthFailedError(message);
    if (authFailed) {
      throw new WhmcsPortalError(400, authFailed.hint, {
        whmcsAuthFailed: true,
        hint: authFailed.hint,
        egressIp,
      });
    }
    throw new WhmcsPortalError(400, message, { egressIp });
  }
}

export async function portalListClients(
  workspaceId: string,
  input: { limitStart?: number; limitNum?: number; search?: string; status?: string }
) {
  const { client, links } = await withClient(workspaceId);
  const data = await wrapWhmcsCall(() => client.getClients(input));
  return {
    ...data,
    adminLinks: { base: links.base },
    rows: data.clients.map((c) => ({
      ...c,
      clientName: formatClientLabel(c),
      openInWhmcs: links.clientSummary(c.id),
    })),
  };
}

export async function portalGetClient(workspaceId: string, clientId: number) {
  const { client, links } = await withClient(workspaceId);
  const details = await wrapWhmcsCall(() => client.getClientDetails(clientId, { stats: true }));
  const userid = Number(details.userid ?? details.id ?? clientId);

  const [services, domains, invoices] = await Promise.all([
    wrapWhmcsCall(() => client.getClientsProducts({ clientId: userid, limitNum: 100 })),
    wrapWhmcsCall(() => client.getClientsDomains({ clientId: userid, limitNum: 100 })),
    wrapWhmcsCall(() => client.getInvoices({ userId: userid, limitNum: 50 })),
  ]);

  return {
    client: details,
    stats: details.stats ?? null,
    services: services.products,
    domains: domains.domains,
    invoices: invoices.invoices,
    counts: {
      services: services.total,
      domains: domains.total,
      invoices: invoices.total,
    },
    openInWhmcs: {
      summary: links.clientSummary(userid),
      profile: links.clientProfile(userid),
      services: links.clientServices(userid),
      domains: links.clientDomains(userid),
      invoices: links.clientInvoices(userid),
    },
  };
}

export async function portalListInvoices(
  workspaceId: string,
  input: {
    limitStart?: number;
    limitNum?: number;
    status?: string;
    userId?: number;
  }
) {
  const { client, links } = await withClient(workspaceId);
  const data = await wrapWhmcsCall(() => client.getInvoices(input));
  const labels = await resolveClientLabels(
    client,
    data.invoices.map((inv) => inv.userid)
  );
  return {
    total: data.total,
    rows: data.invoices.map((inv) => ({
      ...inv,
      clientName: labels.get(inv.userid)?.clientName ?? `Cliente #${inv.userid}`,
      openInWhmcs: links.invoice(inv.id),
      openClientInWhmcs: links.clientSummary(inv.userid),
    })),
  };
}

export async function portalGetInvoice(workspaceId: string, invoiceId: number) {
  const { client, links } = await withClient(workspaceId);
  const detail = await wrapWhmcsCall(() => client.getInvoice(invoiceId));
  const lines = client.getInvoiceLines(detail);
  const labels = await resolveClientLabels(client, [detail.userid]);
  return {
    invoice: detail,
    lines,
    clientName: labels.get(detail.userid)?.clientName ?? `Cliente #${detail.userid}`,
    openInWhmcs: links.invoice(detail.id),
    openClientInWhmcs: links.clientSummary(detail.userid),
  };
}

export async function portalListServices(
  workspaceId: string,
  input: { limitStart?: number; limitNum?: number; clientId?: number }
) {
  const { client, links } = await withClient(workspaceId);
  const data = await wrapWhmcsCall(() => client.getClientsProducts(input));
  const labels = await resolveClientLabels(
    client,
    data.products.map((p) => p.clientid)
  );
  return {
    total: data.total,
    rows: data.products.map((p) => ({
      ...p,
      clientName: labels.get(p.clientid)?.clientName ?? `Cliente #${p.clientid}`,
      openInWhmcs: links.clientService(p.clientid, p.id),
      openClientInWhmcs: links.clientSummary(p.clientid),
    })),
  };
}

export async function portalListDomains(
  workspaceId: string,
  input: { limitStart?: number; limitNum?: number; clientId?: number }
) {
  const { client, links } = await withClient(workspaceId);
  const data = await wrapWhmcsCall(() => client.getClientsDomains(input));
  const labels = await resolveClientLabels(
    client,
    data.domains.map((d) => d.userid)
  );
  return {
    total: data.total,
    rows: data.domains.map((d) => ({
      ...d,
      domain: d.domain || d.domainname || '',
      clientName: labels.get(d.userid)?.clientName ?? `Cliente #${d.userid}`,
      openInWhmcs: links.clientDomain(d.userid, d.id),
      openClientInWhmcs: links.clientSummary(d.userid),
    })),
  };
}

export async function portalListProducts(workspaceId: string, input?: { pid?: number; gid?: number }) {
  const { client, links } = await withClient(workspaceId);
  const data = await wrapWhmcsCall(() => client.getProducts(input));
  return {
    total: data.total,
    rows: data.products.map((p) => ({
      ...p,
      openInWhmcs: links.product(p.pid),
    })),
  };
}

export async function portalUpdateClient(
  workspaceId: string,
  clientId: number,
  fields: Partial<{
    firstname: string;
    lastname: string;
    companyname: string;
    email: string;
    address1: string;
    address2: string;
    city: string;
    state: string;
    postcode: string;
    country: string;
    phonenumber: string;
    tax_id: string;
    notes: string;
    status: string;
  }>
) {
  const { client } = await withClient(workspaceId);
  await wrapWhmcsCall(() => client.updateClient(clientId, fields));
  return portalGetClient(workspaceId, clientId);
}

export async function portalSendClientEmail(
  workspaceId: string,
  clientId: number,
  input: { subject: string; message: string }
) {
  const { client } = await withClient(workspaceId);
  await wrapWhmcsCall(() =>
    client.sendEmail({
      id: clientId,
      customtype: 'general',
      customsubject: input.subject,
      custommessage: input.message,
    })
  );
  return { ok: true as const };
}

export async function portalSendInvoiceEmail(
  workspaceId: string,
  invoiceId: number,
  input?: { messagename?: string }
) {
  const { client } = await withClient(workspaceId);
  await wrapWhmcsCall(() =>
    client.sendEmail({
      id: invoiceId,
      messagename: input?.messagename || 'Invoice Created',
    })
  );
  return { ok: true as const };
}

export async function portalMarkInvoicePaid(
  workspaceId: string,
  invoiceId: number,
  input?: { gateway?: string; transId?: string; amount?: number; sendEmail?: boolean }
) {
  const { client } = await withClient(workspaceId);
  const detail = await wrapWhmcsCall(() => client.getInvoice(invoiceId));
  const status = String(detail.status || '');
  if (status.toLowerCase() === 'cancelled') {
    throw new WhmcsPortalError(400, 'Não é possível marcar paga uma fatura Cancelled');
  }
  if (status.toLowerCase() === 'paid') {
    throw new WhmcsPortalError(400, 'Fatura já está Paid');
  }

  let gateway = input?.gateway?.trim();
  if (!gateway) {
    gateway = detail.paymentmethod || 'mailin';
    if (!gateway || gateway === '') {
      try {
        const methods = await wrapWhmcsCall(() => client.getPaymentMethods());
        gateway = methods[0]?.module || 'mailin';
      } catch {
        gateway = 'mailin';
      }
    }
  }

  const transId =
    input?.transId?.trim() ||
    `tvde-${invoiceId}-${Date.now().toString(36)}`;

  await wrapWhmcsCall(() =>
    client.addInvoicePayment({
      invoiceId,
      transId,
      gateway,
      amount: input?.amount,
      noemail: input?.sendEmail === false,
    })
  );

  return portalGetInvoice(workspaceId, invoiceId);
}

export async function portalCancelInvoice(workspaceId: string, invoiceId: number) {
  const { client } = await withClient(workspaceId);
  const detail = await wrapWhmcsCall(() => client.getInvoice(invoiceId));
  const status = String(detail.status || '').toLowerCase();
  if (status === 'paid') {
    throw new WhmcsPortalError(400, 'Não é possível cancelar uma fatura Paid');
  }
  if (status === 'cancelled') {
    throw new WhmcsPortalError(400, 'Fatura já está Cancelled');
  }
  await wrapWhmcsCall(() => client.updateInvoiceStatus(invoiceId, 'Cancelled'));
  return portalGetInvoice(workspaceId, invoiceId);
}

export async function portalMarkInvoiceUnpaid(workspaceId: string, invoiceId: number) {
  const { client } = await withClient(workspaceId);
  const detail = await wrapWhmcsCall(() => client.getInvoice(invoiceId));
  const status = String(detail.status || '').toLowerCase();
  if (status === 'unpaid') {
    throw new WhmcsPortalError(400, 'Fatura já está Unpaid');
  }
  if (status === 'cancelled') {
    throw new WhmcsPortalError(400, 'Não é possível reabrir uma fatura Cancelled para Unpaid');
  }
  await wrapWhmcsCall(() => client.updateInvoiceStatus(invoiceId, 'Unpaid'));
  return portalGetInvoice(workspaceId, invoiceId);
}

export async function portalUpdateInvoice(
  workspaceId: string,
  invoiceId: number,
  input: {
    status?: string;
    paymentmethod?: string;
    date?: string;
    duedate?: string;
    datepaid?: string;
    notes?: string;
    taxrate?: number;
    taxrate2?: number;
    credit?: number;
    lines?: Array<{ id: number; description: string; amount: number | string; taxed?: boolean }>;
    newLines?: Array<{ description: string; amount: number | string; taxed?: boolean }>;
    deleteLineIds?: number[];
  }
) {
  const { client } = await withClient(workspaceId);
  await wrapWhmcsCall(() => client.getInvoice(invoiceId));

  const itemdescription: Record<string, string> = {};
  const itemamount: Record<string, number | string> = {};
  const itemtaxed: Record<string, number> = {};
  for (const line of input.lines ?? []) {
    const key = String(line.id);
    itemdescription[key] = line.description;
    itemamount[key] = line.amount;
    itemtaxed[key] = line.taxed ? 1 : 0;
  }

  await wrapWhmcsCall(() =>
    client.updateInvoice({
      invoiceId,
      status: input.status,
      paymentmethod: input.paymentmethod,
      date: input.date,
      duedate: input.duedate,
      datepaid: input.datepaid,
      notes: input.notes,
      taxrate: input.taxrate,
      taxrate2: input.taxrate2,
      credit: input.credit,
      itemdescription: Object.keys(itemdescription).length ? itemdescription : undefined,
      itemamount: Object.keys(itemamount).length ? itemamount : undefined,
      itemtaxed: Object.keys(itemtaxed).length ? itemtaxed : undefined,
      newitemdescription: input.newLines?.map((l) => l.description),
      newitemamount: input.newLines?.map((l) => l.amount),
      newitemtaxed: input.newLines?.map((l) => (l.taxed ? 1 : 0)),
      deletelineids: input.deleteLineIds,
    })
  );

  return portalGetInvoice(workspaceId, invoiceId);
}

export async function portalDeleteInvoice(workspaceId: string, invoiceId: number) {
  const { client } = await withClient(workspaceId);
  await wrapWhmcsCall(() => client.getInvoice(invoiceId));
  try {
    await wrapWhmcsCall(() => client.deleteInvoice(invoiceId));
    return { deleted: true as const, invoiceId, fallbackCancelled: false as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const unsupported =
      /api function not found|invalid api command|unknown api|does not exist|no such function|unrecognised action|unrecognized action/i.test(
        msg
      );
    if (!unsupported) throw err;
    // Fallback: cancel when DeleteInvoice is unavailable on this WHMCS version
    await wrapWhmcsCall(() => client.updateInvoiceStatus(invoiceId, 'Cancelled'));
    return {
      deleted: false as const,
      invoiceId,
      fallbackCancelled: true as const,
      message:
        'DeleteInvoice não está disponível nesta instalação WHMCS — fatura marcada como Cancelled.',
    };
  }
}

export async function portalBulkInvoices(
  workspaceId: string,
  input: {
    action: 'mark-paid' | 'mark-unpaid' | 'cancel' | 'delete';
    invoiceIds: number[];
    gateway?: string;
    sendEmail?: boolean;
  }
) {
  const results: Array<{
    invoiceId: number;
    ok: boolean;
    error?: string;
    fallbackCancelled?: boolean;
  }> = [];

  for (const invoiceId of input.invoiceIds) {
    try {
      if (input.action === 'mark-paid') {
        await portalMarkInvoicePaid(workspaceId, invoiceId, {
          gateway: input.gateway,
          sendEmail: input.sendEmail,
        });
        results.push({ invoiceId, ok: true });
      } else if (input.action === 'mark-unpaid') {
        await portalMarkInvoiceUnpaid(workspaceId, invoiceId);
        results.push({ invoiceId, ok: true });
      } else if (input.action === 'cancel') {
        await portalCancelInvoice(workspaceId, invoiceId);
        results.push({ invoiceId, ok: true });
      } else {
        const del = await portalDeleteInvoice(workspaceId, invoiceId);
        results.push({
          invoiceId,
          ok: true,
          fallbackCancelled: del.fallbackCancelled,
        });
      }
    } catch (err) {
      results.push({
        invoiceId,
        ok: false,
        error: err instanceof Error ? err.message : 'Falha',
      });
    }
  }

  return {
    action: input.action,
    total: input.invoiceIds.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

export async function portalListPaymentMethods(workspaceId: string) {
  const { client } = await withClient(workspaceId);
  try {
    const methods = await wrapWhmcsCall(() => client.getPaymentMethods());
    return { methods };
  } catch {
    return { methods: [{ module: 'mailin', displayname: 'Mail In Payment' }] };
  }
}
