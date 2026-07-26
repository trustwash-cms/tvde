import type { FastifyInstance } from 'fastify';
import {
  USER_DOCUMENT_TYPES,
  USER_DOCUMENT_VISIBILITIES,
  type Role,
} from '@tvde/shared';
import { z } from 'zod';
import { env } from '../config/env';
import {
  deleteUserDocument,
  getUserDocumentForDownload,
  getUserProfileDetail,
  handleUserProfileError,
  updateUserProfile,
  uploadUserDocument,
} from '../services/user-profile.service';
import { openUserDocumentStream } from '../services/user-document-storage.service';
import {
  deleteUserAvatar,
  getUserAvatarDownload,
  uploadUserAvatar,
} from '../services/user-avatar.service';

const profileBodySchema = z.object({
  fullName: z.string().optional(),
  nif: z.string().optional(),
  ccAutorizacaoResidencia: z.string().optional(),
  numeroOperadorTvde: z.string().optional(),
  distrito: z.string().optional(),
  concelho: z.string().optional(),
  localidade: z.string().optional(),
  arruamento: z.string().optional(),
  numeroPorta: z.string().optional(),
  codigoPostal: z.string().optional(),
});

function actorContext(request: { user: { sub: string; role: string; tenantId: string | null } }) {
  return {
    actorId: request.user.sub,
    actorRole: request.user.role as Role,
    actorTenantId: request.user.tenantId,
  };
}

export async function userProfileRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: env.userDocumentsMaxBytes },
  });

  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/users/me/profile', async (request, reply) => {
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const data = await getUserProfileDetail(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        actorId
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.patch('/users/me/profile', async (request, reply) => {
    const body = profileBodySchema.parse(request.body);
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const data = await updateUserProfile(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        actorId,
        body,
        request.ip
      );
      return reply.send({ success: true, data, message: 'Perfil actualizado' });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/users/me/avatar', async (request, reply) => {
    const download = await getUserAvatarDownload(fastify.db, request.user.sub);
    if (!download) {
      return reply.status(404).send({ success: false, error: 'Sem foto de perfil' });
    }
    reply.header('Content-Type', download.mimeType);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(download.stream);
  });

  fastify.post('/users/me/avatar', async (request, reply) => {
    try {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
      }
      const buffer = await file.toBuffer();
      const mimeType = (file.mimetype || 'application/octet-stream').toLowerCase();
      const data = await uploadUserAvatar(fastify.db, request.user.sub, buffer, mimeType);
      return reply.send({ success: true, data, message: 'Foto actualizada' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no upload';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/users/me/avatar', async (request, reply) => {
    try {
      await deleteUserAvatar(fastify.db, request.user.sub);
      return reply.send({ success: true, message: 'Foto removida' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao remover foto';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/users/me/documents/upload', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
      }

      const fields = file.fields as Record<string, { value?: string } | undefined>;
      const documentTypeRaw = fields.documentType?.value ?? fields.document_type?.value;
      const visibilityRaw = fields.visibility?.value ?? 'private';

      const documentType = z.enum(USER_DOCUMENT_TYPES).parse(documentTypeRaw);
      const visibility = z.enum(USER_DOCUMENT_VISIBILITIES).parse(
        visibilityRaw === '1' || visibilityRaw === 'true' ? 'public' : visibilityRaw
      );

      const buffer = await file.toBuffer();
      const fileName = file.filename?.trim() || 'documento';
      const mimeType = (file.mimetype || 'application/octet-stream').toLowerCase();

      const data = await uploadUserDocument(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        actorId,
        { fileName, mimeType, buffer, documentType, visibility },
        request.ip
      );

      return reply.status(201).send({ success: true, data, message: 'Documento carregado' });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/users/me/documents/:docId/download', async (request, reply) => {
    const { docId } = request.params as { docId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);

    try {
      const doc = await getUserDocumentForDownload(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        actorId,
        docId
      );
      const stream = openUserDocumentStream(doc.storageKey);
      const safeName = doc.fileName.replace(/[^\w.\-() ]+/g, '_');

      return reply
        .header('Content-Type', doc.mimeType)
        .header('Content-Disposition', `attachment; filename="${safeName}"`)
        .send(stream);
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.delete('/users/me/documents/:docId', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { docId } = request.params as { docId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);

    try {
      await deleteUserDocument(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        actorId,
        docId,
        request.ip
      );
      return reply.send({ success: true, message: 'Documento eliminado' });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/users/:userId/profile', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const data = await getUserProfileDetail(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.patch('/users/:userId/profile', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = profileBodySchema.parse(request.body);
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const data = await updateUserProfile(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId,
        body,
        request.ip
      );
      return reply.send({ success: true, data, message: 'Detalhes actualizados' });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/users/:userId/documents', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const data = await getUserProfileDetail(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId
      );
      return reply.send({ success: true, data: data.documents });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.post('/users/:userId/documents/upload', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);

    try {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
      }

      const fields = file.fields as Record<string, { value?: string } | undefined>;
      const documentTypeRaw = fields.documentType?.value ?? fields.document_type?.value;
      const visibilityRaw = fields.visibility?.value ?? fields.is_public?.value ?? 'private';

      const documentType = z.enum(USER_DOCUMENT_TYPES).parse(documentTypeRaw);
      const visibility = z.enum(USER_DOCUMENT_VISIBILITIES).parse(
        visibilityRaw === '1' || visibilityRaw === 'true' ? 'public' : visibilityRaw
      );

      const buffer = await file.toBuffer();
      const fileName = file.filename?.trim() || 'documento';
      const mimeType = (file.mimetype || 'application/octet-stream').toLowerCase();

      const data = await uploadUserDocument(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId,
        { fileName, mimeType, buffer, documentType, visibility },
        request.ip
      );

      return reply.status(201).send({ success: true, data, message: 'Documento carregado' });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.get('/users/:userId/documents/:docId/download', async (request, reply) => {
    const { userId, docId } = request.params as { userId: string; docId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);

    try {
      const doc = await getUserDocumentForDownload(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId,
        docId
      );
      const stream = openUserDocumentStream(doc.storageKey);
      const safeName = doc.fileName.replace(/[^\w.\-() ]+/g, '_');

      return reply
        .header('Content-Type', doc.mimeType)
        .header('Content-Disposition', `attachment; filename="${safeName}"`)
        .send(stream);
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.delete('/users/:userId/documents/:docId', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { userId, docId } = request.params as { userId: string; docId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);

    try {
      await deleteUserDocument(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId,
        docId,
        request.ip
      );
      return reply.send({ success: true, message: 'Documento eliminado' });
    } catch (err) {
      const { status, message } = handleUserProfileError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });
}
