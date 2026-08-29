import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  VIRTUALIZATION_DASHBOARD_REFRESH_OPTIONS,
  VIRTUALIZATION_POLL_INTERVAL_OPTIONS,
  buildPbsApiToken,
  buildPveApiToken,
  extractPbsApiTokenId,
  extractPveApiTokenId,
  isLikelyPveBaseUrl,
} from '@tvde/shared';
import { resolveWorkspaceTenantScope } from '../lib/workspace-scope';
import {
  createVirtualizationPbsServer,
  deleteVirtualizationPbsServer,
  getVirtualizationDashboardCached,
  getVirtualizationPbsServerDetail,
  getVirtualizationSettings,
  listVirtualizationPbsServers,
  testVirtualizationPbsServer,
  updateVirtualizationPbsServer,
  updateVirtualizationSettings,
} from '../services/virtualization.service';
import {
  createVirtualizationPveServer,
  deleteVirtualizationPveServer,
  getVirtualizationPveGuestNetwork,
  getVirtualizationPveServerDetail,
  listVirtualizationPveGuests,
  listVirtualizationPveServers,
  testVirtualizationPveServer,
  updateVirtualizationPveServer,
} from '../services/virtualization-pve.service';
import {
  createVirtualizationPveConsoleSession,
  createVirtualizationPveSshSession,
  getPveConsoleSession,
  getPveSshSession,
} from '../services/virtualization-pve-sessions.service';
import {
  proxyPveConsoleWebsocket,
  proxyPveSshWebsocket,
} from '../services/virtualization-pve-ws-proxy.service';
import {
  createVirtualizationZerotierAccount,
  createVirtualizationZerotierJoinTarget,
  deleteVirtualizationZerotierAccount,
  deleteVirtualizationZerotierJoinTarget,
  getVirtualizationZerotierJoinTarget,
  linkVirtualizationZerotierNetwork,
  listVirtualizationZerotierAccounts,
  listVirtualizationZerotierJoinTargets,
  listVirtualizationZerotierNetworkMembers,
  listVirtualizationZerotierNetworks,
  listVirtualizationZerotierRemoteNetworks,
  refreshAllVirtualizationZerotierNetworks,
  refreshVirtualizationZerotierNetwork,
  setVirtualizationZerotierMemberAuthorized,
  testVirtualizationZerotierAccount,
  unlinkVirtualizationZerotierNetwork,
  updateVirtualizationZerotierAccount,
} from '../services/zerotier.service';
import { startZerotierJoinTargetProvision } from '../services/zerotier-provision.service';
import {
  getLocalZerotierHostStatus,
  provisionLocalZerotierHost,
  ensureLocalZerotierOnAllWorkspaceNetworks,
} from '../services/zerotier-local.service';

const workspaceQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  refresh: z.enum(['1', 'true']).optional(),
});

const normalizedUrlSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().replace(/\/+$/, '') : value),
  z.string().url().max(500)
);

const pbsServerBodySchema = z
  .object({
    label: z.string().min(1).max(120),
    tags: z.array(z.string().max(40)).max(20).optional(),
    baseUrl: normalizedUrlSchema,
    datastore: z.string().min(1).max(120),
    apiToken: z.string().min(1).optional(),
    apiTokenId: z.string().min(1).max(200).optional(),
    apiTokenSecret: z.string().min(1).max(500).optional(),
    verifySsl: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .superRefine((data, ctx) => {
    const hasCombined = Boolean(data.apiToken?.trim());
    const hasSplit = Boolean(data.apiTokenId?.trim() && data.apiTokenSecret?.trim());
    if (!hasCombined && !hasSplit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Indique o Token ID e o Secret (ou o token completo)',
        path: ['apiTokenId'],
      });
    }
    if (isLikelyPveBaseUrl(data.baseUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'URL com porta 8006 é Proxmox VE — adicione este servidor no separador PVE, não em PBS.',
        path: ['baseUrl'],
      });
    }
  });

const pbsServerUpdateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  baseUrl: normalizedUrlSchema.optional(),
  datastore: z.string().min(1).max(120).optional(),
  apiToken: z.string().min(1).optional(),
  apiTokenId: z.string().min(1).max(200).optional(),
  apiTokenSecret: z.string().min(1).max(500).optional(),
  verifySsl: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

function resolvePbsApiToken(input: {
  apiToken?: string;
  apiTokenId?: string;
  apiTokenSecret?: string;
}): string | undefined {
  const combined = input.apiToken?.trim();
  if (combined) return combined;

  const tokenId = input.apiTokenId?.trim();
  const tokenSecret = input.apiTokenSecret?.trim();
  if (tokenId && tokenSecret) {
    return buildPbsApiToken(tokenId, tokenSecret);
  }

  return undefined;
}

function resolvePveApiToken(input: {
  apiToken?: string;
  apiTokenId?: string;
  apiTokenSecret?: string;
}): string | undefined {
  const combined = input.apiToken?.trim();
  if (combined) return combined;

  const tokenId = input.apiTokenId?.trim();
  const tokenSecret = input.apiTokenSecret?.trim();
  if (tokenId && tokenSecret) {
    return buildPveApiToken(tokenId, tokenSecret);
  }

  return undefined;
}

const pveServerBodySchema = z
  .object({
    label: z.string().min(1).max(120),
    tags: z.array(z.string().max(40)).max(20).optional(),
    baseUrl: normalizedUrlSchema,
    apiToken: z.string().min(1).optional(),
    apiTokenId: z.string().min(1).max(200).optional(),
    apiTokenSecret: z.string().min(1).max(500).optional(),
    verifySsl: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .superRefine((data, ctx) => {
    const hasCombined = Boolean(data.apiToken?.trim());
    const hasSplit = Boolean(data.apiTokenId?.trim() && data.apiTokenSecret?.trim());
    if (!hasCombined && !hasSplit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Indique o Token ID e o Secret (ou o token completo)',
        path: ['apiTokenId'],
      });
    }
  });

const pveServerUpdateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  baseUrl: normalizedUrlSchema.optional(),
  apiToken: z.string().min(1).optional(),
  apiTokenId: z.string().min(1).max(200).optional(),
  apiTokenSecret: z.string().min(1).max(500).optional(),
  verifySsl: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const settingsBodySchema = z.object({
  notifyOnBackupFailure: z.boolean().optional(),
  notifyWhatsappEnabled: z.boolean().optional(),
  notifyWhatsappPhones: z.array(z.string().min(8).max(20)).max(20).optional(),
  notifyEmailEnabled: z.boolean().optional(),
  notifyEmailAddresses: z.array(z.string().email()).max(20).optional(),
  pollIntervalMinutes: z
    .number()
    .int()
    .refine((v) => (VIRTUALIZATION_POLL_INTERVAL_OPTIONS as readonly number[]).includes(v))
    .optional(),
  dashboardRefreshSeconds: z
    .number()
    .int()
    .refine((v) => (VIRTUALIZATION_DASHBOARD_REFRESH_OPTIONS as readonly number[]).includes(v))
    .optional(),
  sshDefaultPort: z.number().int().min(1).max(65535).optional(),
  sshDefaultUsername: z.string().min(1).max(120).optional(),
  sshAuthMode: z.enum(['password', 'private_key']).optional(),
  sshPassword: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  sshPassphrase: z.string().optional(),
});

export async function virtualizationRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/websocket'));

  fastify.addHook('onRequest', async (request) => {
    const query = request.query as { token?: string };
    if (typeof query.token === 'string' && query.token.trim() && !request.headers.authorization) {
      request.headers.authorization = `Bearer ${query.token.trim()}`;
    }
  });

  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('virtualization'));
  fastify.addHook('preHandler', fastify.requireRole('superadmin'));

  fastify.get('/virtualization/dashboard', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await getVirtualizationDashboardCached(tenantId, workspaceId, {
      bypassCache: query.refresh != null,
    });
    return reply.send({ success: true, data });
  });

  fastify.get('/virtualization/settings', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await getVirtualizationSettings(tenantId, workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.patch('/virtualization/settings', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const body = settingsBodySchema.parse(request.body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await updateVirtualizationSettings(tenantId, workspaceId, body);
    return reply.send({ success: true, data });
  });

  fastify.get('/virtualization/pbs/servers', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await listVirtualizationPbsServers(tenantId, workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.post('/virtualization/pbs/servers', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const body = pbsServerBodySchema.parse(request.body);
    const apiToken = resolvePbsApiToken(body);
    if (!apiToken) {
      throw fastify.httpErrors.badRequest('Token ID e Secret são obrigatórios');
    }
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await createVirtualizationPbsServer(tenantId, workspaceId, {
      label: body.label,
      tags: body.tags,
      baseUrl: body.baseUrl,
      datastore: body.datastore,
      verifySsl: body.verifySsl,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
      apiToken,
      apiTokenId: body.apiTokenId?.trim() ?? extractPbsApiTokenId(apiToken),
    });
    return reply.send({ success: true, data });
  });

  fastify.patch('/virtualization/pbs/servers/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const body = pbsServerUpdateSchema.parse(request.body);
    const apiToken = resolvePbsApiToken(body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await updateVirtualizationPbsServer(tenantId, workspaceId, id, {
        label: body.label,
        tags: body.tags,
        baseUrl: body.baseUrl,
        datastore: body.datastore,
        verifySsl: body.verifySsl,
        isActive: body.isActive,
        sortOrder: body.sortOrder,
        ...(apiToken
          ? {
              apiToken,
              apiTokenId: body.apiTokenId?.trim() ?? extractPbsApiTokenId(apiToken),
            }
          : {}),
      });
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao actualizar servidor';
      throw fastify.httpErrors.notFound(message);
    }
  });

  fastify.delete('/virtualization/pbs/servers/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      await deleteVirtualizationPbsServer(tenantId, workspaceId, id);
      return reply.send({ success: true, data: { ok: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao remover servidor';
      throw fastify.httpErrors.notFound(message);
    }
  });

  fastify.post('/virtualization/pbs/servers/:id/test', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await testVirtualizationPbsServer(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no teste de ligação';
      throw fastify.httpErrors.badGateway(message);
    }
  });

  fastify.get('/virtualization/pbs/servers/:id/detail', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await getVirtualizationPbsServerDetail(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Servidor não encontrado';
      throw fastify.httpErrors.notFound(message);
    }
  });

  fastify.get('/virtualization/pve/servers', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await listVirtualizationPveServers(tenantId, workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.post('/virtualization/pve/servers', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const body = pveServerBodySchema.parse(request.body);
    const apiToken = resolvePveApiToken(body);
    if (!apiToken) {
      throw fastify.httpErrors.badRequest('Token ID e Secret são obrigatórios');
    }
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await createVirtualizationPveServer(tenantId, workspaceId, {
      label: body.label,
      tags: body.tags,
      baseUrl: body.baseUrl,
      verifySsl: body.verifySsl,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
      apiToken,
      apiTokenId: body.apiTokenId?.trim() ?? extractPveApiTokenId(apiToken),
    });
    return reply.send({ success: true, data });
  });

  fastify.patch('/virtualization/pve/servers/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const body = pveServerUpdateSchema.parse(request.body);
    const apiToken = resolvePveApiToken(body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await updateVirtualizationPveServer(tenantId, workspaceId, id, {
        label: body.label,
        tags: body.tags,
        baseUrl: body.baseUrl,
        verifySsl: body.verifySsl,
        isActive: body.isActive,
        sortOrder: body.sortOrder,
        ...(apiToken
          ? {
              apiToken,
              apiTokenId: body.apiTokenId?.trim() ?? extractPveApiTokenId(apiToken),
            }
          : {}),
      });
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao actualizar servidor';
      throw fastify.httpErrors.notFound(message);
    }
  });

  fastify.delete('/virtualization/pve/servers/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      await deleteVirtualizationPveServer(tenantId, workspaceId, id);
      return reply.send({ success: true, data: { ok: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao remover servidor';
      throw fastify.httpErrors.notFound(message);
    }
  });

  fastify.post('/virtualization/pve/servers/:id/test', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await testVirtualizationPveServer(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no teste de ligação';
      throw fastify.httpErrors.badGateway(message);
    }
  });

  fastify.get('/virtualization/pve/servers/:id/detail', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await getVirtualizationPveServerDetail(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Servidor não encontrado';
      throw fastify.httpErrors.notFound(message);
    }
  });

  const guestTypeSchema = z.enum(['qemu', 'lxc']);

  fastify.get('/virtualization/pve/servers/:id/guests', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await listVirtualizationPveGuests(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Servidor não encontrado';
      throw fastify.httpErrors.notFound(message);
    }
  });

  fastify.get('/virtualization/pve/servers/:id/guests/:guestType/:vmid/network', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const params = z
      .object({
        id: z.string().uuid(),
        guestType: guestTypeSchema,
        vmid: z.coerce.number().int().positive(),
      })
      .parse(request.params);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await getVirtualizationPveGuestNetwork(
        tenantId,
        workspaceId,
        params.id,
        params.guestType,
        params.vmid
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao obter rede';
      throw fastify.httpErrors.badRequest(message);
    }
  });

  fastify.post('/virtualization/pve/servers/:id/guests/:guestType/:vmid/console', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const params = z
      .object({
        id: z.string().uuid(),
        guestType: guestTypeSchema,
        vmid: z.coerce.number().int().positive(),
      })
      .parse(request.params);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await createVirtualizationPveConsoleSession(
        tenantId,
        workspaceId,
        params.id,
        params.guestType,
        params.vmid
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao abrir consola';
      throw fastify.httpErrors.badRequest(message);
    }
  });

  fastify.post('/virtualization/pve/servers/:id/guests/:guestType/:vmid/ssh', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const params = z
      .object({
        id: z.string().uuid(),
        guestType: guestTypeSchema,
        vmid: z.coerce.number().int().positive(),
      })
      .parse(request.params);
    const body = z
      .object({
        host: z.string().min(1).max(255),
        port: z.number().int().min(1).max(65535).optional(),
        username: z.string().min(1).max(120),
        password: z.string().max(500).optional(),
        privateKey: z.string().max(20_000).optional(),
        passphrase: z.string().max(500).optional(),
      })
      .parse(request.body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await createVirtualizationPveSshSession(
        tenantId,
        workspaceId,
        params.id,
        params.guestType,
        params.vmid,
        body
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao abrir SSH';
      throw fastify.httpErrors.badRequest(message);
    }
  });

  fastify.get(
    '/virtualization/pve/console-ws/:sessionId',
    { websocket: true },
    (socket, request) => {
      void (async () => {
        try {
          const query = workspaceQuerySchema.parse(request.query);
          const { sessionId } = request.params as { sessionId: string };
          const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
            fastify,
            request.user,
            query.workspaceId
          );
          const session = getPveConsoleSession(sessionId, tenantId, workspaceId);
          if (!session) {
            socket.close(1008, 'Sessão de consola inválida ou expirada');
            return;
          }
          proxyPveConsoleWebsocket(socket, session);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Erro WS consola';
          try {
            socket.close(1011, message.slice(0, 100));
          } catch {
            // ignore
          }
        }
      })();
    }
  );

  fastify.get(
    '/virtualization/pve/ssh-ws/:sessionId',
    { websocket: true },
    (socket, request) => {
      void (async () => {
        try {
          const query = workspaceQuerySchema.parse(request.query);
          const { sessionId } = request.params as { sessionId: string };
          const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
            fastify,
            request.user,
            query.workspaceId
          );
          const session = getPveSshSession(sessionId, tenantId, workspaceId);
          if (!session) {
            socket.close(1008, 'Sessão SSH inválida ou expirada');
            return;
          }
          proxyPveSshWebsocket(socket, session);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Erro WS SSH';
          try {
            socket.close(1011, message.slice(0, 100));
          } catch {
            // ignore
          }
        }
      })();
    }
  );

  fastify.get('/virtualization/zerotier/accounts', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await listVirtualizationZerotierAccounts(tenantId, workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.post('/virtualization/zerotier/accounts', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const body = z
      .object({
        label: z.string().min(1).max(120),
        email: z.string().email().max(255).optional(),
        apiToken: z.string().min(1),
        apiMode: z.enum(['legacy', 'central']).optional(),
        orgId: z.string().max(120).optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
      })
      .parse(request.body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await createVirtualizationZerotierAccount(tenantId, workspaceId, body);
    return reply.send({ success: true, data });
  });

  fastify.patch('/virtualization/zerotier/accounts/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const body = z
      .object({
        label: z.string().min(1).max(120).optional(),
        email: z.string().email().max(255).nullable().optional(),
        apiToken: z.string().min(1).optional(),
        apiMode: z.enum(['legacy', 'central']).optional(),
        orgId: z.string().max(120).nullable().optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
      })
      .parse(request.body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await updateVirtualizationZerotierAccount(tenantId, workspaceId, id, body);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.notFound(err instanceof Error ? err.message : 'Conta não encontrada');
    }
  });

  fastify.delete('/virtualization/zerotier/accounts/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      await deleteVirtualizationZerotierAccount(tenantId, workspaceId, id);
      return reply.send({ success: true, data: { ok: true } });
    } catch (err) {
      throw fastify.httpErrors.notFound(err instanceof Error ? err.message : 'Conta não encontrada');
    }
  });

  fastify.post('/virtualization/zerotier/accounts/:id/test', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await testVirtualizationZerotierAccount(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badGateway(err instanceof Error ? err.message : 'Falha no teste');
    }
  });

  fastify.get('/virtualization/zerotier/accounts/:id/networks/remote', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await listVirtualizationZerotierRemoteNetworks(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badGateway(err instanceof Error ? err.message : 'Erro ZeroTier');
    }
  });

  fastify.get('/virtualization/zerotier/networks', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await listVirtualizationZerotierNetworks(tenantId, workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.post('/virtualization/zerotier/accounts/:id/networks', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const body = z
      .object({
        networkId: z.string().min(16).max(16),
        label: z.string().max(200).optional(),
        description: z.string().max(500).nullable().optional(),
        memberLimit: z.number().int().min(1).max(100).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(request.body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await linkVirtualizationZerotierNetwork(tenantId, workspaceId, id, body);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badRequest(err instanceof Error ? err.message : 'Erro ao associar rede');
    }
  });

  fastify.delete('/virtualization/zerotier/networks/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      await unlinkVirtualizationZerotierNetwork(tenantId, workspaceId, id);
      return reply.send({ success: true, data: { ok: true } });
    } catch (err) {
      throw fastify.httpErrors.notFound(err instanceof Error ? err.message : 'Rede não encontrada');
    }
  });

  fastify.post('/virtualization/zerotier/networks/:id/refresh', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await refreshVirtualizationZerotierNetwork(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badGateway(err instanceof Error ? err.message : 'Erro ao actualizar');
    }
  });

  fastify.post('/virtualization/zerotier/networks/refresh-all', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const refreshed = await refreshAllVirtualizationZerotierNetworks(tenantId, workspaceId);
    return reply.send({ success: true, data: { refreshed } });
  });

  fastify.get('/virtualization/zerotier/networks/:id/members', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await listVirtualizationZerotierNetworkMembers(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badGateway(err instanceof Error ? err.message : 'Erro ZeroTier');
    }
  });

  fastify.patch('/virtualization/zerotier/networks/:id/members/:memberId', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id, memberId } = request.params as { id: string; memberId: string };
    const body = z
      .object({
        authorized: z.boolean(),
        name: z.string().max(120).nullable().optional(),
      })
      .parse(request.body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await setVirtualizationZerotierMemberAuthorized(
        tenantId,
        workspaceId,
        id,
        memberId,
        body.authorized,
        { name: body.name }
      );
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badGateway(err instanceof Error ? err.message : 'Erro ZeroTier');
    }
  });

  fastify.get('/virtualization/zerotier/join-targets', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    const data = await listVirtualizationZerotierJoinTargets(tenantId, workspaceId);
    return reply.send({ success: true, data });
  });

  fastify.post('/virtualization/zerotier/join-targets', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const body = z
      .object({
        networkRowId: z.string().uuid(),
        label: z.string().min(1).max(120),
        sshHost: z.string().max(255).optional(),
        sshPort: z.number().int().min(1).max(65535).optional(),
        sshUsername: z.string().min(1).max(120).optional(),
        useWorkspaceSsh: z.boolean().optional(),
        sshAuthMode: z.enum(['password', 'private_key']).optional(),
        sshPassword: z.string().min(1).optional(),
        sshPrivateKey: z.string().min(1).optional(),
        sshPassphrase: z.string().optional(),
        targetKind: z.enum(['pbs', 'pve', 'custom']).optional(),
        pbsServerId: z.string().uuid().nullable().optional(),
        pveServerId: z.string().uuid().nullable().optional(),
      })
      .superRefine((value, ctx) => {
        if (value.useWorkspaceSsh ?? true) return;
        const mode = value.sshAuthMode ?? 'password';
        if (mode === 'private_key' && !value.sshPrivateKey?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Chave privada SSH é obrigatória',
            path: ['sshPrivateKey'],
          });
        }
        if (mode === 'password' && !value.sshPassword?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Password SSH é obrigatória',
            path: ['sshPassword'],
          });
        }
      })
      .parse(request.body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await createVirtualizationZerotierJoinTarget(tenantId, workspaceId, body);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badRequest(err instanceof Error ? err.message : 'Erro ao criar alvo');
    }
  });

  fastify.get('/virtualization/zerotier/join-targets/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await getVirtualizationZerotierJoinTarget(tenantId, workspaceId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.notFound(err instanceof Error ? err.message : 'Alvo não encontrado');
    }
  });

  fastify.delete('/virtualization/zerotier/join-targets/:id', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      await deleteVirtualizationZerotierJoinTarget(tenantId, workspaceId, id);
      return reply.send({ success: true, data: { ok: true } });
    } catch (err) {
      throw fastify.httpErrors.notFound(err instanceof Error ? err.message : 'Alvo não encontrado');
    }
  });

  fastify.post('/virtualization/zerotier/join-targets/:id/provision', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { id } = request.params as { id: string };
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await startZerotierJoinTargetProvision(tenantId, workspaceId, id);
      return reply.code(202).send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badRequest(
        err instanceof Error ? err.message : 'Falha ao iniciar provisioning'
      );
    }
  });

  fastify.get('/virtualization/zerotier/local-host', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    await resolveWorkspaceTenantScope(fastify, request.user, query.workspaceId);
    const data = await getLocalZerotierHostStatus();
    return reply.send({ success: true, data });
  });

  fastify.post('/virtualization/zerotier/local-host/provision', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const body = z
      .object({
        networkRowId: z.string().uuid(),
      })
      .parse(request.body);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await provisionLocalZerotierHost(tenantId, workspaceId, body.networkRowId);
      return reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no provisionamento local';
      const provisionLog =
        err && typeof err === 'object' && 'provisionLog' in err
          ? String((err as { provisionLog: unknown }).provisionLog)
          : undefined;
      return reply.status(502).send({
        success: false,
        error: message,
        data: provisionLog ? { provisionLog } : null,
      });
    }
  });

  fastify.post('/virtualization/zerotier/local-host/ensure-all', async (request, reply) => {
    const query = workspaceQuerySchema.parse(request.query);
    const { tenantId, workspaceId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );
    try {
      const data = await ensureLocalZerotierOnAllWorkspaceNetworks(tenantId, workspaceId);
      return reply.send({ success: true, data });
    } catch (err) {
      throw fastify.httpErrors.badGateway(
        err instanceof Error ? err.message : 'Falha ao sincronizar ZeroTier local'
      );
    }
  });
}
