import type { MoloniDocumentTypeId } from '../../types';
import { MOLONI_API_BASE } from './config';

export class MoloniApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'MoloniApiError';
  }
}

export interface MoloniCustomerRow {
  customer_id: number;
  name: string;
  vat: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  zip_code?: string;
  last_modified?: string;
  maturity_date_id?: number;
  payment_method_id?: number;
}

export interface MoloniSupplierRow {
  supplier_id: number;
  name: string;
  vat: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  zip_code?: string;
  last_modified?: string;
}

export interface MoloniDocumentSetRow {
  document_set_id: number;
  name: string;
  saft_type?: string;
  active_by_default?: number;
  document_types_numbers?: Array<{ document_type_id?: number; initial_number?: number }>;
  document_set_at_codes?: Array<{
    document_set_wsat_id?: number;
    document_type_id?: number;
    document_set_at_code?: string;
  }>;
}

export interface MoloniTaxRow {
  tax_id: number;
  name: string;
  value: number;
  type?: number;
}

export interface MoloniProductRow {
  product_id: number;
  type?: number;
  name: string;
  summary?: string;
  price?: number;
  reference?: string;
  ean?: string;
  category_id?: number;
  stock?: number;
  unit_id?: number;
  pos_favorite?: number;
  visibility_id?: number;
  measurement_unit?: { unit_id: number; name: string; short_name: string };
  taxes?: Array<{
    tax_id: number;
    value: number;
    order?: number;
    cumulative?: number;
    tax?: { tax_id: number; name: string; value: number; saft_type?: number };
  }>;
}

export interface MoloniProductCategoryRow {
  category_id: number;
  parent_id: number;
  name: string;
  description?: string;
  pos_enabled?: number;
  num_categories?: number;
  num_products?: number;
}

export interface MoloniMeasurementUnitRow {
  unit_id: number;
  name: string;
  short_name: string;
}

export interface MoloniDocumentRow {
  document_id: number;
  number?: string | number;
  date?: string;
  customer_id?: number;
  supplier_id?: number;
  entity_name?: string;
  entity_vat?: string;
  net_value?: number;
  taxes_value?: number;
  gross_value?: number;
  status?: number;
  document_type?: { document_type_id?: number; saft_code?: string };
}

const DOCUMENT_ENDPOINTS: Record<MoloniDocumentTypeId, string> = {
  invoice: 'invoices/insert',
  simplified_invoice: 'simplifiedInvoices/insert',
  invoice_receipt: 'invoiceReceipts/insert',
  debit_note: 'debitNotes/insert',
};

const DOCUMENT_LIST_ENDPOINTS: Record<MoloniDocumentTypeId, string> = {
  invoice: 'invoices/getAll',
  simplified_invoice: 'simplifiedInvoices/getAll',
  invoice_receipt: 'invoiceReceipts/getAll',
  debit_note: 'debitNotes/getAll',
};

const DOCUMENT_GET_ONE_ENDPOINTS: Record<MoloniDocumentTypeId, string> = {
  invoice: 'invoices/getOne',
  simplified_invoice: 'simplifiedInvoices/getOne',
  invoice_receipt: 'invoiceReceipts/getOne',
  debit_note: 'debitNotes/getOne',
};

export interface MoloniDocumentProductRow {
  product_id?: number;
  name: string;
  qty: number;
  price: number;
  exemption_reason?: string;
  taxes?: Array<{ tax_id: number; value: number; order?: number; cumulative?: number }>;
}

export interface MoloniDocumentDetail {
  document_id: number;
  number?: number | string;
  document_number?: number | string;
  document_set_id?: number;
  customer_id?: number;
  date?: string;
  expiration_date?: string | null;
  your_reference?: string;
  our_reference?: string;
  notes?: string;
  financial_discount?: number;
  special_discount?: number;
  related_documents_notes?: string;
  delivery_method_id?: number;
  delivery_datetime?: string | null;
  delivery_departure_address?: string;
  delivery_departure_city?: string;
  delivery_departure_zip_code?: string;
  delivery_departure_country?: number;
  delivery_destination_address?: string;
  delivery_destination_city?: string;
  delivery_destination_zip_code?: string;
  delivery_destination_country?: number;
  vehicle_number_plate?: string;
  products?: MoloniDocumentProductRow[];
}

/** Cliente HTTP Moloni v1 — POST com access_token em query string */
export class MoloniClient {
  constructor(
    private readonly accessToken: string,
    private readonly baseUrl = MOLONI_API_BASE
  ) {}

  async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const path = endpoint.replace(/^\//, '');
    // Moloni: body JSON requer json=true na query (doc: moloni.pt/dev/utilizacao)
    const url = `${this.baseUrl}/${path}/?access_token=${encodeURIComponent(this.accessToken)}&json=true`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    const data = json as {
      valid?: number;
      error?: string;
      error_description?: string;
      errors?: unknown;
    };

    const moloniMessage =
      data.error_description ?? data.error ?? `Moloni HTTP ${res.status}`;

    if (!res.ok) {
      throw new MoloniApiError(moloniMessage, res.status, json);
    }

    if (data.valid === 0) {
      throw new MoloniApiError(moloniMessage, res.status, json);
    }

    if (Array.isArray(json)) {
      const looksLikeErrorList =
        json.length > 0 &&
        json.every((item) => typeof item === 'string' || typeof item === 'number');
      if (looksLikeErrorList) {
        const message = json.map((item) => String(item)).join('; ');
        throw new MoloniApiError(message || 'Resposta Moloni inválida', res.status, json);
      }
      return json as T;
    }

    return json as T;
  }

  /** Lista empresas da conta — útil após OAuth */
  async getCompanies() {
    return this.post<Array<{ company_id: number; name: string; email?: string }>>(
      'companies/getAll',
      {}
    );
  }

  async getCompany(companyId: number) {
    return this.post<{ company_id: number; name: string; email?: string }>('companies/getOne', {
      company_id: companyId,
    });
  }

  async getCustomerCount(companyId: number) {
    return this.post<{ count: number }>('customers/count', { company_id: companyId });
  }

  async getAllCustomers(companyId: number, offset = 0, qty = 50) {
    return this.post<MoloniCustomerRow[]>('customers/getAll', {
      company_id: companyId,
      offset,
      qty,
    });
  }

  async getAllSuppliers(companyId: number, offset = 0, qty = 50) {
    return this.post<MoloniSupplierRow[]>('suppliers/getAll', {
      company_id: companyId,
      offset,
      qty,
    });
  }

  async getDocumentSets(companyId: number) {
    return this.post<MoloniDocumentSetRow[]>('documentSets/getAll', { company_id: companyId });
  }

  async getTaxes(companyId: number) {
    return this.post<MoloniTaxRow[]>('taxes/getAll', { company_id: companyId });
  }

  /** [invoices/insert](https://www.moloni.pt/dev/documents/invoices/insert/) */
  async insertInvoice(payload: Record<string, unknown>) {
    return this.insertDocument('invoice', payload);
  }

  async insertDocument(documentType: MoloniDocumentTypeId, payload: Record<string, unknown>) {
    const endpoint = DOCUMENT_ENDPOINTS[documentType];
    return this.post<{ document_id?: number; number?: string }>(endpoint, payload);
  }

  async getInvoiceCount(companyId: number, year?: number) {
    return this.post<{ count: number | string }>('invoices/count', {
      company_id: companyId,
      ...(year != null ? { year } : {}),
    });
  }

  async getAllDocuments(documentType: MoloniDocumentTypeId, companyId: number, offset = 0, qty = 50) {
    const endpoint = DOCUMENT_LIST_ENDPOINTS[documentType];
    return this.post<MoloniDocumentRow[]>(endpoint, {
      company_id: companyId,
      offset,
      qty,
    });
  }

  async getDocument(documentType: MoloniDocumentTypeId, companyId: number, documentId: number) {
    const endpoint = DOCUMENT_GET_ONE_ENDPOINTS[documentType];
    return this.post<MoloniDocumentDetail>(endpoint, {
      company_id: companyId,
      document_id: documentId,
    });
  }

  async getCustomer(companyId: number, customerId: number) {
    return this.post<Record<string, unknown>>('customers/getOne', {
      company_id: companyId,
      customer_id: customerId,
    });
  }

  async getSupplier(companyId: number, supplierId: number) {
    return this.post<Record<string, unknown>>('suppliers/getOne', {
      company_id: companyId,
      supplier_id: supplierId,
    });
  }

  /** [customers/insert](https://www.moloni.pt/dev/entities/customers/insert/) */
  async insertCustomer(payload: Record<string, unknown>) {
    return this.post<{ customer_id?: number }>('customers/insert', payload);
  }

  async updateCustomer(payload: Record<string, unknown>) {
    return this.post<{ valid?: number; customer_id?: number }>('customers/update', payload);
  }

  async insertSupplier(payload: Record<string, unknown>) {
    return this.post<{ supplier_id?: number }>('suppliers/insert', payload);
  }

  async updateSupplier(payload: Record<string, unknown>) {
    return this.post<{ valid?: number; supplier_id?: number }>('suppliers/update', payload);
  }

  async getCustomersByVat(companyId: number, vat: string) {
    return this.post<Array<{ customer_id: number; name: string; vat: string }>>(
      'customers/getByVat',
      { company_id: companyId, vat }
    );
  }

  async getAllProducts(companyId: number, categoryId: number, offset = 0, qty = 50, withInvisible = 1) {
    return this.post<MoloniProductRow[]>('products/getAll', {
      company_id: companyId,
      category_id: categoryId,
      offset,
      qty,
      with_invisible: withInvisible,
    });
  }

  async searchProducts(companyId: number, search: string, offset = 0, qty = 50) {
    return this.post<MoloniProductRow[]>('products/getBySearch', {
      company_id: companyId,
      search,
      offset,
      qty,
    });
  }

  async getProduct(companyId: number, productId: number, withInvisible = 1) {
    return this.post<MoloniProductRow>('products/getOne', {
      company_id: companyId,
      product_id: productId,
      with_invisible: withInvisible,
    });
  }

  async getNextProductReference(companyId: number) {
    return this.post<{ reference: string }>('products/getNextReference', {
      company_id: companyId,
    });
  }

  async insertProduct(payload: Record<string, unknown>) {
    return this.post<{ product_id?: number }>('products/insert', payload);
  }

  async updateProduct(payload: Record<string, unknown>) {
    return this.post<{ product_id?: number }>('products/update', payload);
  }

  async deleteProduct(companyId: number, productId: number) {
    return this.post<{ valid?: number }>('products/delete', {
      company_id: companyId,
      product_id: productId,
    });
  }

  async getAllProductCategories(companyId: number, parentId: number, offset = 0, qty = 50) {
    return this.post<MoloniProductCategoryRow[]>('productCategories/getAll', {
      company_id: companyId,
      parent_id: parentId,
      offset,
      qty,
    });
  }

  async getProductCategory(companyId: number, categoryId: number) {
    return this.post<MoloniProductCategoryRow>('productCategories/getOne', {
      company_id: companyId,
      category_id: categoryId,
    });
  }

  async insertProductCategory(payload: Record<string, unknown>) {
    return this.post<{ category_id?: number }>('productCategories/insert', payload);
  }

  async updateProductCategory(payload: Record<string, unknown>) {
    return this.post<{ category_id?: number }>('productCategories/update', payload);
  }

  async deleteProductCategory(companyId: number, categoryId: number) {
    return this.post<{ valid?: number }>('productCategories/delete', {
      company_id: companyId,
      category_id: categoryId,
    });
  }

  async getMeasurementUnits(companyId: number) {
    return this.post<MoloniMeasurementUnitRow[]>('measurementUnits/getAll', {
      company_id: companyId,
    });
  }

  /** [documents/getPDFLink](https://www.moloni.pt/dev/documents/documents/getpdflink/) */
  async getDocumentPdfLink(companyId: number, documentId: number, signed = 0) {
    return this.post<{ url: string }>('documents/getPDFLink', {
      company_id: companyId,
      document_id: documentId,
      signed,
    });
  }
}
