import { prisma, Prisma } from '@tvde/database';
import { isMoloniLocalRedirect, type MoloniDocumentSetHealth } from '@tvde/shared';
import {
  computeInvoiceTotals,
  computeLine,
  MoloniClient,
  MoloniBillingProvider,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchMoloniDocumentPdf,
  mapMoloniProductsToInvoiceLines,
  metadataFromMoloniDocument,
  resolveMoloniDocumentSetId,
  formatMoloniDocumentSetError,
  type InvoiceDraft,
  type InvoiceMoloniMetadata,
  type MoloniDocumentTypeId,
} from '@tvde/billing';
import { getServerConfig } from '@tvde/shared/server';
import { decrypt, encrypt } from '../lib/crypto';
import { env } from '../config/env';
import { EMAIL_TEMPLATE_KEYS, resolveSmtpConnection, sendTemplateEmail } from './email.service';
import { createInvoiceDownloadLink } from './invoice-download-token.service';
import { createHash } from 'crypto';
import { ensureMoloniAccessToken, getBillingConnection } from './moloni-connection.service';
import { syncAdminMgmtFromBillingInvoice } from './admin-mgmt-moloni-sync.service';
import { getMoloniDocumentSetHealth } from './moloni-document-set-health.service';
import {
  ensureMoloniPartyId,
  resolveForInvoice,
} from './billing-entity.service';
import {
  resetMoloniBillingForCompanyChange,
  unlinkEntitiesNotInMoloniSet,
  unlinkStaleMoloniBillingData,
} from './billing-moloni-reset.service';

const MOLONI_STATE_TTL_MS = 15 * 60_000;

function signOAuthState(workspaceId: string, userId: string): string {
  const payload = JSON.stringify({ workspaceId, userId, exp: Date.now() + MOLONI_STATE_TTL_MS });
  return `${Buffer.from(payload).toString('base64url')}.${createHash('sha256').update(payload + env.encryptionKey).digest('hex').slice(0, 16)}`;
}

export function parseOAuthState(state: string): { workspaceId: string; userId: string } {
  const [b64, sig] = state.split('.');
  if (!b64 || !sig) throw new Error('State OAuth inválido');
  const payload = Buffer.from(b64, 'base64url').toString('utf8');
  const expected = createHash('sha256').update(payload + env.encryptionKey).digest('hex').slice(0, 16);
  if (sig !== expected) throw new Error('State OAuth inválido');
  const data = JSON.parse(payload) as { workspaceId: string; userId: string; exp: number };
  if (data.exp < Date.now()) throw new Error('State OAuth expirado');
  return { workspaceId: data.workspaceId, userId: data.userId };
}

export async function upsertMoloniConfig(input: {
  workspaceId: string;
  clientId: string;
  clientSecret?: string;
  companyId?: number;
  documentSetId?: number;
  redirectUri: string;
}) {
  const existing = await getBillingConnection(input.workspaceId);
  let encryptedClientSecret = existing?.encryptedClientSecret;
  if (input.clientSecret) {
    encryptedClientSecret = encrypt(input.clientSecret);
  }
  if (!encryptedClientSecret) {
    throw new Error('Client Secret Moloni obrigatório');
  }

  const previousCompanyId = existing?.companyId ?? null;
  const nextCompanyId = input.companyId ?? previousCompanyId;

  const config = await prisma.billingConnection.upsert({
    where: { workspaceId: input.workspaceId },
    create: {
      workspaceId: input.workspaceId,
      provider: 'moloni',
      clientId: input.clientId.trim(),
      encryptedClientSecret,
      companyId: input.companyId ?? null,
      documentSetId: input.documentSetId ?? null,
      redirectUri: input.redirectUri.trim(),
    },
    update: {
      clientId: input.clientId.trim(),
      encryptedClientSecret,
      companyId: input.companyId ?? undefined,
      documentSetId: input.documentSetId ?? undefined,
      redirectUri: input.redirectUri.trim(),
    },
    select: {
      id: true,
      workspaceId: true,
      provider: true,
      clientId: true,
      companyId: true,
      documentSetId: true,
      redirectUri: true,
      connectedAt: true,
      tokenExpiresAt: true,
    },
  });

  if (
    previousCompanyId != null &&
    nextCompanyId != null &&
    previousCompanyId !== nextCompanyId
  ) {
    await resetMoloniBillingForCompanyChange(input.workspaceId, {
      previousCompanyId,
      newCompanyId: nextCompanyId,
    });
  }

  return config;
}

async function probeMoloniApi(
  workspaceId: string
): Promise<{
  ok: boolean;
  message: string;
  companyName?: string;
  moloniCustomerCount?: number;
  moloniInvoiceCount?: number;
}> {
  try {
    const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
    const companies = await moloniClient.getCompanies();
    if (!companies.length) {
      return { ok: false, message: 'Conta Moloni sem empresas' };
    }
    if (!row.companyId) {
      return {
        ok: true,
        message: 'Ligado — seleccione a empresa Moloni correcta nas definições',
      };
    }
    const company = companies.find((c) => c.company_id === row.companyId);
    let moloniCustomerCount: number | undefined;
    let moloniInvoiceCount: number | undefined;
    try {
      const countRes = await moloniClient.getCustomerCount(row.companyId);
      moloniCustomerCount = Number(countRes.count);
    } catch {
      moloniCustomerCount = undefined;
    }
    try {
      const invoiceCountRes = await moloniClient.getInvoiceCount(row.companyId);
      moloniInvoiceCount = Number(invoiceCountRes.count);
    } catch {
      moloniInvoiceCount = undefined;
    }
    const companyLabel = company?.name ?? `ID ${row.companyId}`;
    const countParts = [
      moloniCustomerCount != null ? `${moloniCustomerCount} clientes` : null,
      moloniInvoiceCount != null ? `${moloniInvoiceCount} faturas (API)` : null,
    ].filter(Boolean);
    const countLabel = countParts.length ? ` · ${countParts.join(', ')}` : '';
    return {
      ok: true,
      message: `Empresa: ${companyLabel}${countLabel}`,
      companyName: company?.name,
      moloniCustomerCount,
      moloniInvoiceCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha na API Moloni';
    return { ok: false, message };
  }
}

export async function listMoloniCompanies(workspaceId: string) {
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  const companies = await moloniClient.getCompanies();
  return {
    selectedCompanyId: row.companyId,
    companies: companies.map((c) => ({
      companyId: c.company_id,
      name: c.name,
    })),
  };
}

export async function getMoloniCompanyDiagnostics(workspaceId: string) {
  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) {
    return {
      companyId: null as number | null,
      companyName: null as string | null,
      moloniCustomerCount: null as number | null,
      moloniInvoiceCount: null as number | null,
      companies: [] as Array<{ companyId: number; name: string }>,
    };
  }
  const companies = await moloniClient.getCompanies();
  const company = companies.find((c) => c.company_id === row.companyId);
  let moloniCustomerCount: number | null = null;
  let moloniInvoiceCount: number | null = null;
  try {
    const countRes = await moloniClient.getCustomerCount(row.companyId);
    moloniCustomerCount = Number(countRes.count);
  } catch {
    moloniCustomerCount = null;
  }
  try {
    const invoiceCountRes = await moloniClient.getInvoiceCount(row.companyId);
    moloniInvoiceCount = Number(invoiceCountRes.count);
  } catch {
    moloniInvoiceCount = null;
  }
  return {
    companyId: row.companyId,
    companyName: company?.name ?? null,
    moloniCustomerCount,
    moloniInvoiceCount,
    companies: companies.map((c) => ({
      companyId: c.company_id,
      name: c.name,
      isSelected: c.company_id === row.companyId,
    })),
  };
}

async function getBillingModuleFlags(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      tenant: {
        select: {
          tenantModules: { where: { moduleKey: 'billing' }, select: { allowed: true } },
        },
      },
      workspaceModules: { where: { moduleKey: 'billing' }, select: { enabled: true } },
    },
  });

  return {
    moduleAuthorized: ws?.tenant.tenantModules[0]?.allowed ?? false,
    moduleActive: ws?.workspaceModules[0]?.enabled ?? false,
  };
}

export async function getMoloniPublicStatus(workspaceId: string, options?: { probe?: boolean }) {
  const moduleFlags = await getBillingModuleFlags(workspaceId);

  if (!moduleFlags.moduleAuthorized) {
    return {
      configured: false,
      connected: false,
      healthy: false,
      statusMessage: 'Módulo billing não autorizado para este tenant',
      documentSetHealth: null as MoloniDocumentSetHealth | null,
      ...moduleFlags,
    };
  }

  if (!moduleFlags.moduleActive) {
    return {
      configured: false,
      connected: false,
      healthy: false,
      statusMessage: 'Módulo billing inactivo — active em Workspaces',
      documentSetHealth: null as MoloniDocumentSetHealth | null,
      ...moduleFlags,
    };
  }

  const row = await getBillingConnection(workspaceId);
  if (!row) {
    return {
      configured: false,
      connected: false,
      healthy: false,
      statusMessage: 'Moloni ainda não configurado neste workspace',
      documentSetHealth: null as MoloniDocumentSetHealth | null,
      ...moduleFlags,
    };
  }

  const connected = Boolean(row.encryptedAccessToken && row.connectedAt);
  const base = {
    configured: true,
    connected,
    clientId: row.clientId,
    companyId: row.companyId,
    documentSetId: row.documentSetId,
    redirectUri: row.redirectUri,
    connectedAt: row.connectedAt,
    healthy: false as boolean,
    statusMessage: 'Não configurado',
    documentSetHealth: null as MoloniDocumentSetHealth | null,
    ...moduleFlags,
  };

  if (row.redirectUri && isMoloniLocalRedirect(row.redirectUri)) {
    return {
      ...base,
      healthy: false,
      statusMessage: 'Redirect URI em localhost — inválido para Moloni',
    };
  }

  if (!connected) {
    return {
      ...base,
      healthy: false,
      statusMessage: 'OAuth pendente — ligue a conta Moloni',
    };
  }

  let documentSetHealth: MoloniDocumentSetHealth | null = null;
  if (row.companyId) {
    try {
      documentSetHealth = await getMoloniDocumentSetHealth(workspaceId);
    } catch {
      documentSetHealth = null;
    }
  }

  const documentSetBlocksHealth = documentSetHealth != null && !documentSetHealth.ok;

  if (options?.probe === false) {
    return {
      ...base,
      healthy: !documentSetBlocksHealth,
      statusMessage: documentSetBlocksHealth
        ? documentSetHealth!.userMessage
        : documentSetHealth?.severity === 'warning' && documentSetHealth.userMessage
          ? documentSetHealth.userMessage
          : 'Ligado',
      documentSetHealth,
    };
  }

  const probe = await probeMoloniApi(workspaceId);
  return {
    ...base,
    healthy: probe.ok && !documentSetBlocksHealth,
    statusMessage: documentSetBlocksHealth
      ? documentSetHealth!.userMessage
      : probe.message,
    companyName: probe.companyName,
    moloniCustomerCount: probe.moloniCustomerCount,
    moloniInvoiceCount: probe.moloniInvoiceCount,
    documentSetHealth,
  };
}

export function getMoloniAuthorizeUrl(workspaceId: string, userId: string) {
  return prisma.billingConnection.findUnique({ where: { workspaceId } }).then((row) => {
    if (!row?.redirectUri) throw new Error('Configure Moloni antes de autorizar');
    const state = signOAuthState(workspaceId, userId);
    const url = buildAuthorizeUrl({ clientId: row.clientId, redirectUri: row.redirectUri });
    return { url: `${url}&state=${encodeURIComponent(state)}`, state };
  });
}

export async function completeMoloniOAuth(code: string, state: string) {
  const { workspaceId } = parseOAuthState(state);
  const row = await getBillingConnection(workspaceId);
  if (!row?.redirectUri) throw new Error('Configuração Moloni em falta');

  const tokens = await exchangeAuthorizationCode(
    {
      clientId: row.clientId,
      clientSecret: decrypt(row.encryptedClientSecret),
      redirectUri: row.redirectUri,
    },
    code
  );

  const client = new MoloniClient(tokens.accessToken);
  const companies = await client.getCompanies();
  const previousCompanyId = row.companyId;
  let companyId = row.companyId;

  if (companyId && !companies.some((c) => c.company_id === companyId)) {
    await unlinkStaleMoloniBillingData(workspaceId);
    companyId = null;
  }

  if (!companyId) {
    const preferred =
      companies.find((c) => /demonstra/i.test(c.name)) ?? companies[0];
    companyId = preferred?.company_id ?? null;
  }

  if (
    previousCompanyId != null &&
    companyId != null &&
    previousCompanyId !== companyId
  ) {
    await resetMoloniBillingForCompanyChange(workspaceId, {
      previousCompanyId,
      newCompanyId: companyId,
    });
  }

  await prisma.billingConnection.update({
    where: { workspaceId },
    data: {
      encryptedAccessToken: encrypt(tokens.accessToken),
      encryptedRefreshToken: encrypt(tokens.refreshToken),
      tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      companyId,
      connectedAt: new Date(),
    },
  });

  return { workspaceId, companyId };
}

function nextDraftNumber(workspaceId: string): string {
  return `DRAFT-${workspaceId.slice(0, 8)}-${Date.now()}`;
}

function invoiceListWhere(
  workspaceId: string,
  tenantId: string,
  q?: string,
  documentType?: string
): Prisma.InvoiceWhereInput {
  return {
    workspaceId,
    tenantId,
    ...(documentType ? { documentType } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: 'insensitive' } },
            { billingEntity: { name: { contains: q, mode: 'insensitive' } } },
            { client: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
}

export async function listInvoices(
  workspaceId: string,
  tenantId: string,
  q?: string,
  documentType?: string,
  page = 0,
  limit = 20
) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const where = invoiceListWhere(workspaceId, tenantId, q, documentType);

  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, nif: true, email: true } },
        billingEntity: {
          select: { id: true, name: true, vat: true, entityType: true, email: true },
        },
        lines: true,
      },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      skip: page * safeLimit,
      take: safeLimit,
    }),
    prisma.invoice.count({ where }),
  ]);

  return { items, total, page, limit: safeLimit };
}

export async function getInvoiceById(invoiceId: string, tenantId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      client: { select: { id: true, name: true, nif: true, email: true } },
      billingEntity: {
        select: { id: true, name: true, vat: true, entityType: true, email: true },
      },
      lines: true,
    },
  });
  if (!invoice) throw new Error('Documento não encontrado');
  return invoice;
}

export async function duplicateInvoice(invoiceId: string, tenantId: string) {
  const source = await getInvoiceById(invoiceId, tenantId);
  if (!source.billingEntityId) {
    throw new Error('Documento sem entidade de facturação associada');
  }

  const sourceMetadata = (source.metadataJson ?? {}) as InvoiceMoloniMetadata;
  let lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate?: number;
    moloniProductId?: number;
    moloniTaxId?: number;
    moloniExemptionReason?: string;
  }> = [];
  let metadata: InvoiceMoloniMetadata = { ...sourceMetadata };

  if (source.lines.length > 0) {
    lines = source.lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      vatRate: Number(line.vatRate),
      moloniProductId: line.externalProductId ? Number(line.externalProductId) : undefined,
      moloniTaxId: line.externalTaxId ? Number(line.externalTaxId) : undefined,
    }));
  } else if (source.externalId && source.provider === 'moloni') {
    const { row, accessToken } = await ensureMoloniAccessToken(source.workspaceId);
    if (!row.companyId) throw new Error('Moloni não configurado neste workspace');

    const moloniClient = new MoloniClient(accessToken);
    const doc = await moloniClient.getDocument(
      source.documentType as MoloniDocumentTypeId,
      row.companyId,
      Number(source.externalId)
    );

    if (!doc.products?.length) {
      throw new Error('Documento Moloni sem artigos — não é possível duplicar');
    }

    lines = mapMoloniProductsToInvoiceLines(doc.products);
    metadata = { ...metadata, ...metadataFromMoloniDocument(doc) };
  } else {
    throw new Error('Documento sem linhas — não é possível duplicar');
  }

  const today = new Date().toISOString().slice(0, 10);

  return createInvoice({
    tenantId: source.tenantId,
    workspaceId: source.workspaceId,
    billingEntityId: source.billingEntityId,
    clientId: source.clientId ?? undefined,
    documentType: source.documentType,
    entityType: source.entityType,
    lines,
    notes: source.notes ?? undefined,
    dueDate: today,
    issueDate: today,
    documentSetId: metadata.documentSetId,
    metadata: {
      ...metadata,
      issueDate: today,
      expirationDate: today,
    },
  });
}

export async function updateInvoiceDraft(
  invoiceId: string,
  tenantId: string,
  input: {
    billingEntityId?: string;
    clientId?: string;
    documentType?: string;
    entityType?: string;
    lines: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      vatRate?: number;
      productId?: string;
      moloniProductId?: number;
      moloniTaxId?: number;
      moloniExemptionReason?: string;
    }>;
    dueDate?: string;
    notes?: string;
    issueDate?: string;
    documentSetId?: number;
    metadata?: InvoiceMoloniMetadata;
  }
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
  });
  if (!invoice) throw new Error('Documento não encontrado');
  if (invoice.status !== 'draft') throw new Error('Só rascunhos podem ser editados');

  const entity = await resolveForInvoice({
    tenantId: invoice.tenantId,
    workspaceId: invoice.workspaceId,
    clientId: input.clientId,
    billingEntityId: input.billingEntityId ?? invoice.billingEntityId ?? undefined,
  });

  const totals = computeInvoiceTotals(input.lines);

  return prisma.$transaction(async (tx) => {
    await tx.invoiceLine.deleteMany({ where: { invoiceId } });
    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        clientId: entity.cmsClientId,
        billingEntityId: entity.id,
        documentType: input.documentType ?? invoice.documentType,
        entityType: input.entityType ?? invoice.entityType,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        dueDate: input.dueDate
          ? new Date(input.dueDate)
          : input.metadata?.expirationDate
            ? new Date(input.metadata.expirationDate)
            : null,
        notes: input.notes,
        metadataJson: {
          ...(input.metadata ?? {}),
          ...(input.issueDate ? { issueDate: input.issueDate } : {}),
          ...(input.documentSetId != null ? { documentSetId: input.documentSetId } : {}),
        } as Prisma.InputJsonValue,
        lines: {
          create: input.lines.map((line) => {
            const c = computeLine(line);
            return {
              description: line.description,
              quantity: c.quantity,
              unitPrice: line.unitPrice,
              vatRate: c.vatRate ?? 23,
              lineTotal: c.lineTotal,
              productId: line.productId ?? null,
              externalProductId:
                line.moloniProductId != null ? String(line.moloniProductId) : null,
              externalTaxId: line.moloniTaxId != null ? String(line.moloniTaxId) : null,
            };
          }),
        },
      },
      include: {
        client: true,
        billingEntity: true,
        lines: true,
      },
    });
  });
}

export async function deleteInvoiceDraft(invoiceId: string, tenantId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { id: true, status: true, number: true },
  });
  if (!invoice) throw new Error('Documento não encontrado');
  if (invoice.status !== 'draft') {
    throw new Error('Só rascunhos podem ser apagados');
  }

  await prisma.invoice.delete({ where: { id: invoiceId } });
  return { id: invoice.id, number: invoice.number };
}

export async function createInvoice(input: {
  tenantId: string;
  workspaceId: string;
  clientId?: string;
  billingEntityId?: string;
  documentType?: string;
  entityType?: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate?: number;
    productId?: string;
    moloniProductId?: number;
    moloniTaxId?: number;
    moloniExemptionReason?: string;
  }>;
  dueDate?: string;
  notes?: string;
  issueDate?: string;
  documentSetId?: number;
  metadata?: InvoiceMoloniMetadata;
}) {
  const entity = await resolveForInvoice({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    billingEntityId: input.billingEntityId,
  });

  const totals = computeInvoiceTotals(input.lines);
  const number = nextDraftNumber(input.workspaceId);

  return prisma.invoice.create({
    data: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      clientId: entity.cmsClientId,
      billingEntityId: entity.id,
      number,
      status: 'draft',
      provider: 'local',
      documentType: input.documentType ?? 'invoice',
      entityType: input.entityType ?? entity.entityType,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      total: totals.total,
      dueDate: input.dueDate
        ? new Date(input.dueDate)
        : input.metadata?.expirationDate
          ? new Date(input.metadata.expirationDate)
          : null,
      notes: input.notes,
      metadataJson: {
        ...(input.metadata ?? {}),
        ...(input.issueDate ? { issueDate: input.issueDate } : {}),
        ...(input.documentSetId != null ? { documentSetId: input.documentSetId } : {}),
      } as Prisma.InputJsonValue,
      lines: {
        create: input.lines.map((line) => {
          const c = computeLine(line);
          return {
            description: line.description,
            quantity: c.quantity,
            unitPrice: line.unitPrice,
            vatRate: c.vatRate ?? 23,
            lineTotal: c.lineTotal,
            productId: line.productId ?? null,
            externalProductId:
              line.moloniProductId != null ? String(line.moloniProductId) : null,
            externalTaxId: line.moloniTaxId != null ? String(line.moloniTaxId) : null,
          };
        }),
      },
    },
    include: {
      client: true,
      billingEntity: true,
      lines: true,
    },
  });
}

export async function issueInvoiceToMoloni(invoiceId: string, tenantId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      client: true,
      billingEntity: true,
      lines: true,
    },
  });
  if (!invoice) throw new Error('Fatura não encontrada');
  if (invoice.status !== 'draft') throw new Error('Só rascunhos podem ser emitidos');

  const entity = invoice.billingEntity;
  if (!entity) throw new Error('Entidade de facturação em falta');

  const { row, accessToken } = await ensureMoloniAccessToken(invoice.workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta na configuração');

  const partyId = await ensureMoloniPartyId(
    entity,
    invoice.workspaceId,
    tenantId
  );

  const metadata = (invoice.metadataJson ?? {}) as InvoiceMoloniMetadata;
  const documentType = invoice.documentType as MoloniDocumentTypeId;

  const moloniClient = new MoloniClient(accessToken);
  const documentSets = await moloniClient.getDocumentSets(row.companyId);
  const resolvedDocumentSetId = resolveMoloniDocumentSetId(
    documentSets,
    documentType,
    metadata.documentSetId ?? row.documentSetId
  );

  if (row.documentSetId !== resolvedDocumentSetId) {
    await prisma.billingConnection.update({
      where: { workspaceId: invoice.workspaceId },
      data: { documentSetId: resolvedDocumentSetId },
    });
  }

  const draft: InvoiceDraft = {
    clientId: entity.cmsClientId ?? entity.id,
    clientName: entity.name,
    clientNif: entity.vat ?? undefined,
    clientEmail: entity.email ?? undefined,
    documentType: invoice.documentType as MoloniDocumentTypeId,
    lines: invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: Number(l.unitPrice),
      vatRate: Number(l.vatRate),
      moloniProductId: l.externalProductId ? Number(l.externalProductId) : undefined,
      moloniTaxId: l.externalTaxId ? Number(l.externalTaxId) : undefined,
    })),
    dueDate: invoice.dueDate?.toISOString(),
    notes: invoice.notes ?? undefined,
    yourReference: metadata.yourReference ?? invoice.number,
    issueDate: metadata.issueDate,
    documentSetId: resolvedDocumentSetId,
    metadata: { ...metadata, documentSetId: resolvedDocumentSetId },
  };

  const provider = new MoloniBillingProvider({
    clientId: row.clientId,
    clientSecret: decrypt(row.encryptedClientSecret),
    redirectUri: row.redirectUri ?? '',
    accessToken,
    refreshToken: decrypt(row.encryptedRefreshToken!),
    companyId: row.companyId,
    documentSetId: resolvedDocumentSetId,
  });

  const config =
    entity.entityType === 'supplier'
      ? { provider: 'moloni' as const, moloniSupplierId: partyId, documentType: draft.documentType }
      : { provider: 'moloni' as const, moloniCustomerId: partyId, documentType: draft.documentType };

  let result;
  try {
    result = await provider.issueInvoice(draft, config);
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Falha ao emitir no Moloni';
    throw new Error(formatMoloniDocumentSetError(raw));
  }

  if (!result.externalId?.trim()) {
    throw new Error('Moloni não devolveu ID do documento emitido');
  }

  let documentNumber = result.documentNumber?.toString().trim() || '';
  if (!documentNumber) {
    const issuedDoc = await moloniClient.getDocument(
      documentType,
      row.companyId,
      Number(result.externalId)
    );
    if (issuedDoc.number != null && String(issuedDoc.number).trim()) {
      documentNumber = String(issuedDoc.number).trim();
    }
  }

  return prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: 'issued',
      provider: 'moloni',
      externalId: result.externalId,
      number: documentNumber || invoice.number,
      issuedAt: new Date(),
    },
    include: { client: true, billingEntity: true, lines: true },
  }).then(async (updated) => {
    try {
      await syncAdminMgmtFromBillingInvoice(updated.id, tenantId);
    } catch {
      // espelho admin_mgmt opcional — não bloqueia emissão Moloni
    }
    return updated;
  });
}

export type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: { client: true; billingEntity: true; lines: true };
}>;

export async function downloadInvoicePdf(invoiceId: string, tenantId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { status: true, externalId: true, workspaceId: true, number: true },
  });
  if (!invoice) throw new Error('Fatura não encontrada');
  if (invoice.status === 'draft') throw new Error('Rascunhos não têm PDF');
  if (!invoice.externalId) throw new Error('Documento sem ID Moloni');

  const { row, accessToken } = await ensureMoloniAccessToken(invoice.workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  const client = new MoloniClient(accessToken);
  const result = await client.getDocumentPdfLink(row.companyId, Number(invoice.externalId));
  if (!result.url) throw new Error('PDF indisponível');

  let companyEmail: string | undefined;
  try {
    const company = await client.getCompany(row.companyId);
    companyEmail = company.email;
  } catch {
    /* email opcional no link de download */
  }

  const buffer = await fetchMoloniDocumentPdf(
    result.url,
    Number(invoice.externalId),
    companyEmail
  );

  const label = (invoice.number ?? invoice.externalId ?? invoiceId).replace(/[^\w.-]+/g, '_');
  return { buffer, filename: `fatura-${label}.pdf` };
}

function splitAppName(name: string): { prefix: string; suffix: string } {
  const dot = name.indexOf('.');
  if (dot > 0) return { prefix: name.slice(0, dot), suffix: name.slice(dot + 1) };
  return { prefix: name, suffix: '' };
}

function formatDatePt(date: Date | null | undefined): string {
  if (!date) return '—';
  return date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatCurrencyPt(value: number): string {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(value);
}

export async function sendInvoiceEmail(
  invoiceId: string,
  tenantId: string,
  options?: { toEmail?: string }
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      billingEntity: { select: { name: true, email: true } },
      client: { select: { name: true, email: true } },
    },
  });
  if (!invoice) throw new Error('Fatura não encontrada');
  if (invoice.status === 'draft') throw new Error('Rascunhos não podem ser enviados por email');
  if (!invoice.externalId) throw new Error('Documento ainda não emitido no Moloni');

  const to =
    options?.toEmail?.trim() ||
    invoice.billingEntity?.email?.trim() ||
    invoice.client?.email?.trim();
  if (!to) throw new Error('Cliente sem email');

  const entityName = invoice.billingEntity?.name ?? invoice.client?.name ?? 'Cliente';
  const { url: downloadUrl, expiresIn: downloadExpiresIn } = await createInvoiceDownloadLink(
    invoiceId,
    tenantId
  );
  const { appName, smtpFrom } = getServerConfig();
  const { prefix: appNamePrefix, suffix: appNameSuffix } = splitAppName(appName);
  const issueAt = invoice.issuedAt ?? new Date();
  const periodDescription = issueAt.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  let supportEmail = smtpFrom || '';
  try {
    const smtp = await resolveSmtpConnection(tenantId);
    supportEmail = smtp.from;
  } catch {
    /* usa fallback do .env */
  }

  await sendTemplateEmail({
    tenantId,
    to,
    templateKey: EMAIL_TEMPLATE_KEYS.invoice,
    variables: {
      appName,
      appNamePrefix,
      appNameSuffix,
      recipientName: entityName,
      periodDescription,
      invoiceNumber: invoice.number,
      issueDate: formatDatePt(invoice.issuedAt),
      dueDate: formatDatePt(invoice.dueDate),
      total: formatCurrencyPt(Number(invoice.total)),
      invoiceIntro:
        'Pode descarregar o PDF através do botão abaixo. O link é pessoal e válido por um período limitado.',
      downloadUrl,
      downloadExpiresIn,
      attachmentCta: 'Descarregar fatura',
      supportEmail,
      currentYear: String(new Date().getFullYear()),
      footerAddress: '',
    },
  });

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: { emailSentAt: new Date() },
    select: { id: true, emailSentAt: true },
  });
}

export async function searchMoloniProducts(workspaceId: string, q?: string) {
  const search = q?.trim();
  if (!search) return [];

  const { row, moloniClient } = await ensureMoloniAccessToken(workspaceId);
  if (!row.companyId) throw new Error('company_id Moloni em falta');

  const all: Array<{ productId: number; name: string; price: number | null; reference: string | null }> = [];
  let offset = 0;
  const qty = 50;

  for (;;) {
    const page = await moloniClient.searchProducts(row.companyId, search, offset, qty);
    if (!page.length) break;
    for (const p of page) {
      all.push({
        productId: p.product_id,
        name: p.name,
        price: p.price ?? null,
        reference: p.reference ?? null,
      });
    }
    if (page.length < qty) break;
    offset += 1;
  }

  return all.slice(0, 50);
}
