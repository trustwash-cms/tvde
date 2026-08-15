import { prisma } from '@tvde/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAuditLog } from '../services/audit.service';
import { resolveWorkspaceTenantScope } from '../lib/workspace-scope';
import {
  getWhmcsPublicStatus,
  testWhmcsCredentials,
  upsertWhmcsConnection,
} from '../services/whmcs/whmcs-connection.service';
import {
  listWhmcsInvoiceMaps,
  processWhmcsPaidInvoice,
  syncWhmcsPaidInvoices,
} from '../services/whmcs/whmcs-sync.service';
import {
  portalBulkInvoices,
  portalCancelInvoice,
  portalDeleteInvoice,
  portalGetClient,
  portalGetInvoice,
  portalListClients,
  portalListDomains,
  portalListInvoices,
  portalListPaymentMethods,
  portalListProducts,
  portalListServices,
  portalMarkInvoicePaid,
  portalMarkInvoiceUnpaid,
  portalSendClientEmail,
  portalSendInvoiceEmail,
  portalUpdateClient,
  portalUpdateInvoice,
  WhmcsPortalError,
} from '../services/whmcs/whmcs-portal.service';
import { env } from '../config/env';

function sendPortalError(reply: import('fastify').FastifyReply, err: unknown) {
  if (err instanceof WhmcsPortalError) {
    return reply.status(err.status).send({
      success: false,
      error: err.message,
      data: err.payload,
      ...(err.payload.hint ? { hint: err.payload.hint } : {}),
    });
  }
  const message = err instanceof Error ? err.message : 'Falha WHMCS';
  return reply.status(400).send({ success: false, error: message });
}

export async function whmcsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('whmcs'));

  fastify.get('/whmcs/status', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await getWhmcsPublicStatus(workspaceId, tenantId);
    return reply.send({ success: true, data });
  });

  fastify.put('/whmcs/config', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        apiUrl: z.string().url().or(z.string().min(8)),
        apiIdentifier: z.string().min(1),
        apiSecret: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
        emitOnPaid: z.boolean().optional(),
        sendEmailOnIssue: z.boolean().optional(),
        documentType: z.string().min(1).optional(),
        documentSetId: z.number().int().positive().nullable().optional(),
        pollLookbackDays: z.number().int().min(1).max(365).optional(),
      })
      .parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const row = await upsertWhmcsConnection({
        workspaceId,
        tenantId,
        apiUrl: body.apiUrl,
        apiIdentifier: body.apiIdentifier,
        apiSecret: body.apiSecret,
        isActive: body.isActive,
        emitOnPaid: body.emitOnPaid,
        sendEmailOnIssue: body.sendEmailOnIssue,
        documentType: body.documentType,
        documentSetId: body.documentSetId,
        pollLookbackDays: body.pollLookbackDays,
      });

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.config_updated',
        entityType: 'whmcs_connection',
        entityId: row.id,
        ipAddress: request.ip,
      });

      const data = await getWhmcsPublicStatus(workspaceId, tenantId);
      return reply.send({ success: true, data, message: 'Configuração WHMCS guardada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao guardar';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/whmcs/test-connection', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        apiUrl: z.string().min(8),
        apiIdentifier: z.string().min(1),
        /** Optional when workspace already has encrypted secret stored */
        apiSecret: z.string().min(1).optional(),
      })
      .parse(request.body);

    const { workspaceId } = body.workspaceId
      ? await resolveWorkspaceTenantScope(fastify, request.user, body.workspaceId)
      : { workspaceId: undefined as string | undefined };

    const data = await testWhmcsCredentials({
      apiUrl: body.apiUrl,
      apiIdentifier: body.apiIdentifier,
      apiSecret: body.apiSecret,
      workspaceId,
    });
    if (data.ok) {
      return reply.send({
        success: true,
        data,
        message: 'Ligação WHMCS OK',
      });
    }

    const error =
      data.hint ??
      data.error ??
      'Falha no teste';
    return reply.status(400).send({
      success: false,
      error,
      data,
      ...(data.hint ? { hint: data.hint } : {}),
    });
  });

  fastify.post('/whmcs/sync/paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(request.body ?? {});

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    try {
      const data = await syncWhmcsPaidInvoices({
        workspaceId,
        limitPerWorkspace: body.limit ?? 40,
      });
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.sync_paid',
        entityType: 'whmcs_connection',
        entityId: workspaceId,
        afterJson: data as unknown as Record<string, unknown>,
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha na sincronização';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  // ── Live CRM proxy (read-only) ──────────────────────────────────────────

  fastify.get('/whmcs/clients', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        search: z.string().optional(),
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalListClients(workspaceId, {
        search: query.search,
        status: query.status,
        limitNum: query.limit ?? 50,
        limitStart: query.offset ?? 0,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.get('/whmcs/clients/:whmcsClientId', async (request, reply) => {
    const { whmcsClientId } = request.params as { whmcsClientId: string };
    const query = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);
    const clientId = Number(whmcsClientId);
    if (!Number.isFinite(clientId) || clientId < 1) {
      return reply.status(400).send({ success: false, error: 'clientId inválido' });
    }
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalGetClient(workspaceId, clientId);
      return reply.send({ success: true, data });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.get('/whmcs/invoices/live', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        status: z.string().optional(),
        userId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalListInvoices(workspaceId, {
        status: query.status,
        userId: query.userId,
        limitNum: query.limit ?? 50,
        limitStart: query.offset ?? 0,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.get('/whmcs/invoices/live/:whmcsInvoiceId', async (request, reply) => {
    const { whmcsInvoiceId } = request.params as { whmcsInvoiceId: string };
    const query = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);
    const invoiceId = Number(whmcsInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      return reply.status(400).send({ success: false, error: 'invoiceId inválido' });
    }
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalGetInvoice(workspaceId, invoiceId);
      return reply.send({ success: true, data });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.get('/whmcs/services', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        clientId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalListServices(workspaceId, {
        clientId: query.clientId,
        limitNum: query.limit ?? 50,
        limitStart: query.offset ?? 0,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.get('/whmcs/domains', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        clientId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalListDomains(workspaceId, {
        clientId: query.clientId,
        limitNum: query.limit ?? 50,
        limitStart: query.offset ?? 0,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.get('/whmcs/products', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        pid: z.coerce.number().int().positive().optional(),
        gid: z.coerce.number().int().positive().optional(),
      })
      .parse(request.query);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalListProducts(workspaceId, {
        pid: query.pid,
        gid: query.gid,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  // ── Write actions (superadmin) ──────────────────────────────────────────

  const clientUpdateSchema = z.object({
    workspaceId: z.string().uuid().optional(),
    firstname: z.string().optional(),
    lastname: z.string().optional(),
    companyname: z.string().optional(),
    email: z.string().optional(),
    address1: z.string().optional(),
    address2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().optional(),
    phonenumber: z.string().optional(),
    tax_id: z.string().optional(),
    notes: z.string().optional(),
    status: z.string().optional(),
  });

  fastify.put('/whmcs/clients/:whmcsClientId', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { whmcsClientId } = request.params as { whmcsClientId: string };
    const clientId = Number(whmcsClientId);
    if (!Number.isFinite(clientId) || clientId < 1) {
      return reply.status(400).send({ success: false, error: 'clientId inválido' });
    }
    const body = clientUpdateSchema.parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const { workspaceId: _w, ...fields } = body;
      const data = await portalUpdateClient(workspaceId, clientId, fields);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.client_updated',
        entityType: 'whmcs_client',
        entityId: String(clientId),
        afterJson: { whmcsClientId: clientId, ...(fields as Record<string, unknown>) },
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Cliente actualizado no WHMCS' });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.post('/whmcs/clients/:whmcsClientId/email', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { whmcsClientId } = request.params as { whmcsClientId: string };
    const clientId = Number(whmcsClientId);
    if (!Number.isFinite(clientId) || clientId < 1) {
      return reply.status(400).send({ success: false, error: 'clientId inválido' });
    }
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        subject: z.string().min(1).max(500),
        message: z.string().min(1).max(50000),
      })
      .parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await portalSendClientEmail(workspaceId, clientId, {
        subject: body.subject,
        message: body.message,
      });
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.client_email_sent',
        entityType: 'whmcs_client',
        entityId: String(clientId),
        afterJson: { whmcsClientId: clientId, subject: body.subject },
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Email enviado' });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.get('/whmcs/payment-methods', async (request, reply) => {
    const query = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query);
    const { workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalListPaymentMethods(workspaceId);
      return reply.send({ success: true, data });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.post('/whmcs/invoices/live/:whmcsInvoiceId/send-email', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { whmcsInvoiceId } = request.params as { whmcsInvoiceId: string };
    const invoiceId = Number(whmcsInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      return reply.status(400).send({ success: false, error: 'invoiceId inválido' });
    }
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        messagename: z.string().optional(),
      })
      .parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await portalSendInvoiceEmail(workspaceId, invoiceId, {
        messagename: body.messagename,
      });
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.invoice_email_sent',
        entityType: 'whmcs_invoice',
        entityId: String(invoiceId),
        afterJson: { whmcsInvoiceId: invoiceId },
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Email de fatura enviado' });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.post('/whmcs/invoices/live/:whmcsInvoiceId/mark-paid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { whmcsInvoiceId } = request.params as { whmcsInvoiceId: string };
    const invoiceId = Number(whmcsInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      return reply.status(400).send({ success: false, error: 'invoiceId inválido' });
    }
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        gateway: z.string().optional(),
        transId: z.string().optional(),
        amount: z.number().positive().optional(),
        sendEmail: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await portalMarkInvoicePaid(workspaceId, invoiceId, {
        gateway: body.gateway,
        transId: body.transId,
        amount: body.amount,
        sendEmail: body.sendEmail,
      });
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.invoice_mark_paid',
        entityType: 'whmcs_invoice',
        entityId: String(invoiceId),
        afterJson: { whmcsInvoiceId: invoiceId, gateway: body.gateway },
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Fatura marcada como paga no WHMCS' });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.post('/whmcs/invoices/live/:whmcsInvoiceId/cancel', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { whmcsInvoiceId } = request.params as { whmcsInvoiceId: string };
    const invoiceId = Number(whmcsInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      return reply.status(400).send({ success: false, error: 'invoiceId inválido' });
    }
    const body = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await portalCancelInvoice(workspaceId, invoiceId);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.invoice_cancelled',
        entityType: 'whmcs_invoice',
        entityId: String(invoiceId),
        afterJson: { whmcsInvoiceId: invoiceId },
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Fatura cancelada no WHMCS' });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.post('/whmcs/invoices/live/:whmcsInvoiceId/mark-unpaid', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { whmcsInvoiceId } = request.params as { whmcsInvoiceId: string };
    const invoiceId = Number(whmcsInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      return reply.status(400).send({ success: false, error: 'invoiceId inválido' });
    }
    const body = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await portalMarkInvoiceUnpaid(workspaceId, invoiceId);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.invoice_mark_unpaid',
        entityType: 'whmcs_invoice',
        entityId: String(invoiceId),
        afterJson: { whmcsInvoiceId: invoiceId },
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Fatura marcada como Unpaid no WHMCS' });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  const invoiceLineSchema = z.object({
    id: z.number().int().positive(),
    description: z.string().min(1),
    amount: z.union([z.number(), z.string()]),
    taxed: z.boolean().optional(),
  });
  const invoiceNewLineSchema = z.object({
    description: z.string().min(1),
    amount: z.union([z.number(), z.string()]),
    taxed: z.boolean().optional(),
  });

  fastify.put('/whmcs/invoices/live/:whmcsInvoiceId', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { whmcsInvoiceId } = request.params as { whmcsInvoiceId: string };
    const invoiceId = Number(whmcsInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      return reply.status(400).send({ success: false, error: 'invoiceId inválido' });
    }
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        status: z.string().optional(),
        paymentmethod: z.string().optional(),
        date: z.string().optional(),
        duedate: z.string().optional(),
        datepaid: z.string().optional(),
        notes: z.string().optional(),
        taxrate: z.number().optional(),
        taxrate2: z.number().optional(),
        credit: z.number().optional(),
        lines: z.array(invoiceLineSchema).optional(),
        newLines: z.array(invoiceNewLineSchema).optional(),
        deleteLineIds: z.array(z.number().int().positive()).optional(),
      })
      .parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await portalUpdateInvoice(workspaceId, invoiceId, body);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'whmcs.invoice_updated',
        entityType: 'whmcs_invoice',
        entityId: String(invoiceId),
        afterJson: {
          whmcsInvoiceId: invoiceId,
          status: body.status,
          lines: body.lines?.length,
          newLines: body.newLines?.length,
          deleteLineIds: body.deleteLineIds,
        },
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data, message: 'Fatura actualizada no WHMCS' });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.delete('/whmcs/invoices/live/:whmcsInvoiceId', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { whmcsInvoiceId } = request.params as { whmcsInvoiceId: string };
    const invoiceId = Number(whmcsInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId < 1) {
      return reply.status(400).send({ success: false, error: 'invoiceId inválido' });
    }
    const query = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.query ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await portalDeleteInvoice(workspaceId, invoiceId);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: data.deleted ? 'whmcs.invoice_deleted' : 'whmcs.invoice_cancelled',
        entityType: 'whmcs_invoice',
        entityId: String(invoiceId),
        afterJson: { whmcsInvoiceId: invoiceId, fallbackCancelled: data.fallbackCancelled },
        ipAddress: request.ip,
      });
      return reply.send({
        success: true,
        data,
        message: data.deleted
          ? 'Fatura apagada no WHMCS'
          : data.message || 'Fatura cancelada (DeleteInvoice indisponível)',
      });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  fastify.post('/whmcs/invoices/live/bulk', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        action: z.enum(['mark-paid', 'mark-unpaid', 'cancel', 'delete']),
        invoiceIds: z.array(z.number().int().positive()).min(1).max(50),
        gateway: z.string().optional(),
        sendEmail: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );
    try {
      const data = await portalBulkInvoices(workspaceId, body);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: `whmcs.invoice_bulk_${body.action}`,
        entityType: 'whmcs_invoice',
        entityId: null,
        afterJson: {
          whmcsInvoiceIds: body.invoiceIds,
          succeeded: data.succeeded,
          failed: data.failed,
        },
        ipAddress: request.ip,
      });
      return reply.send({
        success: true,
        data,
        message: `Bulk ${body.action}: ${data.succeeded}/${data.total} OK`,
      });
    } catch (err) {
      return sendPortalError(reply, err);
    }
  });

  // ── Local Moloni emission map ───────────────────────────────────────────

  fastify.get('/whmcs/invoices', async (request, reply) => {
    const query = z
      .object({
        workspaceId: z.string().uuid().optional(),
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const data = await listWhmcsInvoiceMaps(workspaceId, tenantId, {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    return reply.send({ success: true, data });
  });

  fastify.post('/whmcs/invoices/:id/reprocess', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ workspaceId: z.string().uuid().optional() }).parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    const map = await prisma.whmcsInvoiceMap.findFirst({
      where: { id, workspaceId, tenantId },
    });
    if (!map) {
      return reply.status(404).send({ success: false, error: 'Registo não encontrado' });
    }

    try {
      const data = await processWhmcsPaidInvoice({
        workspaceId,
        tenantId,
        whmcsInvoiceId: map.whmcsInvoiceId,
        force: true,
      });
      return reply.send({ success: true, data, message: 'Reprocessado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao reprocessar';
      return reply.status(400).send({ success: false, error: message });
    }
  });
}

/** Cron HTTP: POST /whmcs/cron/sync-paid com X-Billing-Sync-Secret (reusa secret de billing). */
export async function whmcsSyncCronRoutes(fastify: FastifyInstance) {
  fastify.post('/whmcs/cron/sync-paid', async (request, reply) => {
    const secret = request.headers['x-billing-sync-secret'];
    const expected = env.billingSyncSecret;
    if (!expected || secret !== expected) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }
    const data = await syncWhmcsPaidInvoices({ limitPerWorkspace: 50 });
    return reply.send({ success: true, data });
  });
}
