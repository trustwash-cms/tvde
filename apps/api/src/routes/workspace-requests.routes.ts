import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAuditLog } from '../services/audit.service';
import {
  createWorkspaceWithModules,
  getWorkspaceQuota,
  incrementMaxWorkspaces,
} from '../services/workspace.service';

export async function workspaceRequestRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/workspace-requests', async (request, reply) => {
    const where =
      request.user.role === 'master'
        ? {}
        : { tenantId: request.user.tenantId! };

    const requests = await fastify.db.workspaceRequest.findMany({
      where,
      include: {
        tenant: { select: { siteId: true, name: true } },
        requester: { select: { email: true } },
        workspace: { select: { id: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ success: true, data: requests });
  });

  fastify.get('/workspaces/quota', async (request, reply) => {
    if (request.user.role === 'master' || !request.user.tenantId) {
      return reply.send({ success: true, data: null });
    }

    const quota = await getWorkspaceQuota(fastify.db, request.user.tenantId);
    const pending = await fastify.db.workspaceRequest.count({
      where: { tenantId: request.user.tenantId, status: 'pending' },
    });

    return reply.send({ success: true, data: { ...quota, pendingRequests: pending } });
  });

  fastify.post('/workspace-requests', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    if (request.user.role !== 'superadmin' || !request.user.tenantId) {
      throw fastify.httpErrors.forbidden('Apenas superadmin do tenant pode pedir workspaces');
    }

    const body = z.object({
      name: z.string().min(2),
      slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
      type: z.string().default('general'),
    }).parse(request.body);

    const pending = await fastify.db.workspaceRequest.count({
      where: { tenantId: request.user.tenantId, status: 'pending' },
    });
    if (pending > 0) {
      throw fastify.httpErrors.conflict('Já existe um pedido de workspace pendente de aprovação');
    }

    const quota = await getWorkspaceQuota(fastify.db, request.user.tenantId);
    if (quota.used < quota.maxWorkspaces) {
      throw fastify.httpErrors.conflict(
        'Ainda tem workspaces disponíveis no limite actual — contacte o MASTER se precisar de mais'
      );
    }

    const slugTaken = await fastify.db.workspace.findFirst({
      where: { tenantId: request.user.tenantId, slug: body.slug },
    });
    if (slugTaken) {
      throw fastify.httpErrors.conflict('Já existe um workspace com este slug');
    }

    const created = await fastify.db.workspaceRequest.create({
      data: {
        tenantId: request.user.tenantId,
        requestedBy: request.user.sub,
        name: body.name,
        slug: body.slug,
        type: body.type,
      },
    });

    await createAuditLog({
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      action: 'workspace.request',
      entityType: 'workspace_request',
      entityId: created.id,
      afterJson: created,
      ipAddress: request.ip,
    });

    return reply.status(201).send({ success: true, data: created });
  });

  fastify.post('/workspace-requests/:id/approve', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const wsRequest = await fastify.db.workspaceRequest.findUnique({
      where: { id },
      include: { tenant: true },
    });

    if (!wsRequest) {
      throw fastify.httpErrors.notFound('Pedido não encontrado');
    }
    if (wsRequest.status !== 'pending') {
      throw fastify.httpErrors.badRequest('Pedido já foi processado');
    }

    const slugTaken = await fastify.db.workspace.findFirst({
      where: { tenantId: wsRequest.tenantId, slug: wsRequest.slug },
    });
    if (slugTaken) {
      throw fastify.httpErrors.conflict('Slug já em uso neste tenant');
    }

    const workspace = await createWorkspaceWithModules(fastify.db, {
      tenantId: wsRequest.tenantId,
      name: wsRequest.name,
      slug: wsRequest.slug,
      type: wsRequest.type,
    });

    await incrementMaxWorkspaces(fastify.db, wsRequest.tenantId);

    const updated = await fastify.db.workspaceRequest.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedBy: request.user.sub,
        reviewedAt: new Date(),
        workspaceId: workspace.id,
      },
    });

    await createAuditLog({
      tenantId: wsRequest.tenantId,
      userId: request.user.sub,
      action: 'workspace.request.approve',
      entityType: 'workspace_request',
      entityId: id,
      afterJson: { workspaceId: workspace.id, slug: workspace.slug },
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: { request: updated, workspace } });
  });

  fastify.post('/workspace-requests/:id/reject', {
    preHandler: [fastify.requireRole('master')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ note: z.string().optional() }).parse(request.body ?? {});

    const wsRequest = await fastify.db.workspaceRequest.findUnique({ where: { id } });
    if (!wsRequest) {
      throw fastify.httpErrors.notFound('Pedido não encontrado');
    }
    if (wsRequest.status !== 'pending') {
      throw fastify.httpErrors.badRequest('Pedido já foi processado');
    }

    const updated = await fastify.db.workspaceRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedBy: request.user.sub,
        reviewedAt: new Date(),
        reviewNote: body.note,
      },
    });

    await createAuditLog({
      tenantId: wsRequest.tenantId,
      userId: request.user.sub,
      action: 'workspace.request.reject',
      entityType: 'workspace_request',
      entityId: id,
      afterJson: updated,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: updated });
  });
}
