import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PORTAL_KINDS, type PortalKind } from '@tvde/shared';
import {
  clearPortalMessages,
  disconnectPortal,
  forgetPortalPassword,
  getPortalConnectionDetail,
  getPortalJob,
  getPortalLiveFrame,
  listPortalConnections,
  listUberPortalReports,
  setPortalAutoSync,
  postPortalLiveInput,
  cancelPortalLiveJob,
  startPortalConnect,
  startPortalSync,
  submitPortalOtp,
  submitPortalPassword,
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

  fastify.patch('/portal-connections/:portal/auto-sync', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const body = z.object({ autoSyncEnabled: z.boolean() }).parse(request.body ?? {});
      const data = await setPortalAutoSync(
        fastify.db,
        tenantId,
        portal as PortalKind,
        body.autoSyncEnabled
      );
      return reply.send({
        success: true,
        data,
        message: body.autoSyncEnabled
          ? 'Sincronização automática diária activada'
          : 'Sincronização automática diária desactivada',
      });
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
          username: z.string().optional().default(''),
          password: z.string().optional().default(''),
          useStoredCredentials: z.boolean().optional().default(false),
        })
        .parse(request.body);

      const existing = await getPortalConnectionDetail(
        fastify.db,
        tenantId,
        portal as PortalKind
      );
      const useStored =
        body.useStoredCredentials ||
        ((!body.username || !body.password) && existing.hasPassword);

      if (!useStored) {
        if (!body.username?.trim()) {
          return reply.status(400).send({ success: false, error: 'Utilizador em falta' });
        }
        if ((portal as PortalKind) !== 'uber' && !body.password) {
          return reply.status(400).send({ success: false, error: 'Password em falta' });
        }
      } else if (!existing.hasPassword && (portal as PortalKind) !== 'uber' && !body.password) {
        return reply.status(400).send({
          success: false,
          error: 'Não há password guardada — introduza a password',
        });
      }

      const data = await startPortalConnect(
        fastify.db,
        tenantId,
        portal as PortalKind,
        body.username,
        body.password,
        request.user.sub,
        { useStoredCredentials: useStored }
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

  fastify.post('/portal-connections/:portal/password', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const body = z.object({ password: z.string().min(1) }).parse(request.body);
      const data = await submitPortalPassword(
        fastify.db,
        tenantId,
        portal as PortalKind,
        body.password,
        request.user.sub
      );
      return reply.send({ success: true, data, message: 'Password submetida' });
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
          syncScope: z.enum(['electric', 'fleet', 'both']).optional(),
          uberSync: z
            .object({
              mode: z.enum(['existing', 'generate']),
              reportName: z.string().min(1).optional(),
              rangeStart: z.string().min(1).optional(),
              rangeEnd: z.string().min(1).optional(),
              organizationName: z.string().min(1).optional(),
              reportTypeKey: z
                .enum(['REPORT_TYPE_PAYMENTS_ORDER', 'REPORT_TYPE_PAYMENTS_DRIVER'])
                .optional(),
            })
            .optional(),
        })
        .parse(request.body ?? {});
      const data = await startPortalSync(
        fastify.db,
        tenantId,
        portal as PortalKind,
        request.user.sub,
        { syncScope: body.syncScope, uberSync: body.uberSync }
      );
      return reply.send({ success: true, data, message: 'Sincronização iniciada' });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  /** Uber: listar relatórios no Supplier (sessão + Playwright ~45–60s). */
  fastify.post('/portal-connections/:portal/reports', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      if ((portal as PortalKind) !== 'uber') {
        return reply.status(400).send({
          success: false,
          error: 'Listagem de relatórios só está disponível para Uber',
        });
      }
      const data = await listUberPortalReports(fastify.db, tenantId);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  fastify.post('/portal-connections/:portal/clear-messages', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const data = await clearPortalMessages(fastify.db, tenantId, portal as PortalKind);
      return reply.send({ success: true, data, message: 'Mensagens limpas' });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  fastify.post('/portal-connections/:portal/forget-password', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { portal } = portalParam.parse(request.params);
      const data = await forgetPortalPassword(fastify.db, tenantId, portal as PortalKind);
      return reply.send({ success: true, data, message: 'Password esquecida' });
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

  /** Stream JPEG do Chromium vivo (Arkose / passkey) — só job activo do tenant. */
  fastify.get('/portal-connections/:portal/jobs/:jobId/live-frame', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const params = z
        .object({ portal: z.enum(PORTAL_KINDS), jobId: z.string().uuid() })
        .parse(request.params);
      const data = await getPortalLiveFrame(
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

  /** Clique / arrasto mapeado para page.mouse (coords relativas à imagem mostrada). */
  fastify.post('/portal-connections/:portal/jobs/:jobId/live-input', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const params = z
        .object({ portal: z.enum(PORTAL_KINDS), jobId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          type: z.enum(['click', 'mousedown', 'mouseup', 'mousemove', 'drag']),
          x: z.number(),
          y: z.number(),
          endX: z.number().optional(),
          endY: z.number().optional(),
          button: z.enum(['left', 'right', 'middle']).optional(),
          displayWidth: z.number().positive(),
          displayHeight: z.number().positive(),
        })
        .parse(request.body);
      const data = await postPortalLiveInput(
        fastify.db,
        tenantId,
        params.portal as PortalKind,
        params.jobId,
        body
      );
      return reply.send({ success: true, data });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });

  /** Cancela job de ligação + fecha browser vivo (Desafio Uber / OTP). */
  fastify.post('/portal-connections/:portal/jobs/:jobId/cancel', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const params = z
        .object({ portal: z.enum(PORTAL_KINDS), jobId: z.string().uuid() })
        .parse(request.params);
      const data = await cancelPortalLiveJob(
        fastify.db,
        tenantId,
        params.portal as PortalKind,
        params.jobId
      );
      return reply.send({ success: true, data, message: 'Job cancelado' });
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: err instanceof Error ? err.message : 'Erro',
      });
    }
  });
}
