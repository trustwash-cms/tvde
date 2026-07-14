import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TENANT_BRANDING_LOGO_MIME_TYPES, TENANT_BRANDING_WALLPAPER_MIME_TYPES } from '@tvde/shared';
import { env } from '../config/env';
import { createAuditLog } from '../services/audit.service';
import {
  deleteTenantLoginWallpaper,
  deleteTenantLogo,
  getTenantBranding,
  getTenantLoginWallpaperDownload,
  getTenantLogoDownload,
  updateTenantLoginLogoScale,
  uploadTenantLoginWallpaper,
  uploadTenantLogo,
} from '../services/tenant-branding.service';

const patchBrandingSchema = z.object({
  loginLogoScale: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export async function tenantBrandingRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: Math.max(env.brandingMaxLogoBytes, env.brandingMaxWallpaperBytes) },
  });

  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/tenant/branding', async (request, reply) => {
    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.status(400).send({ success: false, error: 'Tenant em falta' });
    }
    const data = await getTenantBranding(tenantId);
    return reply.send({ success: true, data });
  });

  fastify.patch(
    '/tenant/branding',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant em falta' });
      }

      const body = patchBrandingSchema.parse(request.body);
      await updateTenantLoginLogoScale(tenantId, body.loginLogoScale);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'tenant.branding_logo_scale_updated',
        entityType: 'tenant_setting',
        entityId: tenantId,
        ipAddress: request.ip,
        afterJson: { loginLogoScale: body.loginLogoScale },
      });

      const data = await getTenantBranding(tenantId);
      return reply.send({ success: true, data, message: 'Branding actualizado' });
    }
  );

  fastify.get('/tenant/branding/logo', async (request, reply) => {
    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.status(400).send({ success: false, error: 'Tenant em falta' });
    }
    const download = await getTenantLogoDownload(tenantId);
    if (!download) {
      return reply.status(404).send({ success: false, error: 'Logotipo não definido' });
    }
    reply.header('Content-Type', download.meta.mimeType);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (download.meta.updatedAt) {
      reply.header('ETag', `"${download.meta.updatedAt}"`);
    }
    return reply.send(download.stream);
  });

  fastify.post('/tenant/branding/logo', { preHandler: [fastify.requireRole('superadmin')] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.status(400).send({ success: false, error: 'Tenant em falta' });
    }

    try {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
      }

      const mimeType = file.mimetype || 'application/octet-stream';
      if (!TENANT_BRANDING_LOGO_MIME_TYPES.includes(mimeType as never)) {
        return reply.status(400).send({
          success: false,
          error: 'Formato inválido — use JPEG, PNG ou WebP',
        });
      }

      const buffer = await file.toBuffer();
      const meta = await uploadTenantLogo(tenantId, {
        fileName: file.filename?.trim() || 'logo.png',
        mimeType,
        buffer,
      });

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'tenant.branding_logo_uploaded',
        entityType: 'tenant_setting',
        entityId: tenantId,
        ipAddress: request.ip,
      });

      return reply.status(201).send({ success: true, data: meta, message: 'Logotipo carregado' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar logotipo';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/tenant/branding/logo', { preHandler: [fastify.requireRole('superadmin')] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.status(400).send({ success: false, error: 'Tenant em falta' });
    }

    await deleteTenantLogo(tenantId);
    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'tenant.branding_logo_deleted',
      entityType: 'tenant_setting',
      entityId: tenantId,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, message: 'Logotipo removido' });
  });

  fastify.get('/tenant/branding/wallpaper', async (request, reply) => {
    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.status(400).send({ success: false, error: 'Tenant em falta' });
    }
    const download = await getTenantLoginWallpaperDownload(tenantId);
    if (!download) {
      return reply.status(404).send({ success: false, error: 'Wallpaper não definido' });
    }
    reply.header('Content-Type', download.meta.mimeType);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (download.meta.updatedAt) {
      reply.header('ETag', `"${download.meta.updatedAt}"`);
    }
    return reply.send(download.stream);
  });

  fastify.post(
    '/tenant/branding/wallpaper',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant em falta' });
      }

      try {
        const file = await request.file();
        if (!file) {
          return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
        }

        const mimeType = file.mimetype || 'application/octet-stream';
        if (!TENANT_BRANDING_WALLPAPER_MIME_TYPES.includes(mimeType as never)) {
          return reply.status(400).send({
            success: false,
            error: 'Formato inválido — use JPEG, PNG ou WebP',
          });
        }

        const buffer = await file.toBuffer();
        const meta = await uploadTenantLoginWallpaper(tenantId, {
          fileName: file.filename?.trim() || 'wallpaper.jpg',
          mimeType,
          buffer,
        });

        await createAuditLog({
          tenantId,
          userId: request.user.sub,
          action: 'tenant.branding_wallpaper_uploaded',
          entityType: 'tenant_setting',
          entityId: tenantId,
          ipAddress: request.ip,
        });

        return reply.status(201).send({ success: true, data: meta, message: 'Wallpaper carregado' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha ao carregar wallpaper';
        return reply.status(400).send({ success: false, error: message });
      }
    }
  );

  fastify.delete(
    '/tenant/branding/wallpaper',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      if (!tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant em falta' });
      }

      await deleteTenantLoginWallpaper(tenantId);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'tenant.branding_wallpaper_deleted',
        entityType: 'tenant_setting',
        entityId: tenantId,
        ipAddress: request.ip,
      });

      return reply.send({ success: true, message: 'Wallpaper removido' });
    }
  );
}
