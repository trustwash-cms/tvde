import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PORTAL_KINDS, type PortalKind } from '@tvde/shared';
import {
  disconnectPortal,
  getPortalConnectionDetail,
  getPortalJob,
  listPortalConnections,
  startPortalConnect,
  startPortalSync,
  submitPortalOtp,
} from '../services/portal-rpa/portal-connection.service';

const portalParam = z.object({
  portal: z.enum(PORTAL_KINDS),
});

function requireTenant(request: { user: { tenantId: string | null } }) {
  if (!request.user.tenantId) throw new Error('Tenant em falta na sessão');
  return request.user.tenantId;
}

export async function portalConnectionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireRole('superadmin'));

  fastify.get('/portal-connections', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const data = await listPortalConnections(fastify.db, tenantId);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  fastify.get('/portal-connections/:portal', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const data = await getPortalConnectionDetail(fastify.db, tenantId, portal as PortalKind);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  fastify.post('/portal-connections/:portal/connect', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const body = z
        .object({
          username: z.string().min(1),
          password: z.string().optional().default(''),
        })
        .parse(request.body);

      if ((portal as PortalKind) !== 'uber' && !body.password) {
        return reply.status(400).send({ success: false, error: 'Password em falta' });
      }

      const data = await startPortalConnect(
        fastify.db,
        tenantId,
        portal as PortalKind,
        body.username,
        body.password,
        request.user.sub
      );
      return reply.send({ success: true, data, message: 'Ligação iniciada' });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  fastify.post('/portal-connections/:portal/otp', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const body = z.object({ code: z.string().min(3) }).parse(request.body);
      const data = await submitPortalOtp(
        fastify.db,
        tenantId,
        portal as PortalKind,
        body.code,
        request.user.sub
      );
      return reply.send({ success: true, data, message: 'OTP submetido' });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  fastify.post('/portal-connections/:portal/sync', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const body = z
        .object({
          syncScope: z.enum(['electric', 'fleet']).optional(),
        })
        .parse(request.body ?? {});
      const data = await startPortalSync(
        fastify.db,
        tenantId,
        portal as PortalKind,
        request.user.sub,
        { syncScope: body.syncScope }
      );
      return reply.send({ success: true, data, message: 'Sincronização iniciada' });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  fastify.delete('/portal-connections/:portal', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const data = await disconnectPortal(fastify.db, tenantId, portal as PortalKind);
      return reply.send({ success: true, data, message: 'Conta desligada' });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  fastify.get('/portal-connections/:portal/jobs/:jobId', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const params = z
        .object({ portal: z.enum(PORTAL_KINDS), jobId: z.string().uuid() })
        .parse(request.params);
      const data = await getPortalJob(
        fastify.db,
        tenantId,
        params.portal as PortalKind,
        params.jobId
      );
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });
}
