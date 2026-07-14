import { prisma } from '@tvde/database';
import {
  computeTempPasswordExpiresAt,
  generateSecurePasswordWithHibp,
  hashPassword,
} from '../lib/password';
import { EmailNotConfiguredError, sendTenantWelcomeEmail } from './email.service';
import { createAuditLog } from './audit.service';
export async function findProvisionedSuperadmin(tenantId: string) {
  return prisma.user.findFirst({
    where: {
      tenantId,
      role: 'superadmin',
      mustChangePassword: true,
    },
    select: {
      id: true,
      email: true,
      mustChangePassword: true,
      tempPasswordExpiresAt: true,
    },
  });
}

export async function provisionTenantSuperadmin(input: {
  tenantId: string;
  workspaceId: string;
  email: string;
  actorUserId: string;
  ipAddress?: string;
}) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('Email já registado');
  }

  const plainPassword = await generateSecurePasswordWithHibp();
  const expiresAt = computeTempPasswordExpiresAt();

  const adminUser = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(plainPassword),
      role: 'superadmin',
      status: 'active',
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      mustChangePassword: true,
      tempPasswordExpiresAt: expiresAt,
    },
    select: { id: true, email: true },
  });

  await createAuditLog({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: 'user.create',
    entityType: 'user',
    entityId: adminUser.id,
    afterJson: {
      email: adminUser.email,
      role: 'superadmin',
      mustChangePassword: true,
      tempPasswordExpiresAt: expiresAt.toISOString(),
    },
    ipAddress: input.ipAddress,
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });

  try {
    await sendTenantWelcomeEmail({
      to: email,
      tenantName: tenant.name,
      tenantSiteId: tenant.siteId,
      adminEmail: email,
      temporaryPassword: plainPassword,
    });
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      throw new Error(
        'Superadmin criado mas SMTP não configurado — configure SMTP na plataforma e reenvie as credenciais'
      );
    }
    throw err;
  }

  return { adminUser, credentialsSent: true as const };
}

export async function resendTenantSuperadminCredentials(input: {
  tenantId: string;
  actorUserId: string;
  ipAddress?: string;
}) {
  const admin = await findProvisionedSuperadmin(input.tenantId);
  if (!admin) {
    throw new Error(
      'Não existe superadmin pendente de activação. O cliente deve usar «Esqueci a password» no login.'
    );
  }

  const plainPassword = await generateSecurePasswordWithHibp();
  const expiresAt = computeTempPasswordExpiresAt();

  await prisma.user.update({
    where: { id: admin.id },
    data: {
      passwordHash: await hashPassword(plainPassword),
      tempPasswordExpiresAt: expiresAt,
    },
  });

  await prisma.session.updateMany({
    where: { userId: admin.id, isActive: true },
    data: { isActive: false },
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });

  await sendTenantWelcomeEmail({
    to: admin.email,
    tenantName: tenant.name,
    tenantSiteId: tenant.siteId,
    adminEmail: admin.email,
    temporaryPassword: plainPassword,
  });

  await createAuditLog({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    action: 'tenant.resend_admin_credentials',
    entityType: 'user',
    entityId: admin.id,
    afterJson: {
      email: admin.email,
      tempPasswordExpiresAt: expiresAt.toISOString(),
    },
    ipAddress: input.ipAddress,
  });

  return { email: admin.email, credentialsSent: true as const };
}
