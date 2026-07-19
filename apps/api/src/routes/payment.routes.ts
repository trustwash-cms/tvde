import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defaultPaymentWeekRange } from '@tvde/shared';
import {
  calculateDriverPayment,
  listPaymentDrivers,
} from '../services/payment-calculator.service';
import {
  confirmDriverPayment,
  DEFAULT_PAYMENT_METHODS,
  deletePaymentReport,
  getPaymentReport,
  listPaymentReports,
  setPaymentReportPaid,
} from '../services/payment-report.service';

function requireTenant(request: { user: { tenantId: string | null } }) {
  if (!request.user.tenantId) throw new Error('Tenant em falta na sessão');
  return request.user.tenantId;
}

const dateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function paymentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', fastify.requireModule('pagamentos'));

  fastify.get('/pagamentos/drivers', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const data = await listPaymentDrivers(fastify.db, tenantId);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.get('/pagamentos/default-range', async (_request, reply) => {
    return reply.send({ success: true, data: defaultPaymentWeekRange() });
  });

  fastify.get('/pagamentos/methods', async (_request, reply) => {
    return reply.send({ success: true, data: [...DEFAULT_PAYMENT_METHODS] });
  });

  fastify.get('/pagamentos/reports', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const q = z
        .object({
          periodStart: dateYmd.optional(),
          periodEnd: dateYmd.optional(),
          search: z.string().optional(),
          isPaid: z.enum(['true', 'false', '1', '0']).optional(),
          paymentMethod: z.string().max(5).optional(),
          page: z.coerce.number().int().positive().optional(),
          perPage: z.coerce.number().int().positive().optional(),
        })
        .parse(request.query);

      let isPaid: boolean | undefined;
      if (q.isPaid === 'true' || q.isPaid === '1') isPaid = true;
      if (q.isPaid === 'false' || q.isPaid === '0') isPaid = false;

      const data = await listPaymentReports(fastify.db, tenantId, {
        periodStart: q.periodStart,
        periodEnd: q.periodEnd,
        search: q.search,
        isPaid,
        paymentMethod: q.paymentMethod,
        page: q.page,
        perPage: q.perPage,
      });
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.post(
    '/pagamentos/calculate',
    { preHandler: [fastify.requireRole('admin')] },
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
    { preHandler: [fastify.requireRole('admin')] },
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
        return reply.send({ success: true, data });
      } catch (err) {
        return reply
          .status(400)
          .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
      }
    }
  );

  fastify.get('/pagamentos/reports/:id', async (request, reply) => {
    try {
      const tenantId = requireTenant(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const data = await getPaymentReport(fastify.db, tenantId, id);
      return reply.send({ success: true, data });
    } catch (err) {
      return reply
        .status(400)
        .send({ success: false, error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  fastify.patch(
    '/pagamentos/reports/:id/paid',
    { preHandler: [fastify.requireRole('admin')] },
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
    { preHandler: [fastify.requireRole('admin')] },
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
