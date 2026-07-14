import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@tvde/database';

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof prisma;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate('db', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
