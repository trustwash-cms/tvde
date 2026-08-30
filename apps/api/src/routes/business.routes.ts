import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  WHATSAPP_BUSINESS_EVENT_KEYS,
  canAssignRole,
  canManageUser,
  canToggleUserStatus,
  filterTvdeModules,
  formatWhatsappPhone,
  getRoleLabel,
  isDriverRole,
  isValidUsername,
  normalizeUsername,
  roleRequiresPhone,
  type Role,
} from '@tvde/shared';
import { UserRole, Prisma } from '@tvde/database';
import { computeTempPasswordExpiresAt, generateSecurePasswordWithHibp, hashPassword, validatePasswordWithHibp } from '../lib/password';
import { createAuditLog } from '../services/audit.service';
import { parseSearchQuery, textOr } from '../services/search.service';
import { platformWhatsappTenantExcludeWhere } from '../lib/whatsapp-tenant';
import { resolveWorkspaceTenantScope } from '../lib/workspace-scope';
import { getModulesHealth } from '../services/module-health.service';
import {
  sendUserDeleteConfirmationCode,
  verifyUserDeleteConfirmationCode,
} from '../services/action-confirmation.service';
import { EmailNotConfiguredError } from '../services/email.service';
import { dispatchWhatsappBusinessEvent } from '../modules/whatsapp-business/whatsapp-business.notifications.service';
import { ensureDefaultPersonalCalendar } from '../services/calendar/calendar.service';
import {
  resendUserCredentials,
  resetUserPasswordByAdmin,
  UserCredentialsError,
} from '../services/user-credentials.service';

function tenantScope(user: { role: string; tenantId: string | null }) {
  return user.role === 'master' ? {} : { tenantId: user.tenantId! };
}

export async function moduleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/modules', async (request, reply) => {
    const modules = filterTvdeModules(
      await fastify.db.moduleRegistry.findMany({
        orderBy: [{ isCore: 'desc' }, { name: 'asc' }],
      })
    );

    if (request.user.role === 'master' || !request.user.tenantId) {
      return reply.send({ success: true, data: modules });
    }

    const allowed = await fastify.db.tenantModule.findMany({
      where: { tenantId: request.user.tenantId, allowed: true },
      select: { moduleKey: true },
    });
    const allowedKeys = new Set(allowed.map((a) => a.moduleKey));

    const filtered = modules.filter((m) => m.isCore || allowedKeys.has(m.key));
    return reply.send({ success: true, data: filtered });
  });

  fastify.get('/modules/health', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    let workspaceId = query.workspaceId ?? request.user.workspaceId;

    if (workspaceId && request.user.role !== 'master') {
      const ws = await fastify.db.workspace.findFirst({
        where: { id: workspaceId, tenantId: request.user.tenantId! },
      });
      if (!ws) workspaceId = request.user.workspaceId;
    }

    const health = await getModulesHealth(
      request.user.role as Role,
      request.user.tenantId,
      workspaceId
    );

    return reply.send({ success: true, data: health });
  });
}

export async function clientRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/clients/hierarchy', {
    preHandler: [fastify.requireRole('admin')],
  }, async (request, reply) => {
    const q = parseSearchQuery((request.query as { q?: string }).q);
    const userSelect = {
      id: true,
      email: true,
      role: true,
      status: true,
      lastLoginAt: true,
      workspaceId: true,
    } as const;

    if (request.user.role === 'master') {
      const tenantWhere = q
        ? {
            OR: [
              ...textOr(q, ['name', 'siteId']).OR,
              { users: { some: { email: { contains: q, mode: 'insensitive' as const } } } },
            ],
          }
        : undefined;

      const tenants = await fastify.db.tenant.findMany({
        where: tenantWhere
          ? { AND: [platformWhatsappTenantExcludeWhere, tenantWhere] }
          : platformWhatsappTenantExcludeWhere,
        include: {
          users: { select: userSelect, orderBy: [{ role: 'asc' }, { email: 'asc' }] },
          _count: { select: { workspaces: true } },
        },
        orderBy: { name: 'asc' },
      });

      const data = tenants.map((tenant) => {
        const qLower = q?.toLowerCase() ?? '';
        const tenantNameMatch =
          !q ||
          tenant.name.toLowerCase().includes(qLower) ||
          tenant.siteId.toLowerCase().includes(qLower);

        let tenantUsers = tenant.users;
        if (q && !tenantNameMatch) {
          const superadmin = tenant.users.find((u) => u.role === 'superadmin');
          tenantUsers = tenant.users.filter(
            (u) =>
              u.id === superadmin?.id ||
              u.email.toLowerCase().includes(qLower)
          );
        }

        const superadmin = tenantUsers.find((u) => u.role === 'superadmin') ?? null;
        const admins = tenantUsers.filter((u) => u.role === 'admin');
        const staff = tenantUsers.filter((u) => u.role === 'staff');
        return {
          tenant: {
            id: tenant.id,
            siteId: tenant.siteId,
            name: tenant.name,
            plan: tenant.plan,
            status: tenant.status,
            workspaceCount: tenant._count.workspaces,
          },
          superadmin,
          admins,
          staff,
        };
      });

      return reply.send({ success: true, data: { view: 'master', tenants: data } });
    }

    const tenantId = request.user.tenantId;
    if (!tenantId) {
      return reply.status(400).send({ success: false, error: 'Sem tenant associado' });
    }

    if (request.user.role === 'superadmin') {
      return reply.status(403).send({
        success: false,
        error: 'Superadmin gere utilizadores em Utilizadores — Clientes CRM é para staff',
      });
    }

    const users = await fastify.db.user.findMany({
      where: {
        tenantId,
        ...(q ? { email: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      select: userSelect,
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
    });

    return reply.send({
      success: true,
      data: {
        view: 'admin',
        staff: users.filter((u) => u.role === 'staff'),
      },
    });
  });

  fastify.addHook('preHandler', fastify.requireModule('clients'));

  fastify.get('/clients', async (request, reply) => {
    const q = parseSearchQuery((request.query as { q?: string }).q);
    const query = request.query as { workspaceId?: string };
    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      query.workspaceId
    );

    const clients = await fastify.db.client.findMany({
      where: {
        workspaceId,
        tenantId,
        ...(q ? textOr(q, ['name', 'email', 'phone', 'nif']) : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ success: true, data: clients });
  });

  fastify.post('/clients', async (request, reply) => {
    const body = z.object({
      workspaceId: z.string().uuid().optional(),
      name: z.string().min(2),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      nif: z.string().optional(),
      addressJson: z.record(z.unknown()).optional(),
    }).parse(request.body);

    const { workspaceId, tenantId } = await resolveWorkspaceTenantScope(
      fastify,
      request.user,
      body.workspaceId
    );

    const client = await fastify.db.client.create({
      data: {
        tenantId,
        workspaceId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        nif: body.nif,
        addressJson: (body.addressJson ?? {}) as Prisma.InputJsonValue,
      },
    });

    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'client.create',
      entityType: 'client',
      entityId: client.id,
      afterJson: client,
      ipAddress: request.ip,
    });

    return reply.status(201).send({ success: true, data: client });
  });

  fastify.patch('/clients/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      nif: z.string().nullable().optional(),
      status: z.enum(['active', 'inactive']).optional(),
    }).parse(request.body);

    const existing = await fastify.db.client.findFirst({
      where: { id, ...tenantScope(request.user) },
    });
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Cliente não encontrado' });
    }

    const updated = await fastify.db.client.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.nif !== undefined && { nif: body.nif }),
        ...(body.status !== undefined && { status: body.status }),
      },
    });

    await createAuditLog({
      tenantId: existing.tenantId,
      userId: request.user.sub,
      action: 'client.update',
      entityType: 'client',
      entityId: id,
      beforeJson: existing,
      afterJson: updated,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: updated });
  });

  fastify.delete('/clients/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await fastify.db.client.findFirst({
      where: { id, ...tenantScope(request.user) },
    });
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Cliente não encontrado' });
    }

    const invoiceCount = await fastify.db.invoice.count({ where: { clientId: id } });
    if (invoiceCount > 0) {
      return reply.status(409).send({
        success: false,
        error: 'Cliente com faturas associadas — desactive em vez de eliminar',
      });
    }

    await fastify.db.client.delete({ where: { id } });

    await createAuditLog({
      tenantId: existing.tenantId,
      userId: request.user.sub,
      action: 'client.delete',
      entityType: 'client',
      entityId: id,
      beforeJson: existing,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, message: 'Cliente eliminado' });
  });
}

export async function userRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/users', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const query = request.query as { q?: string; tenantId?: string };
    const q = parseSearchQuery(query.q);
    const tenantFilter = query.tenantId;

    const baseWhere =
      request.user.role === 'master'
        ? {
            role: { not: 'master' as const },
            ...(tenantFilter ? { tenantId: tenantFilter } : {}),
          }
        : { tenantId: request.user.tenantId! };

    const users = await fastify.db.user.findMany({
      where: q ? { AND: [baseWhere, textOr(q, ['email', 'username', 'fullName'])] } : baseWhere,
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        phone: true,
        role: true,
        status: true,
        lastLoginAt: true,
        mustChangePassword: true,
        tempPasswordExpiresAt: true,
        createdAt: true,
        workspaceId: true,
        tenant: { select: { id: true, siteId: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const actorRole = request.user.role as UserRole;
    const visible = users.filter((u) => canManageUser(actorRole, u.role));

    return reply.send({ success: true, data: visible });
  });

  fastify.post('/users', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const body = z
      .object({
        username: z.string().min(2),
        email: z.string().email(),
        password: z.string().optional(),
        role: z.enum(['superadmin', 'admin', 'staff']),
        status: z.enum(['active', 'pending', 'suspended']).default('pending'),
        phone: z.string().optional(),
        fullName: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        workspaceId: z.string().uuid().optional(),
      })
      .parse(request.body);

    const username = normalizeUsername(body.username);
    if (!isValidUsername(username)) {
      return reply.status(400).send({
        success: false,
        error: 'Username inválido — apenas letras e pontos (ex.: joao.silva). Números não são permitidos.',
      });
    }

    if (roleRequiresPhone(body.role)) {
      const phone = body.phone?.trim();
      if (!phone) {
        return reply.status(400).send({
          success: false,
          error: 'Telefone é obrigatório para Gestor de Frota e Motorista (WhatsApp).',
        });
      }
    }

    if (!canAssignRole(request.user.role, body.role)) {
      return reply.status(403).send({
        success: false,
        error: 'Não pode criar utilizadores com esta role',
      });
    }

    let plainPassword = body.password?.trim() ?? '';
    const autoGenerated = !plainPassword;
    if (autoGenerated) {
      plainPassword = await generateSecurePasswordWithHibp();
    } else {
      const pwdCheck = await validatePasswordWithHibp(plainPassword);
      if (!pwdCheck.valid) {
        return reply.status(400).send({ success: false, error: pwdCheck.errors.join('; ') });
      }
    }

    let tenantId: string;
    let workspaceId: string | null = body.workspaceId ?? null;

    if (request.user.role === 'master') {
      if (!body.tenantId) {
        return reply.status(400).send({
          success: false,
          error: 'Seleccione o tenant (cliente) para o novo utilizador',
        });
      }
      const tenant = await fastify.db.tenant.findUnique({ where: { id: body.tenantId } });
      if (!tenant) {
        return reply.status(404).send({ success: false, error: 'Tenant não encontrado' });
      }
      tenantId = tenant.id;

      if (workspaceId) {
        const ws = await fastify.db.workspace.findFirst({
          where: { id: workspaceId, tenantId },
        });
        if (!ws) {
          return reply.status(400).send({
            success: false,
            error: 'Workspace inválido para este tenant',
          });
        }
      } else {
        const defaultWorkspace = await fastify.db.workspace.findFirst({
          where: { tenantId },
          orderBy: { createdAt: 'asc' },
        });
        if (!defaultWorkspace) {
          return reply.status(400).send({
            success: false,
            error: 'Este tenant não tem workspace — crie um em Workspaces',
          });
        }
        workspaceId = defaultWorkspace.id;
      }
    } else {
      if (!request.user.tenantId) {
        return reply.status(400).send({ success: false, error: 'Tenant não definido' });
      }
      tenantId = request.user.tenantId;
      workspaceId = body.workspaceId ?? request.user.workspaceId;
    }

    const existing = await fastify.db.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) {
      return reply.status(409).send({ success: false, error: 'Email já registado' });
    }

    const existingUsername = await fastify.db.user.findUnique({ where: { username } });
    if (existingUsername) {
      return reply.status(409).send({ success: false, error: 'Username já registado' });
    }

    const normalizedPhone = body.phone?.trim() ? formatWhatsappPhone(body.phone.trim()) : null;
    const fullName = body.fullName?.trim() || null;
    const tempExpiresAt = autoGenerated ? computeTempPasswordExpiresAt() : null;
    // Password auto: conta PENDING até ao 1º login + alteração de password.
    const initialStatus = autoGenerated ? 'pending' : body.status;

    const user = await fastify.db.user.create({
      data: {
        username,
        email: body.email.toLowerCase(),
        fullName,
        phone: normalizedPhone,
        passwordHash: await hashPassword(plainPassword),
        role: body.role as UserRole,
        status: initialStatus,
        tenantId,
        workspaceId,
        mustChangePassword: autoGenerated,
        tempPasswordExpiresAt: tempExpiresAt,
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        status: true,
        mustChangePassword: true,
        workspaceId: true,
        tenant: { select: { id: true, siteId: true, name: true } },
        createdAt: true,
      },
    });

    // Motorista: private default calendar (they cannot access Configurações → Calendário).
    if (isDriverRole(body.role as Role) && user.workspaceId) {
      try {
        await ensureDefaultPersonalCalendar(user.id, tenantId, user.workspaceId, {
          name: fullName || undefined,
        });
      } catch {
        // User creation must succeed even if calendar bootstrap fails;
        // GET /calendar/calendars will retry via ensureDefaultForDriver.
      }
    }

    let credentialsSent = false;
    if (autoGenerated || isDriverRole(body.role as Role) || body.role === 'superadmin') {
      const eventKey = isDriverRole(body.role as Role)
        ? WHATSAPP_BUSINESS_EVENT_KEYS.userAccountDriver
        : body.role === 'superadmin'
          ? WHATSAPP_BUSINESS_EVENT_KEYS.userAccountManager
          : null;

      if (eventKey && tenantId) {
        try {
          const notify = await dispatchWhatsappBusinessEvent(tenantId, eventKey, user.id, {
            temporaryPassword: autoGenerated ? plainPassword : undefined,
            roleLabel: getRoleLabel(body.role as Role),
          });
          credentialsSent = notify.emailSent || notify.whatsappSent;
          if (notify.errors.length > 0) {
            request.log.warn(
              { notify, userId: user.id },
              'whatsapp business notification after user.create'
            );
          }
        } catch (err) {
          if (err instanceof EmailNotConfiguredError && autoGenerated) {
            return reply.status(400).send({
              success: false,
              error:
                'Utilizador criado mas SMTP não configurado — configure email e reenvie credenciais',
            });
          }
          request.log.warn(
            { err, userId: user.id },
            'whatsapp business notification failed after user.create'
          );
        }
      }
    }

    await createAuditLog({
      tenantId,
      userId: request.user.sub,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      afterJson: user,
      ipAddress: request.ip,
    });

    return reply.status(201).send({
      success: true,
      data: { ...user, credentialsSent: autoGenerated ? credentialsSent : false },
    });
  });

  fastify.patch('/users/:id', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        username: z.string().min(2),
        email: z.string().email(),
        role: z.enum(['superadmin', 'admin', 'staff']),
        status: z.enum(['active', 'pending', 'suspended']).optional(),
        phone: z.string().optional(),
        fullName: z.string().optional(),
      })
      .parse(request.body);

    if (id === request.user.sub) {
      return reply.status(400).send({ success: false, error: 'Não pode editar a sua própria conta aqui' });
    }

    const existing = await fastify.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        tenantId: true,
      },
    });

    if (!existing || existing.role === 'master') {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    if (request.user.role !== 'master' && existing.tenantId !== request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    const actorRole = request.user.role as UserRole;
    if (!canManageUser(actorRole, existing.role)) {
      return reply.status(403).send({ success: false, error: 'Não tem permissão para editar este utilizador' });
    }

    if (!canAssignRole(request.user.role, body.role)) {
      return reply.status(403).send({ success: false, error: 'Não pode atribuir esta role' });
    }

    const username = normalizeUsername(body.username);
    if (!isValidUsername(username)) {
      return reply.status(400).send({
        success: false,
        error: 'Username inválido — apenas letras e pontos (ex.: joao.silva). Números não são permitidos.',
      });
    }

    if (roleRequiresPhone(body.role)) {
      const phone = body.phone?.trim();
      if (!phone) {
        return reply.status(400).send({
          success: false,
          error: 'Telefone é obrigatório para Gestor de Frota e Motorista (WhatsApp).',
        });
      }
    }

    const email = body.email.toLowerCase();
    if (email !== existing.email) {
      const emailTaken = await fastify.db.user.findUnique({ where: { email } });
      if (emailTaken) {
        return reply.status(409).send({ success: false, error: 'Email já registado' });
      }
    }

    if (username !== existing.username) {
      const usernameTaken = await fastify.db.user.findUnique({ where: { username } });
      if (usernameTaken) {
        return reply.status(409).send({ success: false, error: 'Username já registado' });
      }
    }

    const normalizedPhone = body.phone?.trim() ? formatWhatsappPhone(body.phone.trim()) : null;
    const fullName = body.fullName?.trim() || null;
    const nextStatus = canToggleUserStatus(request.user.role as Role)
      ? (body.status ?? existing.status)
      : existing.status;

    const updated = await fastify.db.user.update({
      where: { id },
      data: {
        username,
        email,
        fullName,
        phone: normalizedPhone,
        role: body.role as UserRole,
        status: nextStatus,
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        status: true,
        workspaceId: true,
        tenant: { select: { id: true, siteId: true, name: true } },
        lastLoginAt: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      tenantId: existing.tenantId,
      userId: request.user.sub,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      beforeJson: existing,
      afterJson: updated,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: updated });
  });

  fastify.patch('/users/:id/status', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      status: z.enum(['active', 'suspended']),
    }).parse(request.body);

    if (id === request.user.sub) {
      return reply.status(400).send({ success: false, error: 'Não pode alterar o seu próprio estado' });
    }

    if (!canToggleUserStatus(request.user.role as Role)) {
      return reply.status(403).send({ success: false, error: 'Sem permissão para activar/desactivar utilizadores' });
    }

    const existing = await fastify.db.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true, tenantId: true },
    });

    if (!existing || existing.role === 'master') {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    if (request.user.role !== 'master' && existing.tenantId !== request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    if (!canManageUser(request.user.role as UserRole, existing.role)) {
      return reply.status(403).send({ success: false, error: 'Não tem permissão para alterar este utilizador' });
    }

    if (existing.status === 'pending') {
      return reply.status(400).send({
        success: false,
        error:
          'Conta PENDING — a activação ocorre no 1º login do utilizador. Use «Reenviar credenciais» se necessário.',
      });
    }

    const updated = await fastify.db.user.update({
      where: { id },
      data: { status: body.status },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        status: true,
        mustChangePassword: true,
        workspaceId: true,
        tenant: { select: { id: true, siteId: true, name: true } },
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (body.status === 'suspended') {
      await fastify.db.session.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false },
      });
    }

    await createAuditLog({
      tenantId: existing.tenantId,
      userId: request.user.sub,
      action: body.status === 'active' ? 'user.activate' : 'user.deactivate',
      entityType: 'user',
      entityId: id,
      beforeJson: { status: existing.status },
      afterJson: { status: body.status },
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: updated });
  });

  fastify.post('/users/:id/resend-credentials', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (id === request.user.sub) {
      return reply.status(400).send({ success: false, error: 'Não pode reenviar credenciais para si próprio' });
    }

    const existing = await fastify.db.user.findUnique({
      where: { id },
      select: { id: true, role: true, tenantId: true },
    });
    if (!existing || existing.role === 'master') {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }
    if (request.user.role !== 'master' && existing.tenantId !== request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }
    if (!canManageUser(request.user.role as UserRole, existing.role)) {
      return reply.status(403).send({ success: false, error: 'Sem permissão para este utilizador' });
    }

    try {
      const data = await resendUserCredentials({
        userId: id,
        actorUserId: request.user.sub,
        ipAddress: request.ip,
      });
      return reply.send({
        success: true,
        data,
        message: data.emailSent
          ? 'Credenciais reenviadas por email'
          : 'Credenciais reenviadas (WhatsApp)',
      });
    } catch (err) {
      if (err instanceof UserCredentialsError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      const message = err instanceof Error ? err.message : 'Falha ao reenviar credenciais';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/users/:id/reset-password', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (id === request.user.sub) {
      return reply.status(400).send({ success: false, error: 'Não pode resetar a sua própria password aqui' });
    }

    const existing = await fastify.db.user.findUnique({
      where: { id },
      select: { id: true, role: true, tenantId: true },
    });
    if (!existing || existing.role === 'master') {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }
    if (request.user.role !== 'master' && existing.tenantId !== request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }
    if (!canManageUser(request.user.role as UserRole, existing.role)) {
      return reply.status(403).send({ success: false, error: 'Sem permissão para este utilizador' });
    }

    try {
      const data = await resetUserPasswordByAdmin({
        userId: id,
        actorUserId: request.user.sub,
        ipAddress: request.ip,
      });
      return reply.send({
        success: true,
        data,
        message: 'Nova password temporária enviada ao utilizador',
      });
    } catch (err) {
      if (err instanceof UserCredentialsError) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      const message = err instanceof Error ? err.message : 'Falha ao resetar password';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.post('/users/:id/delete-confirmation', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (id === request.user.sub) {
      return reply.status(400).send({ success: false, error: 'Não pode eliminar a sua própria conta' });
    }

    const existing = await fastify.db.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, role: true, tenantId: true },
    });

    if (!existing || existing.role === 'master') {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    if (request.user.role !== 'master' && existing.tenantId !== request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    if (!canManageUser(request.user.role as UserRole, existing.role)) {
      return reply.status(403).send({ success: false, error: 'Não tem permissão para eliminar este utilizador' });
    }

    try {
      const result = await sendUserDeleteConfirmationCode({
        actorUserId: request.user.sub,
        actorRole: request.user.role as Role,
        actorTenantId: request.user.tenantId,
        targetUser: existing,
      });
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Envio falhou';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  fastify.delete('/users/:id', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      confirmationCode: z.string().min(6).max(6),
    }).parse(request.body ?? {});

    if (id === request.user.sub) {
      return reply.status(400).send({
        success: false,
        error: 'Não pode eliminar a sua própria conta',
      });
    }

    const existing = await fastify.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        workspaceId: true,
        status: true,
        createdAt: true,
      },
    });

    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    if (existing.role === 'master') {
      return reply.status(403).send({ success: false, error: 'Não pode eliminar utilizadores MASTER' });
    }

    if (request.user.role !== 'master' && existing.tenantId !== request.user.tenantId) {
      return reply.status(404).send({ success: false, error: 'Utilizador não encontrado' });
    }

    const actorRole = request.user.role as UserRole;
    if (!canManageUser(actorRole, existing.role)) {
      return reply.status(403).send({
        success: false,
        error: 'Não tem permissão para eliminar este utilizador',
      });
    }

    try {
      await verifyUserDeleteConfirmationCode(request.user.sub, id, body.confirmationCode.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Código inválido';
      return reply.status(400).send({ success: false, error: message });
    }

    await fastify.db.user.delete({ where: { id } });

    await createAuditLog({
      tenantId: existing.tenantId,
      userId: request.user.sub,
      action: 'user.delete',
      entityType: 'user',
      entityId: id,
      beforeJson: existing,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, message: 'Utilizador eliminado' });
  });
}

export async function auditRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/audit-logs', {
    preHandler: [fastify.requireRole('superadmin')],
  }, async (request, reply) => {
    const where = request.user.role === 'master'
      ? {}
      : { tenantId: request.user.tenantId! };

    const logs = await fastify.db.auditLog.findMany({
      where,
      take: 100,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true } } },
    });
    return reply.send({ success: true, data: logs });
  });
}
