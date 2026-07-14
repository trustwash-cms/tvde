import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env';
import { resolveWorkspaceTenantScope } from '../lib/workspace-scope';
import { createAuditLog } from '../services/audit.service';
import { parseSearchQuery } from '../services/search.service';
import {
  completeMoloniOAuth,
  createInvoice,
  duplicateInvoice,
  deleteInvoiceDraft,
  getInvoiceById,
  getMoloniAuthorizeUrl,
  getMoloniCompanyDiagnostics,
  getMoloniPublicStatus,
  downloadInvoicePdf,
  sendInvoiceEmail,
  issueInvoiceToMoloni,
  listInvoices,
  updateInvoiceDraft,
  listMoloniCompanies,
  searchMoloniProducts,
  upsertMoloniConfig,
} from '../services/billing.service';
import { applyRecommendedMoloniDocumentSet } from '../services/moloni-document-set-health.service';
import {
  archiveBillingEntity,
  archiveUnlinkedEntities,
  confirmEntityLink,
  createBillingEntity,
  deleteBillingEntity,
  getBillingEntity,
  linkEntityToCmsClient,
  listBillingConflicts,
  listBillingEntities,
  purgeArchivedBillingEntities,
  pushEntityToMoloni,
  resolveBillingConflict,
  restoreBillingEntity,
  updateBillingEntity,
} from '../services/billing-entity.service';
import {
  computeProductTaxAmount,
  createMoloniProduct,
  createProductCategory,
  deleteMoloniProduct,
  deleteProductCategory,
  duplicateMoloniProduct,
  getMoloniProduct,
  getProductCategory,
  getProductFormOptions,
  listCategoryProducts,
  listProductCategories,
  updateMoloniProduct,
  updateProductCategory,
} from '../services/billing-products.service';
import { importMoloniProductsFromCsv } from '../services/billing-products-import.service';
import {
  listCatalogItems,
  syncAllFromMoloni,
  syncCatalogFromMoloni,
  syncDocumentsFromMoloni,
  syncEntitiesFromMoloni,
} from '../services/billing-sync.service';
import { unlinkStaleMoloniBillingData } from '../services/billing-moloni-reset.service';
import { dedupeBillingEntitiesInWorkspace } from '../services/billing-entity-dedupe.service';

const metadataSchema = z
  .object({
    documentSetId: z.coerce.number().int().optional(),
    issueDate: z.string().optional(),
    expirationDate: z.string().optional(),
    yourReference: z.string().optional(),
    ourReference: z.string().optional(),
    financialDiscount: z.coerce.number().min(0).max(100).optional(),
    specialDiscount: z.coerce.number().min(0).optional(),
    relatedDocumentsNotes: z.string().optional(),
    deliveryMethodId: z.coerce.number().int().optional(),
    deliveryDatetime: z.string().optional(),
    deliveryDepartureAddress: z.string().optional(),
    deliveryDepartureCity: z.string().optional(),
    deliveryDepartureZipCode: z.string().optional(),
    deliveryDepartureCountry: z.coerce.number().int().optional(),
    deliveryDestinationAddress: z.string().optional(),
    deliveryDestinationCity: z.string().optional(),
    deliveryDestinationZipCode: z.string().optional(),
    deliveryDestinationCountry: z.coerce.number().int().optional(),
    vehicleNumberPlate: z.string().optional(),
  })
  .optional();

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.coerce.number().int().min(1).default(1),
  unitPrice: z.coerce.number().min(0),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  productId: z.string().uuid().optional(),
  moloniProductId: z.coerce.number().int().optional(),
  moloniTaxId: z.coerce.number().int().optional(),
});

const createInvoiceBodySchema = z
  .object({
    workspaceId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    billingEntityId: z.string().uuid().optional(),
    lines: z.array(lineSchema).min(1),
    dueDate: z.string().optional(),
    issueDate: z.string().optional(),
    documentSetId: z.coerce.number().int().optional(),
    metadata: metadataSchema,
    notes: z.string().optional(),
    documentType: z
      .enum(['invoice', 'simplified_invoice', 'invoice_receipt', 'debit_note'])
      .optional(),
    entityType: z.enum(['customer', 'supplier']).optional(),
  })
  .refine((b) => b.clientId || b.billingEntityId, {
    message: 'billingEntityId ou clientId obrigatório',
  });

export async function billingRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('billing'));

  fastify.get('/invoices', async (request, reply) => {
    const query = request.query as {
      q?: string;
      workspaceId?: string;
      documentType?: string;
      page?: string;
      limit?: string;
    };
    const q = parseSearchQuery(query.q);
    const page = Math.max(0, Number(query.page ?? 0) || 0);
    const limit = Number(query.limit ?? 20) || 20;
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await listInvoices(workspaceId, tenantId, q, query.documentType, page, limit);
    return reply.send({ success: true, data });
  });

  fastify.get('/invoices/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoiceRef = await fastify.db.invoice.findUnique({
      where: { id },
      select: { tenantId: true, workspaceId: true },
    });
    if (!invoiceRef) {
      return reply.status(404).send({ success: false, error: 'Documento não encontrado' });
    }

    await resolveWorkspaceTenantScope(fastify, request.user, invoiceRef.workspaceId);

    try {
      const data = await getInvoiceById(id, invoiceRef.tenantId);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar documento';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/invoices/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoiceRef = await fastify.db.invoice.findUnique({
      where: { id },
      select: { tenantId: true, workspaceId: true, number: true },
    });
    if (!invoiceRef) {
      return reply.status(404).send({ success: false, error: 'Documento não encontrado' });
    }

    const { tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      invoiceRef.workspaceId
    );

    try {
      const deleted = await deleteInvoiceDraft(id, tenantId);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'invoice.delete_draft',
        entityType: 'invoice',
        entityId: id,
        ipAddress: request.ip,
        beforeJson: { number: deleted.number },
      });
      return reply.send({ success: true, message: 'Rascunho apagado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao apagar rascunho';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/invoices/:id/pdf', async (request, reply) => {
    const { id } = request.params as { id: string };

    const invoiceRef = await fastify.db.invoice.findUnique({
      where: { id },
      select: { tenantId: true, workspaceId: true },
    });
    if (!invoiceRef) {
      return reply.status(404).send({ success: false, error: 'Fatura não encontrada' });
    }

    await resolveWorkspaceTenantScope(fastify, request.user, invoiceRef.workspaceId);

    try {
      const { buffer, filename } = await downloadInvoicePdf(id, invoiceRef.tenantId);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao obter PDF';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/invoices', async (request, reply) => {
    const body = createInvoiceBodySchema.parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    const invoice = await createInvoice({
      tenantId,
      workspaceId,
      clientId: body.clientId,
      billingEntityId: body.billingEntityId,
      lines: body.lines,
      dueDate: body.dueDate,
      issueDate: body.issueDate,
      documentSetId: body.documentSetId,
      metadata: body.metadata,
      notes: body.notes,
      documentType: body.documentType,
      entityType: body.entityType,
    });

    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: invoice.id,
      ipAddress: request.ip,
    });

    return reply.status(201).send({ success: true, data: invoice });
  });

  fastify.patch('/invoices/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoiceRef = await fastify.db.invoice.findUnique({
      where: { id },
      select: { tenantId: true, workspaceId: true },
    });
    if (!invoiceRef) {
      return reply.status(404).send({ success: false, error: 'Documento não encontrado' });
    }

    const { tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      invoiceRef.workspaceId
    );

    const body = createInvoiceBodySchema.parse(request.body);

    try {
      const invoice = await updateInvoiceDraft(id, tenantId, {
        billingEntityId: body.billingEntityId,
        clientId: body.clientId,
        documentType: body.documentType,
        entityType: body.entityType,
        lines: body.lines,
        dueDate: body.dueDate,
        notes: body.notes,
        issueDate: body.issueDate,
        documentSetId: body.documentSetId,
        metadata: body.metadata,
      });

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'invoice.update_draft',
        entityType: 'invoice',
        entityId: invoice.id,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, data: invoice, message: 'Rascunho actualizado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao actualizar rascunho';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/invoices/:id/send-email', async (request, reply) => {
    const { id } = request.params as { id: string };

    const invoiceRef = await fastify.db.invoice.findUnique({
      where: { id },
      select: { tenantId: true, workspaceId: true },
    });
    if (!invoiceRef) {
      return reply.status(404).send({ success: false, error: 'Fatura não encontrada' });
    }

    await resolveWorkspaceTenantScope(fastify, request.user, invoiceRef.workspaceId);

    try {
      const result = await sendInvoiceEmail(id, invoiceRef.tenantId);

      await createAuditLog({
        tenantId: invoiceRef.tenantId,
        userId: request.user.sub,
        action: 'invoice.send_email',
        entityType: 'invoice',
        entityId: id,
        ipAddress: request.ip,
        afterJson: { emailSentAt: result.emailSentAt },
      });

      return reply.send({ success: true, data: result, message: 'Fatura enviada por email' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar email';
      const status = message.includes('SMTP') ? 503 : 400;
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.post('/invoices/:id/issue', async (request, reply) => {
    const { id } = request.params as { id: string };

    const invoiceRef = await fastify.db.invoice.findUnique({
      where: { id },
      select: { tenantId: true, workspaceId: true },
    });
    if (!invoiceRef) {
      return reply.status(404).send({ success: false, error: 'Fatura não encontrada' });
    }

    await resolveWorkspaceTenantScope(fastify, request.user, invoiceRef.workspaceId);

    try {
      const invoice = await issueInvoiceToMoloni(id, invoiceRef.tenantId);

      await createAuditLog({
        tenantId: invoiceRef.tenantId,
        userId: request.user.sub,
        action: 'invoice.issue_moloni',
        entityType: 'invoice',
        entityId: invoice.id,
        ipAddress: request.ip,
        afterJson: { externalId: invoice.externalId, number: invoice.number },
      });

      return reply.send({ success: true, data: invoice, message: 'Fatura emitida no Moloni' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao emitir fatura';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/invoices/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoiceRef = await fastify.db.invoice.findUnique({
      where: { id },
      select: { tenantId: true, workspaceId: true },
    });
    if (!invoiceRef) {
      return reply.status(404).send({ success: false, error: 'Documento não encontrado' });
    }

    const { tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      invoiceRef.workspaceId
    );

    try {
      const invoice = await duplicateInvoice(id, tenantId);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'invoice.duplicate',
        entityType: 'invoice',
        entityId: invoice.id,
        ipAddress: request.ip,
        afterJson: { sourceInvoiceId: id, documentType: invoice.documentType },
      });
      return reply.status(201).send({
        success: true,
        data: invoice,
        message: 'Rascunho criado a partir do documento',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao duplicar documento';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/entities', async (request, reply) => {
    const query = request.query as {
      workspaceId?: string;
      entityType?: 'customer' | 'supplier';
      linkStatus?: string;
      status?: 'active' | 'archived' | 'all';
      q?: string;
    };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await listBillingEntities(workspaceId, tenantId, {
      entityType: query.entityType,
      linkStatus: query.linkStatus as 'unlinked' | 'linked' | 'pending_confirm' | 'conflict' | undefined,
      status: query.status,
      q: parseSearchQuery(query.q),
    });
    return reply.send({ success: true, data });
  });

  fastify.post('/billing/entities', async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        entityType: z.enum(['customer', 'supplier']).optional(),
        name: z.string().min(1),
        vat: z.string().min(1),
        isFinalConsumer: z.boolean().optional(),
        email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
        phone: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        zipCode: z.string().nullable().optional(),
        countryId: z.coerce.number().int().optional(),
        pushToMoloni: z.boolean().optional(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const { entity, reused } = await createBillingEntity({
        tenantId,
        workspaceId,
        entityType: body.entityType,
        name: body.name,
        vat: body.vat,
        isFinalConsumer: body.isFinalConsumer,
        email: body.email || null,
        phone: body.phone,
        address: body.address,
        city: body.city,
        zipCode: body.zipCode,
        countryId: body.countryId,
        pushToMoloni: body.pushToMoloni,
      });

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'billing_entity.create',
        entityType: 'billing_entity',
        entityId: entity.id,
        ipAddress: request.ip,
      });

      return reply.status(reused ? 200 : 201).send({
        success: true,
        data: entity,
        message: reused ? 'Cliente já existia com este NIF' : 'Cliente criado',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao criar entidade';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/entities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const entity = await getBillingEntity(id, workspaceId, tenantId);
    if (!entity) {
      return reply.status(404).send({ success: false, error: 'Entidade não encontrada' });
    }
    return reply.send({ success: true, data: entity });
  });

  fastify.post('/billing/entities/:id/link', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        cmsClientId: z.string().uuid(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await linkEntityToCmsClient({
        entityId: id,
        workspaceId,
        tenantId,
        cmsClientId: body.cmsClientId,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao ligar entidade';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/entities/:id/confirm-link', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        cmsClientId: z.string().uuid(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await confirmEntityLink({
        entityId: id,
        workspaceId,
        tenantId,
        cmsClientId: body.cmsClientId,
      });
      return reply.send({ success: true, data, message: 'Ligação confirmada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao confirmar ligação';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.patch('/billing/entities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        name: z.string().min(1).optional(),
        vat: z.string().nullable().optional(),
        email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
        phone: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        zipCode: z.string().nullable().optional(),
        countryId: z.coerce.number().int().optional(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await updateBillingEntity({
        entityId: id,
        workspaceId,
        tenantId,
        name: body.name,
        vat: body.vat,
        email: body.email === '' ? null : body.email,
        phone: body.phone,
        address: body.address,
        city: body.city,
        zipCode: body.zipCode,
        countryId: body.countryId,
      });
      return reply.send({ success: true, data, message: 'Entidade actualizada no CMS' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao actualizar';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/entities/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await archiveBillingEntity(id, workspaceId, tenantId);
      return reply.send({ success: true, data, message: 'Entidade arquivada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao arquivar';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/entities/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await restoreBillingEntity(id, workspaceId, tenantId);
      return reply.send({ success: true, data, message: 'Entidade restaurada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao restaurar';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/billing/entities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await deleteBillingEntity(id, workspaceId, tenantId);
      return reply.send({
        success: true,
        data,
        message: data.moloniUntouched
          ? 'Removida do CMS (permanece no Moloni)'
          : 'Entidade eliminada',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao eliminar';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/entities/purge-archived', async (request, reply) => {
    const query = request.query as {
      workspaceId?: string;
      entityType?: 'customer' | 'supplier';
    };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await purgeArchivedBillingEntities(workspaceId, tenantId, query.entityType);
      return reply.send({
        success: true,
        data,
        message: `${data.deleted} entidade(s) arquivada(s) removida(s) do CMS` +
          (data.skipped ? ` (${data.skipped} com documentos — use Arquivar)` : ''),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao limpar arquivadas';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/entities/archive-unlinked', async (request, reply) => {
    const query = request.query as {
      workspaceId?: string;
      entityType?: 'customer' | 'supplier';
    };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await archiveUnlinkedEntities(workspaceId, tenantId, query.entityType);
    return reply.send({
      success: true,
      data,
      message: `${data.archived} entidade(s) sem ligação CRM arquivada(s)`,
    });
  });

  fastify.post('/billing/entities/:id/push', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await pushEntityToMoloni(id, workspaceId, tenantId);
      return reply.send({ success: true, data, message: 'Entidade enviada para Moloni' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar entidade';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/conflicts', async (request, reply) => {
    const query = request.query as { workspaceId?: string; status?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await listBillingConflicts(workspaceId, query.status ?? 'open');
    return reply.send({ success: true, data });
  });

  fastify.post('/billing/conflicts/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        resolution: z.enum(['cms', 'moloni', 'dismiss']),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await resolveBillingConflict({
        conflictId: id,
        workspaceId,
        tenantId,
        resolution: body.resolution,
      });
      return reply.send({ success: true, data, message: 'Conflito resolvido' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao resolver conflito';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/sync/entities', async (request, reply) => {
    const query = request.query as { workspaceId?: string; restoreArchived?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const restoreArchived =
      query.restoreArchived !== '0' && query.restoreArchived !== 'false';

    try {
      const data = await syncEntitiesFromMoloni(workspaceId, tenantId, { restoreArchived });
      return reply.send({ success: true, data, message: 'Entidades sincronizadas do Moloni' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message, message });
    }
  });

  fastify.post('/billing/sync/all', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await syncAllFromMoloni(workspaceId, tenantId);
      return reply.send({ success: true, data, message: 'Dados Moloni sincronizados' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message, message });
    }
  });

  fastify.post('/billing/moloni/reset-links', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await unlinkStaleMoloniBillingData(workspaceId);
      const deduped = await dedupeBillingEntitiesInWorkspace(workspaceId);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'billing.moloni_links_reset',
        entityType: 'billing_connection',
        ipAddress: request.ip,
        afterJson: { ...data, duplicatesMerged: deduped.merged },
      });
      return reply.send({
        success: true,
        data: { ...data, duplicatesMerged: deduped.merged },
        message:
          'Ligações Moloni locais removidas. Execute «Sincronizar agora» para importar da conta actual.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao limpar ligações';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/sync/catalog', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await syncCatalogFromMoloni(workspaceId);
      return reply.send({ success: true, data, message: 'Catálogo sincronizado do Moloni' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/catalog', async (request, reply) => {
    const query = request.query as { workspaceId?: string; catalogType?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await listCatalogItems(workspaceId, query.catalogType);
    return reply.send({ success: true, data });
  });

  fastify.get('/billing/product-categories', async (request, reply) => {
    const query = request.query as {
      workspaceId?: string;
      parentId?: string;
      q?: string;
      page?: string;
      limit?: string;
    };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const parentId = Number(query.parentId ?? 0) || 0;
    const page = Math.max(0, Number(query.page ?? 0) || 0);
    const limit = Number(query.limit ?? 10) || 10;

    try {
      const data = await listProductCategories(
        workspaceId,
        parentId,
        parseSearchQuery(query.q),
        page,
        limit
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar categorias';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/product-categories', async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        parentId: z.coerce.number().int().default(0),
        name: z.string().min(1),
        description: z.string().optional(),
        posEnabled: z.boolean().optional(),
      })
      .parse(request.body);

    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await createProductCategory(workspaceId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao criar categoria';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/product-categories/:categoryId', async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.query as { workspaceId?: string }).workspaceId
    );

    try {
      const data = await getProductCategory(workspaceId, Number(categoryId));
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Categoria não encontrada';
      return reply.status(404).send({ success: false, error: message });
    }
  });

  fastify.patch('/billing/product-categories/:categoryId', async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        posEnabled: z.boolean().optional(),
      })
      .parse(request.body);

    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await updateProductCategory(workspaceId, Number(categoryId), body);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao actualizar categoria';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/billing/product-categories/:categoryId', async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.query as { workspaceId?: string }).workspaceId
    );

    try {
      await deleteProductCategory(workspaceId, Number(categoryId));
      return reply.send({ success: true, message: 'Categoria eliminada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao eliminar categoria';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/product-categories/:categoryId/products', async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const query = request.query as {
      workspaceId?: string;
      q?: string;
      page?: string;
      limit?: string;
    };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const page = Math.max(0, Number(query.page ?? 0) || 0);
    const limit = Number(query.limit ?? 10) || 10;

    try {
      const data = await listCategoryProducts(
        workspaceId,
        Number(categoryId),
        parseSearchQuery(query.q),
        page,
        limit
      );
      const items = data.items.map((p) => ({
        ...p,
        vatAmount: computeProductTaxAmount(p),
        grossPrice: (p.price ?? 0) + computeProductTaxAmount(p),
      }));
      return reply.send({ success: true, data: { ...data, items } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar artigos';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/product-categories/:categoryId/products/import', async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };

    try {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ success: false, error: 'Ficheiro CSV em falta' });
      }

      const mime = (file.mimetype || '').toLowerCase();
      const filename = file.filename?.toLowerCase() ?? '';
      if (
        !mime.includes('csv') &&
        !mime.includes('text') &&
        !filename.endsWith('.csv') &&
        !filename.endsWith('.txt')
      ) {
        return reply.status(400).send({
          success: false,
          error: 'Formato inválido — use CSV (exporte Excel como CSV UTF-8)',
        });
      }

      const fields = file.fields as Record<string, { value?: string } | undefined>;
      const workspaceField = fields.workspaceId;
      const workspaceIdRaw =
        typeof workspaceField === 'object' && workspaceField && 'value' in workspaceField
          ? workspaceField.value
          : undefined;
      const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
        fastify,
        request.user,
        workspaceIdRaw
      );

      const csvText = (await file.toBuffer()).toString('utf8');
      const data = await importMoloniProductsFromCsv(workspaceId, Number(categoryId), csvText);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'billing.products_imported',
        entityType: 'product_category',
        entityId: String(categoryId),
        afterJson: data,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na importação';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/moloni-products/form-options', async (request, reply) => {
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.query as { workspaceId?: string }).workspaceId
    );

    try {
      const data = await getProductFormOptions(workspaceId);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar opções';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  const productBodySchema = z.object({
    workspaceId: z.string().uuid().optional(),
    categoryId: z.coerce.number().int(),
    type: z.coerce.number().int().min(1).max(4),
    name: z.string().min(1),
    reference: z.string().min(1),
    price: z.coerce.number().min(0),
    unitId: z.coerce.number().int(),
    taxId: z.coerce.number().int().optional(),
    ean: z.string().optional(),
    summary: z.string().optional(),
    notes: z.string().optional(),
    posFavorite: z.boolean().optional(),
    hasStock: z.boolean().optional(),
    stock: z.coerce.number().optional(),
    active: z.boolean().optional(),
  });

  fastify.post('/billing/moloni-products', async (request, reply) => {
    const body = productBodySchema.parse(request.body);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await createMoloniProduct(workspaceId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao criar artigo';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/moloni-products/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.query as { workspaceId?: string }).workspaceId
    );

    try {
      const data = await getMoloniProduct(workspaceId, Number(productId));
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Artigo não encontrado';
      return reply.status(404).send({ success: false, error: message });
    }
  });

  fastify.patch('/billing/moloni-products/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const body = productBodySchema.parse(request.body);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await updateMoloniProduct(workspaceId, Number(productId), body);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao actualizar artigo';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/moloni-products/:productId/duplicate', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.body as { workspaceId?: string })?.workspaceId ??
        (request.query as { workspaceId?: string }).workspaceId
    );

    try {
      const data = await duplicateMoloniProduct(workspaceId, Number(productId));
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao duplicar artigo';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/billing/moloni-products/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.query as { workspaceId?: string }).workspaceId
    );

    try {
      await deleteMoloniProduct(workspaceId, Number(productId));
      return reply.send({ success: true, message: 'Artigo eliminado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao eliminar artigo';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/products', async (request, reply) => {
    const query = request.query as { workspaceId?: string; q?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await searchMoloniProducts(workspaceId, parseSearchQuery(query.q));
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar artigos';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/billing/sync/documents', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await syncDocumentsFromMoloni(workspaceId, tenantId);
      return reply.send({ success: true, data, message: 'Documentos sincronizados do Moloni' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/moloni/companies', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await listMoloniCompanies(workspaceId);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao listar empresas Moloni';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/moloni/diagnostics', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    try {
      const data = await getMoloniCompanyDiagnostics(workspaceId);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no diagnóstico Moloni';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.get('/billing/moloni/status', async (request, reply) => {
    const query = request.query as { workspaceId?: string; probe?: string };
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const probe = query.probe !== '0' && query.probe !== 'false';
    const data = await getMoloniPublicStatus(workspaceId, { probe });
    return reply.send({ success: true, data });
  });

  fastify.post('/billing/moloni/document-set/apply-recommended', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z
      .object({ workspaceId: z.string().uuid().optional() })
      .parse(request.body ?? {});
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const documentSetHealth = await applyRecommendedMoloniDocumentSet(workspaceId);
      return reply.send({ success: true, data: { documentSetHealth } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao actualizar série documental';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.put('/billing/moloni/config', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1).optional(),
        companyId: z.coerce.number().int().optional(),
        documentSetId: z.coerce.number().int().optional(),
        redirectUri: z.string().url(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    const config = await upsertMoloniConfig({
      workspaceId,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      companyId: body.companyId,
      documentSetId: body.documentSetId,
      redirectUri: body.redirectUri,
    });

    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'billing.moloni_config_updated',
      entityType: 'billing_connection',
      entityId: config.id,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: config, message: 'Moloni configurado' });
  });

  fastify.get('/billing/moloni/auth-url', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      (request.query as { workspaceId?: string }).workspaceId
    );

    try {
      const data = await getMoloniAuthorizeUrl(workspaceId, request.user.sub);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha OAuth';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}

/** Callback OAuth Moloni — sem JWT; validado via state assinado */
export async function billingMoloniCallbackRoutes(fastify: FastifyInstance) {
  const settingsUi = (status: 'connected' | 'error') =>
    `${env.webPublicUrl.replace(/\/$/, '')}/dashboard/settings/moloni?moloni=${status}`;

  fastify.get('/billing/moloni/callback', async (request, reply) => {
    const { code, state, error } = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(request.query);

    if (error || !code || !state) {
      return reply.redirect(settingsUi('error'));
    }

    try {
      await completeMoloniOAuth(code, state);
      return reply.redirect(settingsUi('connected'));
    } catch {
      return reply.redirect(settingsUi('error'));
    }
  });
}
