import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { env } from '../config/env';
import { createAuditLog } from '../services/audit.service';
import { formatZodError } from '../lib/validation-errors';
import {
  cancelContaCorrenteEntry,
  createContaCorrenteEntry,
  deleteContaCorrenteEntry,
  getContaCorrenteEntryForDownload,
  getContaCorrenteSummary,
  listContaCorrenteDrivers,
  listContaCorrenteEntries,
  reopenContaCorrenteEntry,
  updateContaCorrenteEntry,
} from '../services/driver-current-account.service';
import { openDriverCurrentAccountStream } from '../services/driver-current-account-storage.service';

function requireTenant(request: { user: { tenantId: string | null } }) {
  if (!request.user.tenantId) throw new Error('Tenant em falta na sessão');
  return request.user.tenantId;
}

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const emptyToUndef = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : v;

const multipartCreateSchema = z.object({
  driverUserId: z.string().uuid(),
  description: z.string().min(1).max(4000),
  amount: z.coerce.number().positive(),
  type: z.enum(['credit', 'debit']),
  category: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  reference: z.preprocess(emptyToUndef, z.string().max(255).optional()),
  installmentEnabled: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  totalInstallments: z.preprocess(
    emptyToUndef,
    z.coerce.number().int().positive().optional()
  ),
  installmentAmount: z.preprocess(
    emptyToUndef,
    z.coerce.number().positive().optional()
  ),
});

const jsonCreateSchema = z.object({
  driverUserId: z.string().uuid(),
  description: z.string().min(1).max(4000),
  amount: z.coerce.number().positive(),
  type: z.enum(['credit', 'debit']),
  category: z.string().max(120).optional().nullable(),
  reference: z.string().max(255).optional().nullable(),
  installmentEnabled: z.boolean().optional(),
  totalInstallments: z.number().int().positive().optional().nullable(),
  installmentAmount: z.number().positive().optional().nullable(),
});

const jsonUpdateSchema = z.object({
  description: z.string().min(1).max(4000),
  amount: z.coerce.number().positive().optional(),
  type: z.enum(['credit', 'debit']).optional(),
  category: z.string().max(120).optional().nullable(),
  reference: z.string().max(255).optional().nullable(),
  installmentEnabled: z.boolean().optional(),
  totalInstallments: z.number().int().positive().optional().nullable(),
  installmentAmount: z.number().positive().optional().nullable(),
  removeAttachment: z.boolean().optional(),
});

const multipartUpdateSchema = z.object({
  description: z.string().min(1).max(4000),
  amount: z.preprocess(emptyToUndef, z.coerce.number().positive().optional()),
  type: z.preprocess(emptyToUndef, z.enum(['credit', 'debit']).optional()),
  category: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  reference: z.preprocess(emptyToUndef, z.string().max(255).optional()),
  installmentEnabled: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  totalInstallments: z.preprocess(
    emptyToUndef,
    z.coerce.number().int().positive().optional()
  ),
  installmentAmount: z.preprocess(
    emptyToUndef,
    z.coerce.number().positive().optional()
  ),
  removeAttachment: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});

export async function driverCurrentAccountRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: env.driverCurrentAccountMaxBytes },
  });

  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('pagamentos'));
  fastify.addHook('preHandler', fastify.requireRole('superadmin'));

  fastify.get('/conta-corrente/drivers', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const data = await listContaCorrenteDrivers(fastify.db, tenantId);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/conta-corrente/summary', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const q = z
        .object({ driverUserId: z.string().uuid().optional() })
        .parse(request.query);
      const data = await getContaCorrenteSummary(fastify.db, tenantId, q.driverUserId);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/conta-corrente', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const q = z
        .object({
          driverUserId: z.string().uuid().optional(),
          status: z.enum(['open', 'settled', 'cancelled', 'all']).optional(),
        })
        .parse(request.query);
      const data = await listContaCorrenteEntries(fastify.db, tenantId, {
        driverUserId: q.driverUserId,
        status: q.status,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/conta-corrente', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const contentType = request.headers['content-type'] ?? '';

      let payload: {
        driverUserId: string;
        description: string;
        amount: number;
        type: 'credit' | 'debit';
        category?: string | null;
        reference?: string | null;
        installmentEnabled?: boolean;
        totalInstallments?: number | null;
        installmentAmount?: number | null;
        attachment?: { fileName: string; mimeType: string; buffer: Buffer } | null;
      };

      if (contentType.includes('multipart/form-data')) {
        const parts = request.parts();
        const fields: Record<string, string> = {};
        let attachment: { fileName: string; mimeType: string; buffer: Buffer } | null = null;

        for await (const part of parts) {
          if (part.type === 'file') {
            if (part.fieldname !== 'attachment') continue;
            const buffer = await part.toBuffer();
            if (buffer.length > env.driverCurrentAccountMaxBytes) {
              throw new Error('Ficheiro demasiado grande (máx. 10MB)');
            }
            const mime = part.mimetype || 'application/octet-stream';
            if (!ALLOWED_MIME.has(mime)) {
              throw new Error('Tipo de ficheiro não permitido (PDF, imagens ou documentos)');
            }
            attachment = {
              fileName: part.filename || 'anexo',
              mimeType: mime,
              buffer,
            };
          } else {
            fields[part.fieldname] = String(part.value ?? '');
          }
        }

        const parsed = multipartCreateSchema.parse(fields);
        payload = {
          ...parsed,
          category: parsed.category ?? null,
          reference: parsed.reference ?? null,
          totalInstallments: parsed.totalInstallments ?? null,
          installmentAmount: parsed.installmentAmount ?? null,
          attachment,
        };
      } else {
        const body = jsonCreateSchema.parse(request.body);
        payload = { ...body, attachment: null };
      }

      const data = await createContaCorrenteEntry(fastify.db, tenantId, {
        ...payload,
        createdByUserId: request.user.sub,
      });

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'conta_corrente.create',
        entityType: 'driver_current_account_entry',
        entityId: data.id,
        afterJson: { type: data.type, amount: data.amount, driverUserId: data.driverUserId },
      });

      return reply.status(201).send({ success: true, data });
    } catch (err) {
      const message =
        err instanceof ZodError
          ? formatZodError(err)
          : err instanceof Error
            ? err.message
            : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/conta-corrente/:id/cancel', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const data = await cancelContaCorrenteEntry(fastify.db, tenantId, id);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'conta_corrente.cancel',
        entityType: 'driver_current_account_entry',
        entityId: id,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post('/conta-corrente/:id/reopen', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const data = await reopenContaCorrenteEntry(fastify.db, tenantId, id);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'conta_corrente.reopen',
        entityType: 'driver_current_account_entry',
        entityId: id,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.patch('/conta-corrente/:id', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const contentType = request.headers['content-type'] ?? '';

      let payload: {
        description: string;
        amount?: number;
        type?: 'credit' | 'debit';
        category?: string | null;
        reference?: string | null;
        installmentEnabled?: boolean;
        totalInstallments?: number | null;
        installmentAmount?: number | null;
        attachment?: { fileName: string; mimeType: string; buffer: Buffer } | null;
        removeAttachment?: boolean;
      };

      if (contentType.includes('multipart/form-data')) {
        const parts = request.parts();
        const fields: Record<string, string> = {};
        let attachment: { fileName: string; mimeType: string; buffer: Buffer } | null = null;

        for await (const part of parts) {
          if (part.type === 'file') {
            if (part.fieldname !== 'attachment') continue;
            const buffer = await part.toBuffer();
            if (buffer.length > env.driverCurrentAccountMaxBytes) {
              throw new Error('Ficheiro demasiado grande (máx. 10MB)');
            }
            const mime = part.mimetype || 'application/octet-stream';
            if (!ALLOWED_MIME.has(mime)) {
              throw new Error('Tipo de ficheiro não permitido (PDF, imagens ou documentos)');
            }
            attachment = {
              fileName: part.filename || 'anexo',
              mimeType: mime,
              buffer,
            };
          } else {
            fields[part.fieldname] = String(part.value ?? '');
          }
        }

        const parsed = multipartUpdateSchema.parse(fields);
        payload = {
          description: parsed.description,
          amount: parsed.amount,
          type: parsed.type,
          category: parsed.category ?? null,
          reference: parsed.reference ?? null,
          installmentEnabled: parsed.installmentEnabled,
          totalInstallments: parsed.totalInstallments ?? null,
          installmentAmount: parsed.installmentAmount ?? null,
          removeAttachment: parsed.removeAttachment,
          attachment,
        };
      } else {
        const body = jsonUpdateSchema.parse(request.body);
        payload = { ...body, attachment: null };
      }

      const data = await updateContaCorrenteEntry(fastify.db, tenantId, id, payload);

      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'conta_corrente.update',
        entityType: 'driver_current_account_entry',
        entityId: id,
        afterJson: { type: data.type, amount: data.amount, driverUserId: data.driverUserId },
      });

      return reply.send({ success: true, data });
    } catch (err) {
      const message =
        err instanceof ZodError
          ? formatZodError(err)
          : err instanceof Error
            ? err.message
            : 'Erro';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/conta-corrente/:id', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const data = await deleteContaCorrenteEntry(fastify.db, tenantId, id);
      await createAuditLog({
        tenantId,
        userId: request.user.sub,
        action: 'conta_corrente.delete',
        entityType: 'driver_current_account_entry',
        entityId: id,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/conta-corrente/:id/attachment/download', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const entry = await getContaCorrenteEntryForDownload(fastify.db, tenantId, id);
      const stream = openDriverCurrentAccountStream(entry.attachmentStorageKey!);
      return reply
        .header(
          'Content-Type',
          entry.attachmentMimeType || 'application/octet-stream'
        )
        .header(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(entry.attachmentFileName || 'anexo')}"`
        )
        .send(stream);
    } catch (err) {
      return reply
        .status(404)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });
}
