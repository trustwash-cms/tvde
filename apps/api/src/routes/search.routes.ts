import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Role } from '@tvde/shared';
import { globalSearch, MIN_SEARCH_LENGTH } from '../services/search.service';

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/search', async (request, reply) => {
    const { q } = z.object({ q: z.string().max(100).default('') }).parse(request.query);

    if (q.trim().length < MIN_SEARCH_LENGTH) {
      return reply.send({
        success: true,
        data: { query: q.trim(), results: [] },
        message: `Mínimo ${MIN_SEARCH_LENGTH} caracteres`,
      });
    }

    const data = await globalSearch(
      {
        role: request.user.role as Role,
        tenantId: request.user.tenantId,
        workspaceId: request.user.workspaceId,
      },
      q
    );

    return reply.send({ success: true, data });
  });
}
