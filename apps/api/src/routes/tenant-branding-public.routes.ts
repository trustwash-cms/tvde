import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getTenantBrandingBySiteId,
  getTenantLoginWallpaperDownloadBySiteId,
  getTenantLogoDownloadBySiteId,
} from '../services/tenant-branding.service';

const siteIdQuery = z.object({
  siteId: z.string().trim().min(1).max(64),
});

export async function tenantBrandingPublicRoutes(fastify: FastifyInstance) {
  fastify.get('/public/tenant-branding', async (request, reply) => {
    const { siteId } = siteIdQuery.parse(request.query);
    const data = await getTenantBrandingBySiteId(siteId);
    if (!data) {
      return reply.status(404).send({ success: false, error: 'Site ID não encontrado' });
    }
    reply.header('Cache-Control', 'no-store');
    return reply.send({ success: true, data });
  });

  fastify.get('/public/tenant-branding/logo', async (request, reply) => {
    const { siteId } = siteIdQuery.parse(request.query);
    const download = await getTenantLogoDownloadBySiteId(siteId);
    if (!download) {
      return reply.status(404).send({ success: false, error: 'Logotipo não definido' });
    }
    reply.header('Content-Type', download.meta.mimeType);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    if (download.meta.updatedAt) {
      reply.header('ETag', `"${download.meta.updatedAt}"`);
    }
    return reply.send(download.stream);
  });

  fastify.get('/public/tenant-branding/wallpaper', async (request, reply) => {
    const { siteId } = siteIdQuery.parse(request.query);
    const download = await getTenantLoginWallpaperDownloadBySiteId(siteId);
    if (!download) {
      return reply.status(404).send({ success: false, error: 'Wallpaper não definido' });
    }
    reply.header('Content-Type', download.meta.mimeType);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    if (download.meta.updatedAt) {
      reply.header('ETag', `"${download.meta.updatedAt}"`);
    }
    return reply.send(download.stream);
  });
}
