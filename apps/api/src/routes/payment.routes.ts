import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defaultPaymentWeekRange, hasMinRole, isDriverRole, WHATSAPP_BUSINESS_EVENT_KEYS, type Role } from '@tvde/shared';
import { env } from '../config/env';
import { createAuditLog } from '../services/audit.service';
import { EmailNotConfiguredError } from '../services/email.service';
import {
  calculateDriverPayment,
  listPaymentDrivers,
} from '../services/payment-calculator.service';
import {
  deletePaymentReportAttachment,
  getPaymentReportAttachmentForDownload,
  listPaymentReportAttachments,
  uploadPaymentReportAttachment,
} from '../services/payment-report-attachment.service';
import { openPaymentReceiptStream } from '../services/payment-report-attachment-storage.service';
import { streamPaymentReportAttachmentsZip } from '../services/payment-report-attachments-zip.service';
import { sendPaymentReportEmail } from '../services/payment-report-email.service';
import { sendPaymentReportIva6Email } from '../services/payment-report-iva6-email.service';
import {
  confirmDriverPayment,
  DEFAULT_PAYMENT_METHODS,
  deletePaymentReport,
  getPaymentReport,
  listPaymentReports,
  recordPaymentReportNotification,
  setPaymentReportPaid,
} from '../services/payment-report.service';
import { dispatchWhatsappBusinessEvent } from '../modules/whatsapp-business/whatsapp-business.notifications.service';

function requireTenant(request: { user: { tenantId: string | null } }) {
  if (!request.user.tenantId) throw new Error('Tenant em falta na sessão');
  return request.user.tenantId;
}

const dateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function paymentRoutes(fastify: FastifyInstance) {
  await fastify.register(import('@fastify/multipart'), {
    limits: { fileSize: env.paymentReceiptsMaxBytes },
  });

  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('pagamentos'));

  fastify.get(
    '/pagamentos/drivers',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const data = await listPaymentDrivers(fastify.db, tenantId);
        return reply.send({ success: true, data });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.get('/pagamentos/default-range', async (_request, reply) => {
    return reply.send({ success: true, data: defaultPaymentWeekRange() });
  });

  fastify.get('/pagamentos/methods', async (_request, reply) => {
    return reply.send({ success: true, data: [...DEFAULT_PAYMENT_METHODS] });
  });

  fastify.get(
    '/pagamentos/reports',
    { preHandler: [fastify.requireRole('admin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const q = z
          .object({
            periodStart: dateYmd.optional(),
            periodEnd: dateYmd.optional(),
            search: z.string().optional(),
            isPaid: z.enum(['true', 'false', '1', '0']).optional(),
            paymentMethod: z.string().max(5).optional(),
            userId: z.string().uuid().optional(),
            page: z.coerce.number().int().positive().optional(),
            perPage: z.coerce.number().int().positive().optional(),
          })
          .parse(request.query);

        let isPaid: boolean | undefined;
        if (q.isPaid === 'true' || q.isPaid === '1') isPaid = true;
        if (q.isPaid === 'false' || q.isPaid === '0') isPaid = false;

        const driverOnly = isDriverRole(request.user.role as Role);
        const includeAdminFields = hasMinRole(request.user.role as Role, 'superadmin');

        const data = await listPaymentReports(fastify.db, tenantId, {
          periodStart: q.periodStart,
          periodEnd: q.periodEnd,
          search: driverOnly ? undefined : q.search,
          isPaid,
          paymentMethod: q.paymentMethod,
          page: q.page,
          perPage: q.perPage,
          userId: driverOnly ? request.user.sub : q.userId,
          includeAdminFields,
        });
        return reply.send({ success: true, data });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.get(
    '/pagamentos/reports/attachments-zip',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const q = z
          .object({
            periodStart: dateYmd,
            periodEnd: dateYmd,
            userId: z.string().uuid().optional(),
            isPaid: z.enum(['true', 'false', '1', '0']).optional(),
            search: z.string().optional(),
            paymentMethod: z.string().max(5).optional(),
          })
          .parse(request.query);

        let isPaid: boolean | undefined;
        if (q.isPaid === 'true' || q.isPaid === '1') isPaid = true;
        if (q.isPaid === 'false' || q.isPaid === '0') isPaid = false;

        const { stream, fileName, fileCount } = await streamPaymentReportAttachmentsZip(
          fastify.db,
          tenantId,
          {
            periodStart: q.periodStart,
            periodEnd: q.periodEnd,
            userId: q.userId,
            isPaid,
            search: q.search,
            paymentMethod: q.paymentMethod,
          }
        );

        await createAuditLog({
          tenantId,
          userId: request.user.sub,
          action: 'payment_report.attachments_zip',
          entityType: 'payment_report',
          entityId: q.userId ?? tenantId,
          ipAddress: request.ip,
          afterJson: {
            periodStart: q.periodStart,
            periodEnd: q.periodEnd,
            userId: q.userId ?? null,
            isPaid: isPaid ?? null,
            fileCount,
          },
        });

        return reply
          .header('Content-Type', 'application/zip')
          .header('Content-Disposition', `attachment; filename="${fileName}"`)
          .send(stream);
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.post(
    '/pagamentos/calculate',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const body = z
          .object({
            userId: z.string().uuid(),
            periodStart: dateYmd.optional(),
            periodEnd: dateYmd.optional(),
            viaVerdeIds: z.array(z.string().uuid()).optional(),
          })
          .parse(request.body);

        const data = await calculateDriverPayment(
          fastify.db,
          tenantId,
          body.userId,
          body.periodStart,
          body.periodEnd,
          { viaVerdeIds: body.viaVerdeIds }
        );
        return reply.send({ success: true, data });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.post(
    '/pagamentos/confirm',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const body = z
          .object({
            userId: z.string().uuid(),
            periodStart: dateYmd.optional(),
            periodEnd: dateYmd.optional(),
            viaVerdeIds: z.array(z.string().uuid()).optional(),
          })
          .parse(request.body);

        const data = await confirmDriverPayment(
          fastify.db,
          tenantId,
          body.userId,
          body.periodStart,
          body.periodEnd,
          {
            viaVerdeIds: body.viaVerdeIds,
            createdByUserId: request.user.sub,
          }
        );

        try {
          const notify = await dispatchWhatsappBusinessEvent(
            tenantId,
            WHATSAPP_BUSINESS_EVENT_KEYS.driverWeeklyPayment,
            body.userId,
            {
              reportId: data.reportId,
              periodStart: data.calculation.periodStart,
              periodEnd: data.calculation.periodEnd,
              resultAmount: Number(data.calculation.resultado),
            }
          );
          await recordPaymentReportNotification(fastify.db, tenantId, data.reportId, notify);
          if (notify.errors.length > 0) {
            request.log.warn(
              { notify, reportId: data.reportId },
              'whatsapp business notification after payment.confirm'
            );
          }
        } catch (notifyErr) {
          request.log.warn(
            { err: notifyErr, reportId: data.reportId },
            'whatsapp business notification failed after payment.confirm'
          );
          await recordPaymentReportNotification(fastify.db, tenantId, data.reportId, {
            emailSent: false,
            whatsappSent: false,
            errors: [notifyErr instanceof Error ? notifyErr.message : 'Falha no envio'],
          });
        }

        return reply.send({ success: true, data });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.get(
    '/pagamentos/reports/:id',
    { preHandler: [fastify.requireRole('admin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const includeAdminFields = hasMinRole(request.user.role as Role, 'superadmin');
        const data = await getPaymentReport(fastify.db, tenantId, id, { includeAdminFields });
        if (isDriverRole(request.user.role as Role) && data.userId !== request.user.sub) {
          return reply.status(404).send({ success: false, error: 'Relatório não encontrado' });
        }
        return reply.send({ success: true, data });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.post(
    '/pagamentos/reports/:id/send-email',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

        const data = await sendPaymentReportEmail(fastify.db, tenantId, id);

        await createAuditLog({
          tenantId,
          userId: request.user.sub,
          action: 'payment_report.send_email',
          entityType: 'payment_report',
          entityId: id,
          ipAddress: request.ip,
          afterJson: {
            lastSentAt: data.lastSentAt,
            to: data.to,
            attachmentsIncluded: data.attachmentsIncluded,
            attachmentsSkipped: data.attachmentsSkipped,
          },
        });

        return reply.send({
          success: true,
          data,
          message: data.attachmentsSkipped
            ? 'Email enviado (alguns comprovativos não foram anexados por tamanho)'
            : 'Email enviado',
        });
      } catch (err) {
        if (err instanceof EmailNotConfiguredError) {
          return reply.status(503).send({ success: false, error: err.message });
        }
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.post(
    '/pagamentos/reports/:id/iva6-email',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z
          .object({
            to: z.string().email(),
            includeCarro: z.boolean().optional(),
            carroBase: z.number().nonnegative().optional(),
          })
          .parse(request.body);

        const data = await sendPaymentReportIva6Email(fastify.db, tenantId, id, body.to, {
          includeCarro: body.includeCarro,
          carroBase: body.carroBase,
        });

        await createAuditLog({
          tenantId,
          userId: request.user.sub,
          action: 'payment_report.send_iva6_email',
          entityType: 'payment_report',
          entityId: id,
          ipAddress: request.ip,
          afterJson: {
            to: data.to,
            sentAt: data.sentAt,
            ivaAmount: data.ivaAmount,
            receitasTotal: data.receitasTotal,
            diferencaAmount: data.diferencaAmount,
            includeCarro: data.includeCarro,
            carroBase: data.carroBase,
            carroAmount: data.carroAmount,
          },
        });

        return reply.send({
          success: true,
          data,
          message: 'Email de IVA enviado e valor gravado',
        });
      } catch (err) {
        if (err instanceof EmailNotConfiguredError) {
          return reply.status(503).send({ success: false, error: err.message });
        }
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.get(
    '/pagamentos/reports/:id/attachments',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const data = await listPaymentReportAttachments(fastify.db, tenantId, id);
        return reply.send({ success: true, data });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.post(
    '/pagamentos/reports/:id/attachments/upload',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

        const file = await request.file();
        if (!file) {
          return reply.status(400).send({ success: false, error: 'Ficheiro em falta' });
        }

        const buffer = await file.toBuffer();
        const fileName = file.filename?.trim() || 'comprovativo';
        const mimeType = file.mimetype || 'application/octet-stream';

        const data = await uploadPaymentReportAttachment(
          fastify.db,
          tenantId,
          id,
          request.user.sub,
          { fileName, mimeType, buffer }
        );

        await createAuditLog({
          tenantId,
          userId: request.user.sub,
          action: 'payment_report.attachment_upload',
          entityType: 'payment_report_attachment',
          entityId: data.id,
          ipAddress: request.ip,
          afterJson: {
            paymentReportId: id,
            fileName: data.fileName,
            sizeBytes: data.sizeBytes,
          },
        });

        return reply.status(201).send({ success: true, data, message: 'Comprovativo carregado' });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.get(
    '/pagamentos/reports/:reportId/attachments/:attachmentId/download',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { reportId, attachmentId } = z
          .object({ reportId: z.string().uuid(), attachmentId: z.string().uuid() })
          .parse(request.params);

        const attachment = await getPaymentReportAttachmentForDownload(
          fastify.db,
          tenantId,
          reportId,
          attachmentId
        );
        const stream = openPaymentReceiptStream(attachment.storageKey);
        const safeName = attachment.fileName.replace(/[^\w.\-() ]+/g, '_');

        return reply
          .header('Content-Type', attachment.mimeType)
          .header('Content-Disposition', `attachment; filename="${safeName}"`)
          .send(stream);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro';
        const status = message.includes('não encontrado') ? 404 : 400;
        return reply.status(status).send({ success: false, error: message });
      }
    }
  );

  fastify.delete(
    '/pagamentos/reports/:reportId/attachments/:attachmentId',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { reportId, attachmentId } = z
          .object({ reportId: z.string().uuid(), attachmentId: z.string().uuid() })
          .parse(request.params);

        const data = await deletePaymentReportAttachment(
          fastify.db,
          tenantId,
          reportId,
          attachmentId
        );

        await createAuditLog({
          tenantId,
          userId: request.user.sub,
          action: 'payment_report.attachment_delete',
          entityType: 'payment_report_attachment',
          entityId: attachmentId,
          ipAddress: request.ip,
          afterJson: { paymentReportId: reportId },
        });

        return reply.send({ success: true, data, message: 'Comprovativo eliminado' });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.patch(
    '/pagamentos/reports/:id/paid',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z
          .object({
            isPaid: z.boolean(),
            paymentMethod: z.string().max(5).optional().nullable(),
          })
          .parse(request.body);

        await setPaymentReportPaid(
          fastify.db,
          tenantId,
          id,
          body.isPaid,
          body.paymentMethod
        );
        return reply.send({ success: true, data: { id, isPaid: body.isPaid } });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.delete(
    '/pagamentos/reports/:id',
    { preHandler: [fastify.requireRole('superadmin')] },
    async (request, reply) => {
      try {
        const tenantId = requireTenant(request);
        const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
        const data = await deletePaymentReport(fastify.db, tenantId, id);
        return reply.send({ success: true, data });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );
}
