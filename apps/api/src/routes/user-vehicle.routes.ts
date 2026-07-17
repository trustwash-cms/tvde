import type { FastifyInstance } from 'fastify';
import { VEHICLE_COMMISSION_TYPES, type Role } from '@tvde/shared';
import { z } from 'zod';
import {
  createUserVehicle,
  deleteUserVehicle,
  handleUserVehicleError,
  listUserVehicles,
  updateUserVehicle,
} from '../services/user-vehicle.service';

const vehicleBodySchema = z.object({
  matricula: z.string().min(2),
  matriculaForeign: z.boolean().optional(),
  matriculaCountry: z.string().optional(),
  dataInicio: z.string().min(8),
  dataFim: z.string().nullable().optional(),
  uuidUber: z.string().nullable().optional(),
  uuidBolt: z.string().nullable().optional(),
  numCartaoPrio: z.string().nullable().optional(),
  nomeCompleto: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  ano: z.union([z.string(), z.number()]).nullable().optional(),
  aluguelViatura: z.union([z.string(), z.number()]).nullable().optional(),
  comissaoTipo: z.enum(VEHICLE_COMMISSION_TYPES).nullable().optional(),
  comissaoValor: z.union([z.string(), z.number()]).nullable().optional(),
  comissaoIva6: z.boolean().optional(),
  slotIncluirViaVerde: z.boolean().optional(),
  slotIncluirEletricidadeCombustivel: z.boolean().optional(),
});

function actorContext(request: { user: { sub: string; role: string; tenantId: string | null } }) {
  return {
    actorId: request.user.sub,
    actorRole: request.user.role as Role,
    actorTenantId: request.user.tenantId,
  };
}

export async function userVehicleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/users/:userId/vehicles', {
    preHandler: [fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const data = await listUserVehicles(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId
      );
      return reply.send({ success: true, data });
    } catch (err) {
      const { status, message } = handleUserVehicleError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });

  fastify.post('/users/:userId/vehicles', {
    preHandler: [fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = vehicleBodySchema.parse(request.body);
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const data = await createUserVehicle(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId,
        body,
        request.ip
      );
      return reply.status(201).send({ success: true, data, message: 'Matrícula adicionada' });
    } catch (err) {
      const { status, message, limits } = handleUserVehicleError(err);
      return reply.status(status).send({ success: false, error: message, data: limits });
    }
  });

  fastify.patch('/users/:userId/vehicles/:vehicleId', {
    preHandler: [fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { userId, vehicleId } = request.params as { userId: string; vehicleId: string };
    const body = vehicleBodySchema.parse(request.body);
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      const data = await updateUserVehicle(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId,
        vehicleId,
        body,
        request.ip
      );
      return reply.send({ success: true, data, message: 'Matrícula actualizada' });
    } catch (err) {
      const { status, message, limits } = handleUserVehicleError(err);
      return reply.status(status).send({ success: false, error: message, data: limits });
    }
  });

  fastify.delete('/users/:userId/vehicles/:vehicleId', {
    preHandler: [fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { userId, vehicleId } = request.params as { userId: string; vehicleId: string };
    const { actorId, actorRole, actorTenantId } = actorContext(request);
    try {
      await deleteUserVehicle(
        fastify.db,
        actorId,
        actorRole,
        actorTenantId,
        userId,
        vehicleId,
        request.ip
      );
      return reply.send({ success: true, message: 'Matrícula eliminada' });
    } catch (err) {
      const { status, message } = handleUserVehicleError(err);
      return reply.status(status).send({ success: false, error: message });
    }
  });
}
