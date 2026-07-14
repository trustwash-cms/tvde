import type { FastifyInstance } from 'fastify';
import type { JwtPayload } from '@tvde/shared';

export async function resolveWorkspaceTenantScope(
  fastify: FastifyInstance,
  user: JwtPayload,
  workspaceIdInput?: string | null
): Promise<{ workspaceId: string; tenantId: string }> {
  const workspaceId = workspaceIdInput ?? user.workspaceId;
  if (!workspaceId) {
    throw fastify.httpErrors.badRequest('workspaceId obrigatório');
  }

  const workspace = await fastify.db.workspace.findUnique({
    where: { id: workspaceId },
    select: { tenantId: true },
  });

  if (!workspace) {
    throw fastify.httpErrors.notFound('Workspace não encontrado');
  }

  if (user.role !== 'master' && user.tenantId !== workspace.tenantId) {
    throw fastify.httpErrors.forbidden('Sem acesso a este workspace');
  }

  const tenantId = user.tenantId ?? workspace.tenantId;
  return { workspaceId, tenantId };
}
