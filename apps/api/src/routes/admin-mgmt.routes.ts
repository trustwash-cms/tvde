import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@tvde/database';
import { resolveWorkspaceTenantScope } from '../lib/workspace-scope';
import { env } from '../config/env';
import {
  createAdminMgmtContrato,
  createAdminMgmtDespesaPessoal,
  createAdminMgmtIrs,
  createAdminMgmtIva,
  createAdminMgmtReciboVerde,
  createAdminMgmtSegurancaSocial,
  createAdminMgmtSeguro,
  deleteAdminMgmtContrato,
  deleteAdminMgmtDespesaPessoal,
  deleteAdminMgmtIrs,
  deleteAdminMgmtIva,
  deleteAdminMgmtReciboVerde,
  deleteAdminMgmtSegurancaSocial,
  deleteAdminMgmtSeguro,
  deleteSeguroApolice,
  getSeguroApoliceForDownload,
  listAdminMgmtContratos,
  listAdminMgmtDespesasPessoal,
  listAdminMgmtIrs,
  listAdminMgmtIva,
  listAdminMgmtRecibosVerdes,
  listAdminMgmtSegurancaSocial,
  listAdminMgmtSeguros,
  updateAdminMgmtContrato,
  updateAdminMgmtSeguro,
  uploadAdminMgmtAttachment,
  uploadSeguroApolice,
  getAdminMgmtSettings,
  updateAdminMgmtSettings,
  listAdminMgmtClientes,
  getAdminMgmtCliente,
  lookupAdminMgmtClientes,
  createAdminMgmtCliente,
  updateAdminMgmtCliente,
  deleteAdminMgmtCliente,
  importAdminMgmtClienteFromSource,
  createAdminMgmtClienteLancamento,
  deleteAdminMgmtClienteLancamento,
  previewAdminMgmtClienteLancamento,
  previewRecibosVerdesCsvImport,
  confirmRecibosVerdesCsvImport,
  listRecibosVerdesImportacoes,
  listAdminMgmtFaturas,
  getAdminMgmtFatura,
  createAdminMgmtFatura,
  updateAdminMgmtFatura,
  markAdminMgmtFaturaPaid,
  markAdminMgmtFaturaPending,
  deleteAdminMgmtFatura,
  uploadFaturaAnexo,
  deleteFaturaAnexo,
  getFaturaAnexoForDownload,
} from '../services/admin-mgmt.service';
import {
  getAdminMgmtDashboard,
  listAdminMgmtVencimentos,
  refreshAdminMgmtVencimentoStatuses,
  reopenAdminMgmtVencimento,
  resolveAdminMgmtVencimento,
} from '../services/admin-mgmt-vencimentos.service';
import {
  openAdminMgmtAttachmentStream,
} from '../services/admin-mgmt-attachment-storage.service';
import {
  getAdminMgmtNotificationStatus,
  sendAdminMgmtTestNotifications,
} from '../services/admin-mgmt-notification.service';

const workspaceBody = z.object({ workspaceId: z.string().uuid().optional() });

async function resolveScope(
  fastify: FastifyInstance,
  request: { user: { role: string; tenantId: string | null; workspaceId: string | null } },
  workspaceId?: string
) {
  return resolveWorkspaceTenantScope(fastify, request.user as never, workspaceId);
}

export async function adminMgmtRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: env.adminMgmtMaxAttachmentBytes },
  });

  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('admin_mgmt'));

  fastify.get('/admin-mgmt/status', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const [seguros, contratos, vencimentos] = await Promise.all([
      listAdminMgmtSeguros(workspaceId, tenantId).then((r) => r.length),
      listAdminMgmtContratos(workspaceId, tenantId).then((r) => r.length),
      listAdminMgmtVencimentos(workspaceId, tenantId).then((r) => r.filter((v) => v.status !== 'resolvido').length),
    ]);
    return reply.send({
      success: true,
      data: { seguros, contratos, vencimentosPendentes: vencimentos },
    });
  });

  fastify.get('/admin-mgmt/dashboard', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    await refreshAdminMgmtVencimentoStatuses(workspaceId, tenantId);
    const data = await getAdminMgmtDashboard(workspaceId, tenantId);
    return reply.send({ success: true, data });
  });

  fastify.get('/admin-mgmt/vencimentos', async (request, reply) => {
    const query = request.query as { workspaceId?: string; status?: string; from?: string; to?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    await refreshAdminMgmtVencimentoStatuses(workspaceId, tenantId);
    const data = await listAdminMgmtVencimentos(workspaceId, tenantId, query);
    return reply.send({ success: true, data });
  });

  fastify.post('/admin-mgmt/vencimentos/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = workspaceBody.parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId);
    const data = await resolveAdminMgmtVencimento(id, workspaceId, tenantId);
    if (!data) return reply.status(404).send({ success: false, error: 'Vencimento não encontrado' });
    return reply.send({ success: true, data });
  });

  fastify.post('/admin-mgmt/vencimentos/:id/reopen', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = workspaceBody.parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId);
    const data = await reopenAdminMgmtVencimento(id, workspaceId, tenantId);
    if (!data) return reply.status(404).send({ success: false, error: 'Vencimento não encontrado' });
    return reply.send({ success: true, data });
  });

  fastify.get('/admin-mgmt/settings', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const data = await getAdminMgmtSettings(workspaceId, tenantId);
    return reply.send({ success: true, data });
  });

  fastify.put('/admin-mgmt/settings', async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        defaultAlertDays: z.coerce.number().int().min(0).max(365).optional(),
        defaultResponsavel: z.string().max(100).nullable().optional(),
        alertEmail: z.string().email().nullable().optional(),
        alertPhone: z.string().min(8).max(20).nullable().optional(),
        seguradoras: z.array(z.string().min(1).max(120)).optional(),
        tiposProduto: z.array(z.string().min(1).max(80)).optional(),
        syncFromMoloni: z.boolean().optional(),
        syncMoloniMarkPaidOnReceipt: z.boolean().optional(),
        securityPin: z.string().regex(/^\d{4,12}$/).optional(),
        clearSecurityPin: z.boolean().optional(),
      })
      .parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId);
    try {
      const data = await updateAdminMgmtSettings(workspaceId, tenantId, body);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/admin-mgmt/notifications/status', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const data = await getAdminMgmtNotificationStatus(tenantId);
    return reply.send({ success: true, data });
  });

  fastify.post('/admin-mgmt/notifications/test', async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        email: z.string().email().optional(),
        phone: z.string().min(8).max(20).optional(),
      })
      .parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId);
    try {
      const data = await sendAdminMgmtTestNotifications(workspaceId, tenantId, body);
      return reply.send({
        success: true,
        message: 'Notificação de teste enviada',
        data,
      });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao enviar teste',
      });
    }
  });

  // Seguros
  fastify.get('/admin-mgmt/seguros', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    return reply.send({ success: true, data: await listAdminMgmtSeguros(workspaceId, tenantId) });
  });

  fastify.post('/admin-mgmt/seguros', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtSeguro(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.put('/admin-mgmt/seguros/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await updateAdminMgmtSeguro(id, workspaceId, tenantId, body);
      if (!data) return reply.status(404).send({ success: false, error: 'Seguro não encontrado' });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/admin-mgmt/seguros/:id/apolices', async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const workspaceIdField = fields.workspaceId?.value;
    const { workspaceId, tenantId } = await resolveScope(fastify, request, workspaceIdField);
    const buffer = await file.toBuffer();
    try {
      const data = await uploadSeguroApolice(id, workspaceId, tenantId, {
        fileName: file.filename,
        mimeType: file.mimetype,
        buffer,
      });
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/admin-mgmt/seguros/:id/apolices/:apoliceId', async (request, reply) => {
    const { id, apoliceId } = request.params as { id: string; apoliceId: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const apolice = await getSeguroApoliceForDownload(id, apoliceId, workspaceId, tenantId);
    if (!apolice) return reply.status(404).send({ success: false, error: 'Apólice não encontrada' });
    reply.header('Content-Disposition', `attachment; filename="${apolice.fileName}"`);
    reply.type(apolice.mimeType);
    return reply.send(openAdminMgmtAttachmentStream(apolice.storageKey));
  });

  fastify.delete('/admin-mgmt/seguros/:id/apolices/:apoliceId', async (request, reply) => {
    const { id, apoliceId } = request.params as { id: string; apoliceId: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteSeguroApolice(id, apoliceId, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Apólice não encontrada' });
    return reply.send({ success: true });
  });

  fastify.delete('/admin-mgmt/seguros/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteAdminMgmtSeguro(id, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Seguro não encontrado' });
    return reply.send({ success: true });
  });

  // Contratos
  fastify.get('/admin-mgmt/contratos', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    return reply.send({ success: true, data: await listAdminMgmtContratos(workspaceId, tenantId) });
  });

  fastify.post('/admin-mgmt/contratos', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtContrato(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.put('/admin-mgmt/contratos/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    const data = await updateAdminMgmtContrato(id, workspaceId, tenantId, body);
    if (!data) return reply.status(404).send({ success: false, error: 'Contrato não encontrado' });
    return reply.send({ success: true, data });
  });

  fastify.delete('/admin-mgmt/contratos/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteAdminMgmtContrato(id, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Contrato não encontrado' });
    return reply.send({ success: true });
  });

  // Despesas pessoal
  fastify.get('/admin-mgmt/despesas-pessoal', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    return reply.send({ success: true, data: await listAdminMgmtDespesasPessoal(workspaceId, tenantId) });
  });

  fastify.post('/admin-mgmt/despesas-pessoal', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtDespesaPessoal(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.delete('/admin-mgmt/despesas-pessoal/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteAdminMgmtDespesaPessoal(id, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Registo não encontrado' });
    return reply.send({ success: true });
  });

  // Segurança Social
  fastify.get('/admin-mgmt/seguranca-social', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    return reply.send({ success: true, data: await listAdminMgmtSegurancaSocial(workspaceId, tenantId) });
  });

  fastify.post('/admin-mgmt/seguranca-social', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtSegurancaSocial(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.delete('/admin-mgmt/seguranca-social/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteAdminMgmtSegurancaSocial(id, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Registo não encontrado' });
    return reply.send({ success: true });
  });

  // IRS
  fastify.get('/admin-mgmt/irs', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    return reply.send({ success: true, data: await listAdminMgmtIrs(workspaceId, tenantId) });
  });

  fastify.post('/admin-mgmt/irs', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtIrs(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.delete('/admin-mgmt/irs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteAdminMgmtIrs(id, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Registo não encontrado' });
    return reply.send({ success: true });
  });

  // IVA
  fastify.get('/admin-mgmt/iva', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    return reply.send({ success: true, data: await listAdminMgmtIva(workspaceId, tenantId) });
  });

  fastify.post('/admin-mgmt/iva', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtIva(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.delete('/admin-mgmt/iva/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteAdminMgmtIva(id, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Registo não encontrado' });
    return reply.send({ success: true });
  });

  // Recibos verdes
  fastify.get('/admin-mgmt/recibos-verdes', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    return reply.send({ success: true, data: await listAdminMgmtRecibosVerdes(workspaceId, tenantId) });
  });

  fastify.post('/admin-mgmt/recibos-verdes', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtReciboVerde(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.delete('/admin-mgmt/recibos-verdes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteAdminMgmtReciboVerde(id, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Registo não encontrado' });
    return reply.send({ success: true });
  });

  // Clientes
  fastify.get('/admin-mgmt/clientes/lookup', async (request, reply) => {
    const query = request.query as { workspaceId?: string; q?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const data = await lookupAdminMgmtClientes(workspaceId, tenantId, query.q ?? '');
    return reply.send({ success: true, data });
  });

  fastify.get('/admin-mgmt/clientes', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    return reply.send({ success: true, data: await listAdminMgmtClientes(workspaceId, tenantId) });
  });

  fastify.get('/admin-mgmt/clientes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const data = await getAdminMgmtCliente(id, workspaceId, tenantId);
    if (!data) return reply.status(404).send({ success: false, error: 'Cliente não encontrado' });
    return reply.send({ success: true, data });
  });

  fastify.post('/admin-mgmt/clientes', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtCliente(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/admin-mgmt/clientes/import', async (request, reply) => {
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        source: z.enum(['crm', 'billing']),
        sourceId: z.string().uuid(),
      })
      .parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId);
    try {
      const data = await importAdminMgmtClienteFromSource(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.put('/admin-mgmt/clientes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    const data = await updateAdminMgmtCliente(id, workspaceId, tenantId, body);
    if (!data) return reply.status(404).send({ success: false, error: 'Cliente não encontrado' });
    return reply.send({ success: true, data });
  });

  fastify.delete('/admin-mgmt/clientes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    try {
      const ok = await deleteAdminMgmtCliente(id, workspaceId, tenantId);
      if (!ok) return reply.status(404).send({ success: false, error: 'Cliente não encontrado' });
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/admin-mgmt/clientes/:id/lancamentos/preview', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await previewAdminMgmtClienteLancamento(id, workspaceId, tenantId, body);
      if (!data) return reply.status(404).send({ success: false, error: 'Cliente não encontrado' });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/admin-mgmt/clientes/:id/lancamentos', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtClienteLancamento(id, workspaceId, tenantId, body);
      if (!data) return reply.status(404).send({ success: false, error: 'Cliente não encontrado' });
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.delete('/admin-mgmt/clientes/:clienteId/lancamentos/:lancamentoId', async (request, reply) => {
    const { clienteId, lancamentoId } = request.params as { clienteId: string; lancamentoId: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const data = await deleteAdminMgmtClienteLancamento(clienteId, lancamentoId, workspaceId, tenantId);
    if (!data) return reply.status(404).send({ success: false, error: 'Lançamento não encontrado' });
    return reply.send({ success: true, data });
  });

  fastify.post('/admin-mgmt/importacoes/recibos-verdes/preview', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro CSV em falta' });
    const workspaceIdField = file.fields.workspaceId;
    const workspaceId =
      workspaceIdField && 'value' in workspaceIdField ? String(workspaceIdField.value) : undefined;
    const { workspaceId: wsId, tenantId } = await resolveScope(fastify, request, workspaceId);
    const buffer = await file.toBuffer();
    const csvText = buffer.toString('utf-8');
    try {
      const data = await previewRecibosVerdesCsvImport(wsId, tenantId, csvText);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/admin-mgmt/importacoes/recibos-verdes/confirm', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro CSV em falta' });
    const workspaceIdField = file.fields.workspaceId;
    const workspaceId =
      workspaceIdField && 'value' in workspaceIdField ? String(workspaceIdField.value) : undefined;
    const { workspaceId: wsId, tenantId } = await resolveScope(fastify, request, workspaceId);
    const buffer = await file.toBuffer();
    const csvText = buffer.toString('utf-8');
    try {
      const data = await confirmRecibosVerdesCsvImport(wsId, tenantId, csvText, file.filename);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/admin-mgmt/importacoes/recibos-verdes', async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const data = await listRecibosVerdesImportacoes(workspaceId, tenantId);
    return reply.send({ success: true, data });
  });

  // Faturas
  fastify.get('/admin-mgmt/faturas', async (request, reply) => {
    const query = request.query as {
      workspaceId?: string;
      clienteId?: string;
      estadoPagamento?: string;
    };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const data = await listAdminMgmtFaturas(workspaceId, tenantId, query);
    return reply.send({ success: true, data });
  });

  fastify.get('/admin-mgmt/faturas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const data = await getAdminMgmtFatura(id, workspaceId, tenantId);
    if (!data) return reply.status(404).send({ success: false, error: 'Fatura não encontrada' });
    return reply.send({ success: true, data });
  });

  fastify.post('/admin-mgmt/faturas', async (request, reply) => {
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    try {
      const data = await createAdminMgmtFatura(workspaceId, tenantId, body);
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.put('/admin-mgmt/faturas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.record(z.unknown()).parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId as string | undefined);
    const data = await updateAdminMgmtFatura(id, workspaceId, tenantId, body);
    if (!data) return reply.status(404).send({ success: false, error: 'Fatura não encontrada' });
    return reply.send({ success: true, data });
  });

  fastify.post('/admin-mgmt/faturas/:id/mark-paid', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        dataPagamento: z.string(),
        metodoPagamento: z.string(),
      })
      .parse(request.body);
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId);
    try {
      const data = await markAdminMgmtFaturaPaid(id, workspaceId, tenantId, body);
      if (!data) return reply.status(404).send({ success: false, error: 'Fatura não encontrada' });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/admin-mgmt/faturas/:id/mark-pending', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        workspaceId: z.string().uuid().optional(),
        pin: z.string().min(4).max(12),
      })
      .parse(request.body ?? {});
    const { workspaceId, tenantId } = await resolveScope(fastify, request, body.workspaceId);
    try {
      const data = await markAdminMgmtFaturaPending(id, workspaceId, tenantId, { pin: body.pin });
      if (!data) return reply.status(404).send({ success: false, error: 'Fatura não encontrada' });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.delete('/admin-mgmt/faturas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteAdminMgmtFatura(id, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Fatura não encontrada' });
    return reply.send({ success: true });
  });

  fastify.post('/admin-mgmt/faturas/:id/anexos', async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const workspaceIdField = fields.workspaceId?.value;
    const { workspaceId, tenantId } = await resolveScope(fastify, request, workspaceIdField);
    const buffer = await file.toBuffer();
    try {
      const data = await uploadFaturaAnexo(id, workspaceId, tenantId, {
        fileName: file.filename,
        mimeType: file.mimetype,
        buffer,
      });
      return reply.status(201).send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/admin-mgmt/faturas/:id/anexos/:anexoId', async (request, reply) => {
    const { id, anexoId } = request.params as { id: string; anexoId: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const anexo = await getFaturaAnexoForDownload(id, anexoId, workspaceId, tenantId);
    if (!anexo) return reply.status(404).send({ success: false, error: 'Anexo não encontrado' });
    reply.header('Content-Disposition', `attachment; filename="${anexo.fileName}"`);
    reply.type(anexo.mimeType);
    return reply.send(openAdminMgmtAttachmentStream(anexo.storageKey));
  });

  fastify.delete('/admin-mgmt/faturas/:id/anexos/:anexoId', async (request, reply) => {
    const { id, anexoId } = request.params as { id: string; anexoId: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);
    const ok = await deleteFaturaAnexo(id, anexoId, workspaceId, tenantId);
    if (!ok) return reply.status(404).send({ success: false, error: 'Anexo não encontrado' });
    return reply.send({ success: true });
  });

  // Attachments
  fastify.post('/admin-mgmt/:entityType/:id/attachment', async (request, reply) => {
    const { entityType, id } = request.params as { entityType: string; id: string };
    const file = await request.file();
    if (!file) return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const workspaceIdField = fields.workspaceId?.value;
    const { workspaceId, tenantId } = await resolveScope(fastify, request, workspaceIdField);
    const buffer = await file.toBuffer();
    try {
      const data = await uploadAdminMgmtAttachment(entityType, id, workspaceId, tenantId, {
        fileName: file.filename,
        buffer,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/admin-mgmt/:entityType/:id/attachment', async (request, reply) => {
    const { entityType, id } = request.params as { entityType: string; id: string };
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveScope(fastify, request, query.workspaceId);

    let storageKey: string | null = null;
    let fileName = 'anexo';
    if (entityType === 'seguros') {
      const row = await prisma.adminMgmtSeguro.findFirst({ where: { id, workspaceId, tenantId } });
      storageKey = row?.attachmentStorageKey ?? null;
      fileName = row?.attachmentFileName ?? fileName;
    } else if (entityType === 'contratos') {
      const row = await prisma.adminMgmtContrato.findFirst({ where: { id, workspaceId, tenantId } });
      storageKey = row?.attachmentStorageKey ?? null;
      fileName = row?.attachmentFileName ?? fileName;
    }

    if (!storageKey) return reply.status(404).send({ success: false, error: 'Anexo não encontrado' });
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return reply.send(openAdminMgmtAttachmentStream(storageKey));
  });
}
