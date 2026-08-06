/**
 * Cliente HTTP WHMCS API (Legacy API via includes/api.php).
 * Auth: identifier + secret (API Credentials).
 */

export type WhmcsClientConfig = {
  apiUrl: string;
  identifier: string;
  secret: string;
};

export type WhmcsInvoiceListItem = {
  id: number;
  invoicenum: string;
  userid: number;
  date: string;
  duedate: string;
  datepaid: string;
  status: string;
  total: string;
  paymentmethod?: string;
  currencycode?: string;
};

export type WhmcsInvoiceLine = {
  id: number;
  type: string;
  description: string;
  amount: string;
  taxed: number;
};

export type WhmcsInvoiceDetail = WhmcsInvoiceListItem & {
  taxrate: string;
  taxrate2?: string;
  tax: string;
  subtotal: string;
  credit?: string;
  items?: { item?: WhmcsInvoiceLine | WhmcsInvoiceLine[] };
};

export type WhmcsClientDetails = {
  userid?: number;
  client_id?: number;
  id?: number;
  firstname?: string;
  lastname?: string;
  companyname?: string;
  email?: string;
  phonenumber?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  tax_id?: string;
  status?: string;
  currency_code?: string;
  datecreated?: string;
  notes?: string;
  stats?: Record<string, unknown>;
};

export type WhmcsClientListItem = {
  id: number;
  firstname: string;
  lastname: string;
  companyname: string;
  email: string;
  status: string;
  datecreated?: string;
  phonenumber?: string;
  city?: string;
  country?: string;
};

export type WhmcsServiceItem = {
  id: number;
  clientid: number;
  orderid?: number;
  pid?: number;
  name?: string;
  domain?: string;
  dedicatedip?: string;
  servername?: string;
  firstpaymentamount?: string;
  amount?: string;
  billingcycle?: string;
  nextduedate?: string;
  status?: string;
  regdate?: string;
  paymentmethod?: string;
};

export type WhmcsDomainItem = {
  id: number;
  userid: number;
  /** FQDN — WHMCS API usa `domainname` (não `domain`). */
  domain: string;
  domainname?: string;
  status?: string;
  registrar?: string;
  registrationdate?: string;
  nextduedate?: string;
  expirydate?: string;
  firstpaymentamount?: string;
  recurringamount?: string;
};

export type WhmcsProductItem = {
  pid: number;
  gid?: number;
  type?: string;
  name: string;
  description?: string;
  module?: string;
  paytype?: string;
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export class WhmcsApiClient {
  constructor(private readonly config: WhmcsClientConfig) {}

  private async call<T>(
    action: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    // Official WHMCS API Credentials auth: identifier + secret
    // (https://developers.whmcs.com/api/authentication/).
    const body = new URLSearchParams();
    body.set('action', action);
    body.set('identifier', this.config.identifier.trim());
    body.set('secret', this.config.secret.trim());
    body.set('responsetype', 'json');

    const append = (key: string, value: unknown) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => append(`${key}[${i}]`, v));
        return;
      }
      if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          append(`${key}[${k}]`, v);
        }
        return;
      }
      if (typeof value === 'boolean') {
        body.set(key, value ? '1' : '0');
        return;
      }
      body.set(key, String(value));
    };

    for (const [key, value] of Object.entries(params)) {
      append(key, value);
    }

    const res = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`WHMCS HTTP ${res.status}`);
    }

    const json = (await res.json()) as Record<string, unknown> & { result?: string; message?: string };
    if (json.result && json.result !== 'success') {
      throw new Error(json.message ? String(json.message) : `WHMCS ${action} falhou`);
    }
    return json as T;
  }

  async testConnection(): Promise<{ ok: true; sampleCount: number }> {
    const data = await this.call<{
      numreturned?: number;
      totalresults?: string | number;
      invoices?: { invoice?: WhmcsInvoiceListItem | WhmcsInvoiceListItem[] };
    }>('GetInvoices', { limitstart: 0, limitnum: 1, status: 'Paid' });
    const sampleCount = Number(data.numreturned ?? data.totalresults ?? 0) || 0;
    return { ok: true, sampleCount };
  }

  async getPaidInvoices(input: {
    limitStart?: number;
    limitNum?: number;
    /** YYYY-MM-DD — filter client-side on datepaid */
    datepaidFrom?: string;
  }): Promise<{ invoices: WhmcsInvoiceListItem[]; total: number }> {
    const data = await this.call<{
      numreturned?: number;
      totalresults?: string | number;
      invoices?: { invoice?: WhmcsInvoiceListItem | WhmcsInvoiceListItem[] };
    }>('GetInvoices', {
      limitstart: input.limitStart ?? 0,
      limitnum: input.limitNum ?? 50,
      status: 'Paid',
      orderby: 'datepaid',
      order: 'desc',
    });

    let invoices = asArray(data.invoices?.invoice).map((inv) => ({
      ...inv,
      id: Number(inv.id),
      userid: Number(inv.userid),
    }));

    if (input.datepaidFrom) {
      const from = input.datepaidFrom;
      invoices = invoices.filter((inv) => {
        const paid = (inv.datepaid || '').slice(0, 10);
        return paid >= from;
      });
    }

    const total = Number(data.totalresults ?? invoices.length) || invoices.length;
    return { invoices, total };
  }

  async getInvoices(input: {
    limitStart?: number;
    limitNum?: number;
    status?: string;
    userId?: number;
    orderby?: string;
    order?: 'asc' | 'desc';
  }): Promise<{ invoices: WhmcsInvoiceListItem[]; total: number }> {
    const params: Record<string, string | number> = {
      limitstart: input.limitStart ?? 0,
      limitnum: input.limitNum ?? 50,
      orderby: input.orderby ?? 'date',
      order: input.order ?? 'desc',
    };
    if (input.status && input.status !== 'All') params.status = input.status;
    if (input.userId) params.userid = input.userId;

    const data = await this.call<{
      totalresults?: string | number;
      invoices?: { invoice?: WhmcsInvoiceListItem | WhmcsInvoiceListItem[] };
    }>('GetInvoices', params);

    const invoices = asArray(data.invoices?.invoice).map((inv) => ({
      ...inv,
      id: Number(inv.id),
      userid: Number(inv.userid),
    }));
    const total = Number(data.totalresults ?? invoices.length) || invoices.length;
    return { invoices, total };
  }

  async getInvoice(invoiceId: number): Promise<WhmcsInvoiceDetail> {
    const data = await this.call<WhmcsInvoiceDetail & { invoiceid?: number }>('GetInvoice', {
      invoiceid: invoiceId,
    });
    return {
      ...data,
      id: Number(data.id ?? data.invoiceid ?? invoiceId),
      userid: Number(data.userid),
    };
  }

  async getClients(input: {
    limitStart?: number;
    limitNum?: number;
    search?: string;
    status?: string;
  }): Promise<{ clients: WhmcsClientListItem[]; total: number }> {
    const params: Record<string, string | number> = {
      limitstart: input.limitStart ?? 0,
      limitnum: input.limitNum ?? 50,
    };
    if (input.search?.trim()) params.search = input.search.trim();
    if (input.status && input.status !== 'All') params.status = input.status;

    const data = await this.call<{
      totalresults?: string | number;
      clients?: { client?: WhmcsClientListItem | WhmcsClientListItem[] };
    }>('GetClients', params);

    const clients = asArray(data.clients?.client).map((c) => ({
      ...c,
      id: Number(c.id),
      firstname: c.firstname ?? '',
      lastname: c.lastname ?? '',
      companyname: c.companyname ?? '',
      email: c.email ?? '',
      status: c.status ?? '',
    }));
    const total = Number(data.totalresults ?? clients.length) || clients.length;
    return { clients, total };
  }

  async getClientDetails(
    clientId: number,
    opts?: { stats?: boolean }
  ): Promise<WhmcsClientDetails> {
    const data = await this.call<WhmcsClientDetails & { client?: WhmcsClientDetails }>(
      'GetClientsDetails',
      {
        clientid: clientId,
        stats: opts?.stats ? 1 : 0,
      }
    );
    const client = data.client ?? data;
    return {
      ...client,
      userid: Number(client.userid ?? client.client_id ?? client.id ?? clientId),
      id: Number(client.id ?? client.userid ?? client.client_id ?? clientId),
    };
  }

  async getClientsProducts(input: {
    limitStart?: number;
    limitNum?: number;
    clientId?: number;
    serviceId?: number;
  }): Promise<{ products: WhmcsServiceItem[]; total: number }> {
    const params: Record<string, string | number> = {
      limitstart: input.limitStart ?? 0,
      limitnum: input.limitNum ?? 50,
    };
    if (input.clientId) params.clientid = input.clientId;
    if (input.serviceId) params.serviceid = input.serviceId;

    const data = await this.call<{
      totalresults?: string | number;
      products?: { product?: WhmcsServiceItem | WhmcsServiceItem[] };
    }>('GetClientsProducts', params);

    const products = asArray(data.products?.product).map((p) => ({
      ...p,
      id: Number(p.id),
      clientid: Number(p.clientid),
      pid: p.pid != null ? Number(p.pid) : undefined,
    }));
    const total = Number(data.totalresults ?? products.length) || products.length;
    return { products, total };
  }

  async getClientsDomains(input: {
    limitStart?: number;
    limitNum?: number;
    clientId?: number;
    domainId?: number;
  }): Promise<{ domains: WhmcsDomainItem[]; total: number }> {
    const params: Record<string, string | number> = {
      limitstart: input.limitStart ?? 0,
      limitnum: input.limitNum ?? 50,
    };
    if (input.clientId) params.clientid = input.clientId;
    if (input.domainId) params.domainid = input.domainId;

    const data = await this.call<{
      totalresults?: string | number;
      domains?: {
        domain?:
          | (WhmcsDomainItem & { domainname?: string })
          | Array<WhmcsDomainItem & { domainname?: string }>;
      };
    }>('GetClientsDomains', params);

    const domains = asArray(data.domains?.domain).map((d) => {
      const fqdn = String(
        (d as { domainname?: string }).domainname ?? d.domain ?? ''
      ).trim();
      return {
        ...d,
        id: Number(d.id),
        userid: Number(d.userid),
        domain: fqdn,
        domainname: fqdn,
      };
    });
    const total = Number(data.totalresults ?? domains.length) || domains.length;
    return { domains, total };
  }

  async getProducts(input?: {
    pid?: number;
    gid?: number;
  }): Promise<{ products: WhmcsProductItem[]; total: number }> {
    const params: Record<string, string | number> = {};
    if (input?.pid) params.pid = input.pid;
    if (input?.gid) params.gid = input.gid;

    const data = await this.call<{
      totalresults?: string | number;
      products?: { product?: WhmcsProductItem | WhmcsProductItem[] };
    }>('GetProducts', params);

    const products = asArray(data.products?.product).map((p) => ({
      ...p,
      pid: Number(p.pid),
      gid: p.gid != null ? Number(p.gid) : undefined,
      name: p.name ?? '',
    }));
    const total = Number(data.totalresults ?? products.length) || products.length;
    return { products, total };
  }

  getInvoiceLines(detail: WhmcsInvoiceDetail): WhmcsInvoiceLine[] {
    return asArray(detail.items?.item).map((line) => ({
      ...line,
      id: Number(line.id),
      taxed: Number(line.taxed ?? 0),
    }));
  }

  /** Escrita: actualizar perfil / notes do cliente. */
  async updateClient(
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
  ): Promise<{ clientid: number }> {
    const params: Record<string, string | number> = { clientid: clientId };
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      params[k] = v;
    }
    const data = await this.call<{ clientid?: string | number }>('UpdateClient', params);
    return { clientid: Number(data.clientid ?? clientId) };
  }

  async sendEmail(input: {
    id: number;
    messagename?: string;
    customtype?: 'general' | 'product' | 'domain' | 'invoice' | 'support' | 'affiliate';
    customsubject?: string;
    custommessage?: string;
  }): Promise<void> {
    const params: Record<string, string | number> = { id: input.id };
    if (input.messagename) params.messagename = input.messagename;
    if (input.customtype) params.customtype = input.customtype;
    if (input.customsubject) params.customsubject = input.customsubject;
    if (input.custommessage) params.custommessage = input.custommessage;
    await this.call('SendEmail', params);
  }

  async addInvoicePayment(input: {
    invoiceId: number;
    transId: string;
    gateway: string;
    date?: string;
    amount?: number;
    noemail?: boolean;
  }): Promise<void> {
    const params: Record<string, string | number | boolean> = {
      invoiceid: input.invoiceId,
      transid: input.transId,
      gateway: input.gateway,
      date: input.date ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    if (input.amount != null) params.amount = input.amount;
    if (input.noemail) params.noemail = true;
    await this.call('AddInvoicePayment', params);
  }

  async updateInvoiceStatus(invoiceId: number, status: string): Promise<void> {
    await this.call('UpdateInvoice', { invoiceid: invoiceId, status });
  }

  async updateInvoice(input: {
    invoiceId: number;
    status?: string;
    paymentmethod?: string;
    date?: string;
    duedate?: string;
    datepaid?: string;
    notes?: string;
    taxrate?: number;
    taxrate2?: number;
    credit?: number;
    /** lineId → description */
    itemdescription?: Record<string, string>;
    itemamount?: Record<string, number | string>;
    itemtaxed?: Record<string, boolean | number>;
    newitemdescription?: string[];
    newitemamount?: Array<number | string>;
    newitemtaxed?: Array<boolean | number>;
    deletelineids?: number[];
  }): Promise<void> {
    const params: Record<string, unknown> = { invoiceid: input.invoiceId };
    if (input.status != null) params.status = input.status;
    if (input.paymentmethod != null) params.paymentmethod = input.paymentmethod;
    if (input.date != null) params.date = input.date;
    if (input.duedate != null) params.duedate = input.duedate;
    if (input.datepaid != null) params.datepaid = input.datepaid;
    if (input.notes != null) params.notes = input.notes;
    if (input.taxrate != null) params.taxrate = input.taxrate;
    if (input.taxrate2 != null) params.taxrate2 = input.taxrate2;
    if (input.credit != null) params.credit = input.credit;
    if (input.itemdescription) params.itemdescription = input.itemdescription;
    if (input.itemamount) params.itemamount = input.itemamount;
    if (input.itemtaxed) params.itemtaxed = input.itemtaxed;
    if (input.newitemdescription?.length) params.newitemdescription = input.newitemdescription;
    if (input.newitemamount?.length) params.newitemamount = input.newitemamount;
    if (input.newitemtaxed?.length) params.newitemtaxed = input.newitemtaxed;
    if (input.deletelineids?.length) params.deletelineids = input.deletelineids;
    await this.call('UpdateInvoice', params);
  }

  /**
   * Apagar fatura. Nem todas as versões WHMCS expõem DeleteInvoice —
   * se falhar, o portal pode fazer fallback para Cancelled.
   */
  async deleteInvoice(invoiceId: number): Promise<void> {
    await this.call('DeleteInvoice', { invoiceid: invoiceId });
  }

  async createInvoice(input: {
    userId: number;
    status?: string;
    draft?: boolean;
    sendinvoice?: boolean;
    paymentmethod?: string;
    date?: string;
    duedate?: string;
    notes?: string;
    items: Array<{ description: string; amount: number | string; taxed?: boolean }>;
  }): Promise<{ invoiceId: number }> {
    const params: Record<string, unknown> = {
      userid: input.userId,
    };
    if (input.status) params.status = input.status;
    if (input.draft) params.draft = true;
    if (input.sendinvoice) params.sendinvoice = true;
    if (input.paymentmethod) params.paymentmethod = input.paymentmethod;
    if (input.date) params.date = input.date;
    if (input.duedate) params.duedate = input.duedate;
    if (input.notes) params.notes = input.notes;
    input.items.forEach((item, i) => {
      const n = i + 1;
      params[`itemdescription${n}`] = item.description;
      params[`itemamount${n}`] = item.amount;
      params[`itemtaxed${n}`] = item.taxed ? 1 : 0;
    });
    const data = await this.call<{ invoiceid?: string | number }>('CreateInvoice', params);
    return { invoiceId: Number(data.invoiceid) };
  }

  async getPaymentMethods(): Promise<Array<{ module: string; displayname: string }>> {
    const data = await this.call<{
      paymentmethods?: {
        paymentmethod?:
          | { module: string; displayname: string }
          | Array<{ module: string; displayname: string }>;
      };
    }>('GetPaymentMethods');
    return asArray(data.paymentmethods?.paymentmethod).map((m) => ({
      module: m.module,
      displayname: m.displayname || m.module,
    }));
  }
}

export function normalizeWhmcsApiUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/includes/api.php')) return trimmed;
  if (trimmed.endsWith('/api.php')) return trimmed;
  return `${trimmed}/includes/api.php`;
}

/**
 * Base URL do admin WHMCS para deep-links.
 * API: https://host/.../includes/api.php → admin: https://host/.../admin
 */
export function whmcsAdminBaseFromApiUrl(apiUrl: string): string {
  const root = normalizeWhmcsApiUrl(apiUrl)
    .replace(/\/includes\/api\.php$/i, '')
    .replace(/\/api\.php$/i, '')
    .replace(/\/+$/, '');
  if (/\/admin$/i.test(root)) return root;
  return `${root}/admin`;
}

export function whmcsAdminLinks(apiUrl: string) {
  const base = whmcsAdminBaseFromApiUrl(apiUrl);
  return {
    base,
    clientSummary: (userId: number) => `${base}/clientssummary.php?userid=${userId}`,
    clientProfile: (userId: number) => `${base}/clientsprofile.php?userid=${userId}`,
    clientServices: (userId: number) => `${base}/clientsservices.php?userid=${userId}`,
    clientService: (userId: number, serviceId: number) =>
      `${base}/clientsservices.php?userid=${userId}&id=${serviceId}`,
    clientDomains: (userId: number) => `${base}/clientsdomains.php?userid=${userId}`,
    clientDomain: (userId: number, domainId: number) =>
      `${base}/clientsdomains.php?userid=${userId}&id=${domainId}`,
    clientInvoices: (userId: number) => `${base}/clientsinvoices.php?userid=${userId}`,
    invoice: (invoiceId: number) => `${base}/invoices.php?action=edit&id=${invoiceId}`,
    product: (pid: number) => `${base}/configproducts.php?action=edit&id=${pid}`,
  };
}
